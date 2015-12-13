using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace CalendarToSlack
{
    class UserDatabase
    {
        private const string DefaultFilterString = "OOO|Lunch|1:1|Working From Home>WFH|Meeting";

        private readonly List<RegisteredUser> _registeredUsers = new List<RegisteredUser>();
        private readonly string _file;
        private readonly object _lock = new { };

        public UserDatabase(string file)
        {
            if (string.IsNullOrWhiteSpace(file))
            {
                throw new ArgumentException("file");
            }

            lock (_lock)
            {
                if (!File.Exists(file))
                {
                    File.Create(file);
                    return;
                }
            }

            _file = file;
        }

        public void Load(Slack slack)
        {
            lock (_lock)
            {
                var lines = File.ReadAllLines(_file);

                //var globalFilters = ParseStatusMessageFilter(lines[0]);

                //var index = 0;
                foreach (var line in lines)
                {
                    if (/*index++ < 1 || */line.StartsWith("#"))
                    {
                        continue;
                    }

                    var fields = line.Split(',');

                    //var filters = new Dictionary<string, string>(globalFilters);
                    var filters = ParseStatusMessageFilter(fields[3]);
                    //foreach (var filter in personal)
                    //{
                    //    filters[filter.Key] = filter.Value;
                    //}
                
                    var user = new RegisteredUser
                    {
                        Email = fields[0],
                        SlackApplicationAuthToken = fields[1],
                        HackyPersonalFullAccessSlackToken = fields[2],
                        StatusMessageFilters = filters,
                    };
                    Out.WriteDebug("Loaded registered user {0}", user.Email);
                    _registeredUsers.Add(user);
                }

                if (_registeredUsers.Any())
                {
                    QueryAndSetSlackUserInfo(slack);
                }
            }
        }

        private Dictionary<string, string> ParseStatusMessageFilter(string raw)
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
        private void QueryAndSetSlackUserInfo(Slack slack)
        {
            // Hacky - first user's creds are used to list all users.
            var authToken = _registeredUsers[0].SlackApplicationAuthToken;

            var slackUsers = slack.ListUsers(authToken);
            Out.WriteDebug("Found {0} slack users", slackUsers.Count);

            foreach (var user in _registeredUsers)
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
                var filters = string.Join("|", user.StatusMessageFilters.Select(kvp => (kvp.Key == kvp.Value ? kvp.Key : kvp.Key + ">" + kvp.Value)));
                var line = string.Format("{0},{1},{2},{3}", user.Email, user.SlackApplicationAuthToken ?? "", user.HackyPersonalFullAccessSlackToken ?? "", filters);
                lines.Add(line);
            }
            
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

        public void AddUser(SlackUserInfo user, string slackAuthToken)
        {
            lock (_lock)
            {
                var existing = _registeredUsers.FirstOrDefault(u => u.Email == user.Email);
                if (existing != null)
                {
                    existing.SlackUserInfo = user;
                    existing.SlackApplicationAuthToken = slackAuthToken;
                }
                else
                {
                    _registeredUsers.Add(new RegisteredUser
                    {
                        Email = user.Email,
                        SlackApplicationAuthToken = slackAuthToken,
                        StatusMessageFilters = ParseStatusMessageFilter(DefaultFilterString),
                    });
                }

                WriteFile();
            }
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
    }
}