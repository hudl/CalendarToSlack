using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Exchange.WebServices.Data;

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
            foreach (var line in lines)
            {
                if (line.StartsWith("#"))
                {
                    continue;
                }

                var fields = line.Split(',');
                var user = new RegisteredUser
                {
                    ExchangeUsername = fields[0],
                    SlackUserId = fields[1],
                    SlackApplicationAuthToken = fields[2],
                    HackyPersonalFullAccessSlackToken = fields[3],
                };
                Out.WriteDebug("Loaded registered user {0}", user.ExchangeUsername);
                _registeredUsers.Add(user);
            }
        }

        public void QueryAndSetSlackUserInfo(Slack slack)
        {
            foreach (var user in _registeredUsers)
            {
                var userInfo = slack.GetUserInfo(user.SlackApplicationAuthToken, user.SlackUserId);
                user.SlackUserInfo = userInfo;
                Out.WriteDebug("Current Slack user info is FirstName={0}, LastName={1} Username={2}", userInfo.FirstName, userInfo.LastName, userInfo.Username);
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
        public string SlackUserId { get; set; }
        public string SlackApplicationAuthToken { get; set; }
        public string HackyPersonalFullAccessSlackToken { get; set; } // Will be removed.

        // These fields aren't persisted, but get set/modified during runtime.
        public LegacyFreeBusyStatus? LastStatusUpdate { get; set; }
        public SlackUserInfo SlackUserInfo { get; set; }
    }
}