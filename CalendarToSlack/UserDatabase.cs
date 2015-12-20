using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace CalendarToSlack
{
    class UserDatabase
    {
        // Assigned to new users when they're added to the DB
        private const string DefaultFilterString = "OOO|Lunch|1:1|Working From Home>WFH|Meeting";

        private readonly Slack _slack;
        private readonly string _file;
        private readonly object _lock = new { };

        private List<RegisteredUser> _registeredUsers = new List<RegisteredUser>();

        // Doesn't really fit in the "User Database" domain, but since it's being mutated, having
        // it next to all of the other lockable data (that gets persisted) helps to not forget
        // about it. Might just rename this class "Database".
        private readonly HashSet<CalendarEvent> _markedBack = new HashSet<CalendarEvent>();

        // TODO background thread to clean out old marked events (say, older than 12 hours)
        // TODO persist marked events across restarts to avoid unexpected behavior during maintenance or crashes
        // TODO make "away updating" more immediate
        // - cache last queried events to avoid a re-query from exchange
        // - lock around update logic to avoid concurrent modifications/checks
        // TODO more sane logging

        public UserDatabase(string file, Slack slack)
        {
            if (string.IsNullOrWhiteSpace(file))
            {
                throw new ArgumentException("file");
            }

            if (slack == null)
            {
                throw new ArgumentNullException("slack");
            }

            _slack = slack;
            _file = file;

            lock (_lock)
            {
                if (!File.Exists(file))
                {
                    File.Create(file);
                    return;
                }

                _registeredUsers = ReadFile();
            }
        }

        // Caller should ensure they've acquired _lock.
        private List<RegisteredUser> ReadFile()
        {
            Console.WriteLine("Loading database from file {0}", _file);

            var lines = File.ReadAllLines(_file);
            var result = new List<RegisteredUser>();

            foreach (var line in lines)
            {
                if (line.StartsWith("#"))
                {
                    continue;
                }

                var fields = line.Split(',');
                var options = ParseOptions(fields[3]);
                var filters = ParseStatusMessageFilter(fields[4]);

                var user = new RegisteredUser
                {
                    Email = fields[0],
                    SlackApplicationAuthToken = fields[1],
                    HackyPersonalFullAccessSlackToken = fields[2],
                    StatusMessageFilters = filters,
                    Options = options,
                };
                Out.WriteDebug("Loaded registered user {0}", user.Email);
                result.Add(user);
            }

            if (result.Any())
            {
                QueryAndSetSlackUserInfo(result);
            }

            return result;
        }

        private static HashSet<Option> ParseOptions(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return new HashSet<Option>();
            }

            var split = raw.Split('|');
            var options = split.Select(item =>
            {
                Option parsed;
                if (Enum.TryParse(item, out parsed))
                {
                    return parsed;
                }
                return (Option?) null;
            }).Where(option => option != null).Select(option => option.Value);
            return new HashSet<Option>(options);
        }

        private static Dictionary<string, string> ParseStatusMessageFilter(string raw)
        {
            var result = new Dictionary<string, string>();
            if (string.IsNullOrWhiteSpace(raw))
            {
                return result;
            }

            var filters = raw.Split('|');
            foreach (var filter in filters)
            {
                if (filter.Contains('>'))
                {
                    var split = filter.Split('>');
                    result[split[0]] = split[1];
                }
                else
                {
                    result[filter] = filter;
                }
            }
            return result;
        }

        // Caller should ensure they've acquired _lock.
        private void QueryAndSetSlackUserInfo(List<RegisteredUser> users)
        {
            // Hacky - first user's creds are used to list all users.
            var authToken = users[0].SlackApplicationAuthToken;

            var slackUsers = _slack.ListUsers(authToken);
            Out.WriteDebug("Found {0} slack users", slackUsers.Count);

            foreach (var user in users)
            {
                var email = user.Email;
                var userInfo = slackUsers.FirstOrDefault(u => u.Email == email);
                if (userInfo != null)
                {
                    user.SlackUserInfo = userInfo;
                    Out.WriteDebug("Associated Exchange user {0} with Slack User {1} {2} {3} {4}",
                        email, userInfo.UserId, userInfo.Username, userInfo.FirstName, userInfo.LastName);
                }
                else
                {
                    Out.WriteInfo("Couldn't find Slack user with email {0}", email);
                }
                
            }
        }

        // Caller should ensure they've acquired _lock.
        private void WriteFile()
        {
            var lines = new List<string>();

            foreach (var user in _registeredUsers)
            {
                var options = string.Join("|", user.Options.Select(option => option.ToString()));
                var filters = string.Join("|", user.StatusMessageFilters.Select(kvp => (kvp.Key == kvp.Value ? kvp.Key : kvp.Key + ">" + kvp.Value)));
                var line = string.Format("{0},{1},{2},{3},{4}", user.Email, user.SlackApplicationAuthToken ?? "", user.HackyPersonalFullAccessSlackToken ?? "", options, filters);
                lines.Add(line);
            }
            
            Console.WriteLine("[db] Rewriting database file");

            File.WriteAllLines(_file, lines);
        }

        public List<RegisteredUser> Users
        {
            get
            {
                lock (_lock)
                {
                    return _registeredUsers;
                }
            }
        }

        // Returns true if a new user was added, false otherwise
        public bool AddUser(SlackUserInfo user, string slackAuthToken)
        {
            if (string.IsNullOrWhiteSpace(user.Email))
            {
                throw new ArgumentException("Cannot add user without email address");
            }

            lock (_lock)
            {
                var added = false;
                var existing = _registeredUsers.FirstOrDefault(u => u.Email == user.Email);
                if (existing != null)
                {
                    Console.WriteLine("Modifying existing user {0}", user.Email);

                    existing.SlackUserInfo = user;
                    existing.SlackApplicationAuthToken = slackAuthToken;
                }
                else
                {
                    if (_registeredUsers.Count >= 20)
                    {
                        // TODO remove someday. mainly exists to avoid hitting unexpected limits with repeated Exchange queries or Slack rate limiting
                        throw new InvalidOperationException("Too many users, this is a safeguard while the app is being prototyped");
                    }

                    Console.WriteLine("Adding new user {0}", user.Email);

                    _registeredUsers.Add(new RegisteredUser
                    {
                        Email = user.Email,
                        SlackApplicationAuthToken = slackAuthToken,
                        StatusMessageFilters = ParseStatusMessageFilter(DefaultFilterString),
                        Options = new HashSet<Option>
                        {
                            Option.Enabled,
                        },
                    });
                    added = true;
                }

                WriteFile();
                return added;
            }
        }

        // Right now, some operations are just done by manually modifying the database file. There's
        // an HTTP server endpoint that'll trigger this, and it just needs to be hit once to safely
        // reload the user database without restarting the app. Hack job, but works for now.
        public void ManualReload()
        {
            Console.WriteLine("Manually reloading user database");
            lock (_lock)
            {
                var previous = _registeredUsers;

                var reloaded = ReadFile();
                foreach (var previousUser in previous)
                {
                    var reloadedUser = reloaded.FirstOrDefault(user => user.Email == previousUser.Email);
                    if (reloadedUser != null && previousUser.HasSetCurrentEvent)
                    {
                        reloadedUser.CurrentEvent = previousUser.CurrentEvent;
                    }
                }

                _registeredUsers = reloaded;
            }
        }

        public void MarkBack(CalendarEvent calendarEvent)
        {
            calendarEvent.MarkedBackOn = DateTime.UtcNow;
            _markedBack.Add(calendarEvent);
        }

        public bool IsMarkedBack(CalendarEvent calendarEvent)
        {
            return _markedBack.Contains(calendarEvent);
        }
    }

    class RegisteredUser
    {
        // This is both their Slack email and their Exchange username. It's how we tie the two
        // accounts together.
        public string Email { get; set; }

        public string SlackApplicationAuthToken { get; set; }
        public string HackyPersonalFullAccessSlackToken { get; set; } // Will be removed.
        public Dictionary<string, string> StatusMessageFilters { get; set; }
        public HashSet<Option> Options { get; set; } 

        // These fields aren't persisted, but get set/modified during runtime.

        private bool _hasSetCurrentEvent = false;
        private CalendarEvent _currentEvent;

        public CalendarEvent CurrentEvent
        {
            get { return _currentEvent; }
            set
            {
                _hasSetCurrentEvent = true;
                _currentEvent = value;
            }
        }

        public bool HasSetCurrentEvent { get { return _hasSetCurrentEvent; } }

        public SlackUserInfo SlackUserInfo { get; set; }

        public bool IsEnabled { get { return Options != null && Options.Contains(Option.Enabled); } }
        public bool SendSlackbotMessageOnChange { get { return Options != null && Options.Contains(Option.SlackbotNotify); } }
    }

    // Don't rename these, they're persisted 1:1 in the database and parsed back in.
    enum Option
    {
        Enabled,
        SlackbotNotify,
    }
}