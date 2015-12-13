using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace CalendarToSlack
{
    class UserDatabase
    {
        private readonly List<RegisteredUser> _registeredUsers = new List<RegisteredUser>();

        public void Load(string file)
        {
            if (!File.Exists(file))
            {
                File.Create(file);
                return;
            }

            var lines = File.ReadAllLines(file);

            var globalFilters = ParseStatusMessageFilter(lines[0]);

            var index = 0;
            foreach (var line in lines)
            {
                if (index++ < 1 || line.StartsWith("#"))
                {
                    continue;
                }

                var fields = line.Split(',');

                var filters = new Dictionary<string, string>(globalFilters);
                var personal = ParseStatusMessageFilter(fields[3]);
                foreach (var filter in personal)
                {
                    filters[filter.Key] = filter.Value;
                }
                
                var user = new RegisteredUser
                {
                    ExchangeUsername = fields[0],
                    SlackApplicationAuthToken = fields[1],
                    HackyPersonalFullAccessSlackToken = fields[2],
                    StatusMessageFilters = filters,
                };
                Out.WriteDebug("Loaded registered user {0}", user.ExchangeUsername);
                _registeredUsers.Add(user);
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

        public void QueryAndSetSlackUserInfo(Slack slack)
        {
            // Hacky - first user's creds are used to list all users.
            var authToken = _registeredUsers[0].SlackApplicationAuthToken;

            var slackUsers = slack.ListUsers(authToken);
            Out.WriteDebug("Found {0} slack users", slackUsers.Count);

            foreach (var user in _registeredUsers)
            {
                var email = user.ExchangeUsername;
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

        public List<RegisteredUser> Users
        {
            get { return _registeredUsers; }
        }
    }

    class RegisteredUser
    {
        public string ExchangeUsername { get; set; }
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