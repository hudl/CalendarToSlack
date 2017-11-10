using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using log4net;

namespace CalendarToSlack
{
    class UserDatabase
    {
        // Assigned to new users when they're added to the DB
        private const string DefaultFilterString = "OOO|Lunch|1:1|Working From Home>WFH|Meeting";
        private const int UserLimit = 30; // TODO remove someday. mainly exists to avoid hitting unexpected limits with repeated Exchange queries or Slack rate limiting

        private static readonly ILog Log = LogManager.GetLogger(typeof (UserDatabase).Name);

        private readonly Slack _slack;
        private readonly string _file;
        private readonly object _lock = new { };
        private List<RegisteredUser> _registeredUsers = new List<RegisteredUser>();

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
                }
                else
                {
                    _registeredUsers = ReadFile();
                }
            }
        }

        // Caller should ensure they've acquired _lock.
        private List<RegisteredUser> ReadFile()
        {
            Log.DebugFormat("Loading user database from file {0}", _file);

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
                    StatusMessageFilters = filters,
                    Options = options,
                };
                Log.DebugFormat("Loaded registered user {0}", user.Email);
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

        private static Dictionary<string, CustomStatus> ParseStatusMessageFilter(string raw)
        {
            var result = new Dictionary<string, CustomStatus>();
            if (string.IsNullOrWhiteSpace(raw))
            {
                return result;
            }

            var filters = raw.Split('|');
            foreach (var filter in filters)
            {
                var customStatus = new CustomStatus
                {
                    StatusText = filter,
                    StatusEmoji = "",
                };
                var filterKey = filter;

                // First, check for an emoji and remove it from the filter
                if (filter.Contains(';'))
                {
                    var split = filter.Split(';');

                    filterKey = split[0];
                    customStatus.StatusText = split[0];
                    customStatus.StatusEmoji = split[1];
                }

                // Second, check for a custom text mapping
                if (filterKey.Contains('>'))
                {
                    var split = filterKey.Split('>');

                    filterKey = split[0];
                    customStatus.StatusText = split[1];
                }

                result[filterKey] = customStatus;
            }
            
            return result;
        }

        // Caller should ensure they've acquired _lock.
        private void QueryAndSetSlackUserInfo(List<RegisteredUser> users)
        {
            // Hacky - first user's creds are used to list all users.
            var authToken = users[0].SlackApplicationAuthToken;

            var slackUsers = _slack.ListUsers(authToken);
            Log.DebugFormat("Found {0} slack users", slackUsers.Count);

            foreach (var user in users)
            {
                var email = user.Email;
                var userInfo = slackUsers.FirstOrDefault(u => u.Email == email);
                if (userInfo != null)
                {
                    user.SlackUserInfo = userInfo;
                    Log.DebugFormat("Associated Exchange user {0} with Slack User {1} {2} {3} {4}",
                        email, userInfo.UserId, userInfo.Username, userInfo.FirstName, userInfo.LastName);
                }
                else
                {
                    Log.WarnFormat("Couldn't find Slack user with email {0}, user will be disabled", email);
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
                var filters = SerializeMessageFilters(user.StatusMessageFilters);
                var line = string.Format("{0},{1},{2},{3},{4}", user.Email, user.SlackApplicationAuthToken ?? "", "", options, filters);
                lines.Add(line);
            }
            
            Log.DebugFormat("Rewriting database file");

            File.WriteAllLines(_file, lines);
        }

        private string SerializeMessageFilters(Dictionary<string, CustomStatus> filters)
        {
            return string.Join("|", filters.Select(f => f.Key == f.Value.StatusText ? f.Value.ToString() : $"{f.Key}>{f.Value}"));
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
                    Log.DebugFormat("Modifying existing user {0}", user.Email);

                    existing.SlackUserInfo = user;
                    existing.SlackApplicationAuthToken = slackAuthToken;
                }
                else
                {
                    if (_registeredUsers.Count >= UserLimit)
                    {
                        throw new InvalidOperationException("Too many users, this is a safeguard while the app is being prototyped");
                    }

                    Log.DebugFormat("Adding new user {0}", user.Email);

                    var registeredUser = new RegisteredUser
                    {
                        Email = user.Email,
                        SlackApplicationAuthToken = slackAuthToken,
                        StatusMessageFilters = ParseStatusMessageFilter(DefaultFilterString),
                        Options = new HashSet<Option>
                        {
                            Option.Enabled,
                        },
                    };

                    _registeredUsers.Add(registeredUser);

                    QueryAndSetSlackUserInfo(new List<RegisteredUser> { registeredUser });
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
            Log.DebugFormat("Manually reloading user database");
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

        public void AddToWhitelist(string userId, string token)
        {
            if (string.IsNullOrWhiteSpace(token))
            {
                Log.Warn($"No token provided by {userId} to add to whitelist");
                return;
            }

            var user = FindUserById(userId);
            if (user == null)
            {
                Log.Warn($"Cannot find user id {userId} to add to their whitelist");
                return;
            }

            lock (_lock)
            {
                var dictionary = ParseStatusMessageFilter(token);

                Log.DebugFormat("Adding whitelist tokens to user {0}, tokens = {1}", user.Email, token);

                foreach (var item in dictionary)
                {
                    user.StatusMessageFilters[item.Key] = item.Value;
                }

                WriteFile();
                
                var message = $"Added `{token}`";
                EchoWhitelistToSlackbot(userId, false, message);
            }
        }

        public void RemoveFromWhitelist(string userId, string token)
        {
            if (string.IsNullOrWhiteSpace(token))
            {
                Log.WarnFormat("No token provided by {0} to remove from whitelist", userId);
                return;
            }

            var user = FindUserById(userId);
            if (user == null)
            {
                Log.WarnFormat("Cannot find user id {0} to remove from their whitelist", userId);
                return;
            }

            var remove = ParseStatusMessageFilter(token);

            lock (_lock)
            {
                Log.DebugFormat("Removing whitelist tokens from user {0}, tokens = {1}", user.Email, string.Join("|", remove));

                foreach (var item in remove.Keys)
                {
                    user.StatusMessageFilters.Remove(item);
                }
                
                WriteFile();
                
                var message = $"Removed `{token}`";
                EchoWhitelistToSlackbot(userId, false, message);
            }
        }

        public void EchoWhitelistToSlackbot(string userId, bool withCommentary = true, string flashMessage = null)
        {
            var user = FindUserById(userId);

            var text = "";
            text += "--------------------\n";

            if (!string.IsNullOrWhiteSpace(flashMessage))
            {
                text += $":white_check_mark: *Ok!* {flashMessage}\n";
                text += "--------------------\n\n";
            }
            
            // TODO implement defaults
            text += "*Your default status is: :whiskeyrob: `Not yet implemented!`*\n";
            if (withCommentary)
            {
                text += "_This is used when you don't have an active calendar event. To change your default status, use_ `/c2s-default-status`\n";
            }
            text += "\n";

            text += "*Your whitelisted &amp; mapped statuses:*\n";
            if (withCommentary)
            {
                text += "_If a calendar event name matches these, they'll be used as your Slack status. Matching events can be transformed to different Slack statuses (shown with `>`). If unmatched, a generic Slack status (e.g. \"Away\" or \"OOO\") will be used. Use `/c2s-whitelist` to manage this list._\n";
            }
            text += "\n";
            
            foreach (var filter in user.StatusMessageFilters.OrderBy(filter => filter.Key))
            {
                var emoji = (string.IsNullOrWhiteSpace(filter.Value.StatusEmoji) ? ":transparent:" : filter.Value.StatusEmoji);
                var mapping = (filter.Key == filter.Value.StatusText ? "" : $" uses status `{filter.Value.StatusText}`");
                text += $"{emoji} `{filter.Key}`{mapping}\n";
            }
            
            _slack.PostSlackbotMessage(user.SlackApplicationAuthToken, user.SlackUserInfo, text);
        }

        private RegisteredUser FindUserById(string userId)
        {
            lock (_lock)
            {
                return _registeredUsers.FirstOrDefault(u => u.SlackUserInfo != null && u.SlackUserInfo.UserId == userId);
            }
        }
    }

    class RegisteredUser
    {
        // This is both their Slack email and their Exchange username. It's how we tie the two
        // accounts together.
        public string Email { get; set; }

        public string SlackApplicationAuthToken { get; set; }
        public Dictionary<string, CustomStatus> StatusMessageFilters { get; set; }
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

        public CustomStatus CurrentCustomStatus { get; set; }

        public SlackUserInfo SlackUserInfo { get; set; }

        public bool IsEnabled
        {
            get
            {
                return Options != null && Options.Contains(Option.Enabled) && SlackUserInfo != null;
            }
        }

        public bool SendSlackbotMessageOnChange { get { return Options != null && Options.Contains(Option.SlackbotNotify); } }
    }

    // Don't rename these, they're persisted 1:1 in the database and parsed back in.
    enum Option
    {
        Enabled,
        SlackbotNotify,
    }
}