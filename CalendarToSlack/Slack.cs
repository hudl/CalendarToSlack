using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Web.Helpers;
using log4net;

namespace CalendarToSlack
{
    class Slack
    {
        private static readonly ILog Log = LogManager.GetLogger(typeof (Slack).Name);

        private readonly HttpClient _http;

        public Slack()
        {
            _http = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(5),
            };
        }

        public Presence GetPresence(string authToken)
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/users.getPresence?token={0}", authToken)).Result;
            result.EnsureSuccessStatusCode();

            var content = result.Content.ReadAsStringAsync().Result;
            var data = Json.Decode(content);
            return (string.Equals(data.presence, "away", StringComparison.OrdinalIgnoreCase) ? Presence.Away : Presence.Auto);
        }

        public void SetPresence(string authToken, Presence presence)
        {
            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "token", authToken },
                { "presence", (presence == Presence.Auto ? "auto" : "away") }
            });
            var result = _http.PostAsync("https://slack.com/api/users.setPresence", content).Result;
            result.EnsureSuccessStatusCode();
        }


        // When we add a new user, we only have their auth token, and need to get their email address
        // to associate it with an exchange account. This method is mainly for that.
        public SlackUserInfo GetUserInfo(string authToken)
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/auth.test?token={0}", authToken)).Result;
            result.EnsureSuccessStatusCode();

            var content = result.Content.ReadAsStringAsync().Result;

            var data = Json.Decode(content);
            var info = GetUserInfo(authToken, data.user_id);

            return info;
        }

        public SlackUserInfo GetUserInfo(string authToken, string userId)
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/users.info?token={0}&user={1}", authToken, userId)).Result;
            result.EnsureSuccessStatusCode();

            var content = result.Content.ReadAsStringAsync().Result;

            var data = Json.Decode(content);
            return new SlackUserInfo
            {
                FirstName = data.user.profile.first_name,
                LastName = data.user.profile.last_name,
                Username = data.user.name,
                Email = data.user.profile.email,
                UserId = data.user.id,
            };
        }

        public void PostSlackbotMessage(string authToken, string username, string message)
        {
            Log.InfoFormat("Posting message to @{0}'s slackbot: {1}", username, message);
            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "token", authToken },
                { "channel", "@" + username },
                { "as_user", "false" },
                { "text", message },
                { "username", "CalendarToSlack" }
            });
            var result = _http.PostAsync("https://slack.com/api/chat.postMessage", content).Result;
            result.EnsureSuccessStatusCode();
        }

        public void UpdateProfileWithStatusMessage(RegisteredUser user, string message)
        {
            // Slack's support for status/presence (i.e. only auto/away) is limited, and one of
            // our conventions for broadcasting more precise status is to change our last name
            // to something like "Rob Hruska | Busy" or "Rob Hruska | OOO til Mon".

            // The users.profile.set API endpoint (which isn't public, but is used by the webapp
            // version of Slack) requires the `post` scope, but applications can't request/authorize
            // that scope because it's deprecated.
            // 
            // The "full access" token (from the Web API test page) does support post, but I don't
            // want to manage those within the app here. I've temporarily allowed it for myself,
            // but it'll be removed in the future.
            //
            // The current plan is to wait for Slack to either 1) expose a formal users.profile.set
            // API, or 2) introduce custom away status messages.

            if (string.IsNullOrWhiteSpace(user.HackyPersonalFullAccessSlackToken))
            {
                // Can't update without the full token.
                return;
            }

            var newLastName = GetLastNameWithAppendedMessage(user, message);

            var profile = string.Format("{{\"first_name\":\"{0}\",\"last_name\":\"{1}\"}}", user.SlackUserInfo.FirstName, newLastName);

            Log.InfoFormat("Changed profile last name to \"{0}\"", newLastName);
            
            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "profile", profile },
                { "token", user.HackyPersonalFullAccessSlackToken } // TODO switch to auth token. see comments above in this method
            });
            var result = _http.PostAsync("https://slack.com/api/users.profile.set", content).Result;

            result.EnsureSuccessStatusCode();
        }

        private static string GetLastNameWithAppendedMessage(RegisteredUser user, string message)
        {
            const int maxLastName = 35;
            const string separator = " | ";

            var newLastName = user.SlackUserInfo.ActualLastName;
            if (!string.IsNullOrWhiteSpace(message))
            {
                newLastName = user.SlackUserInfo.ActualLastName + separator + message.Substring(0, Math.Min(message.Length, maxLastName - (user.SlackUserInfo.ActualLastName.Length + separator.Length)));
            }
            return newLastName;
        }

        public List<SlackUserInfo> ListUsers(string authToken)
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/users.list?token={0}&presence=1", authToken)).Result;
            result.EnsureSuccessStatusCode();

            var content = result.Content.ReadAsStringAsync().Result;

            var results = new List<SlackUserInfo>();

            var data = Json.Decode(content);
            var members = data.members;
            foreach (var member in members)
            {
                // startup presence = member.presence
                results.Add(new SlackUserInfo
                {
                    UserId = member.id,
                    Username = member.name,
                    FirstName = member.profile.first_name,
                    LastName = member.profile.last_name,
                    Email = member.profile.email,
                });
            }
            return results;
        }
    }

    class SlackUserInfo
    {
        public string UserId { get; set; }
        public string Username { get; set; }
        
        public string FirstName { get; set; }
        public string LastName { get; set; }
        public string Email { get; set; }

        public string ActualLastName { get { return LastName.Split('|')[0].Trim(); } }
    }

    enum Presence
    {
        Away,
        Auto,
    }
}