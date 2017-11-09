using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading;
using log4net;
using Newtonsoft.Json;

namespace CalendarToSlack
{
    class Slack
    {
        private static readonly ILog Log = LogManager.GetLogger(typeof (Slack).Name);

        private readonly HttpClient _http;
        private readonly string _slackbotPostIconurl;

        public Slack(string slackbotPostIconUrl = null)
        {
            _slackbotPostIconurl = slackbotPostIconUrl;
            _http = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(5),
            };
        }

        //public Presence GetPresence(string authToken)
        //{
        //    var result = _http.GetAsync(string.Format("https://slack.com/api/users.getPresence?token={0}", authToken)).Result;
        //    LogSlackApiResult("users.getPresence", result);

        //    if (!result.IsSuccessStatusCode)
        //    {
        //        Log.ErrorFormat("Unsuccessful response status for users.getPresence: {0}", result.StatusCode);
        //        return;
        //    }

        //    var content = result.Content.ReadAsStringAsync().Result;
        //    var data = Json.Decode(content);
        //    return (string.Equals(data.presence, "away", StringComparison.OrdinalIgnoreCase) ? Presence.Away : Presence.Auto);
        //}

        public void SetPresence(string authToken, Presence presence)
        {
            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "token", authToken },
                { "presence", (presence == Presence.Auto ? "auto" : "away") }
            });
            var result = _http.PostAsync("https://slack.com/api/users.setPresence", content).Result;
            LogSlackApiResult("users.setPresence", result);
            
            if (!result.IsSuccessStatusCode)
            {
                Log.ErrorFormat("Unsuccessful response status for users.setPresence: {0}", result.StatusCode);
            }
            
            Throttle();
        }


        // When we add a new user, we only have their auth token, and need to get their email address
        // to associate it with an exchange account. This method is mainly for that.
        public SlackUserInfo GetUserInfo(string authToken)
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/auth.test?token={0}", authToken)).Result;
            LogSlackApiResult("auth.test", result);
            result.EnsureSuccessStatusCode();
            
            var content = result.Content.ReadAsStringAsync().Result;

            Throttle();

            var data = (dynamic)JsonConvert.DeserializeObject(content);
            var info = GetUserInfo(authToken, (string)data.user_id);

            return info;
        }

        public SlackUserInfo GetUserInfo(string authToken, string userId)
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/users.info?token={0}&user={1}", authToken, userId)).Result;
            LogSlackApiResult("users.info " + userId, result);
            result.EnsureSuccessStatusCode();
            
            var content = result.Content.ReadAsStringAsync().Result;

            Throttle();

            var data = (dynamic)JsonConvert.DeserializeObject(content);
            return new SlackUserInfo
            {
                FirstName = (string) data.user.profile.first_name,
                LastName = (string) data.user.profile.last_name,
                Username = (string) data.user.name,
                Email = (string) data.user.profile.email,
                UserId = (string) data.user.id,
            };
        }

        public void PostSlackbotMessage(string authToken, SlackUserInfo user, string message, bool unfurlLinks = true)
        {
            Log.InfoFormat("Posting message to @{0}'s slackbot: {1}", user.Username, message);

            var options = new Dictionary<string, string>
            {
                { "token", authToken },
                { "channel", "@" + user.Username },
                { "as_user", "false" },
                { "text", message },
                { "unfurl_links", unfurlLinks ? "true" : "false" },
                { "username", "Calendar To Slack" },
            };

            if (!string.IsNullOrWhiteSpace(_slackbotPostIconurl))
            {
                options["icon_url"] = _slackbotPostIconurl;
            }

            var content = new FormUrlEncodedContent(options);

            var result = _http.PostAsync("https://slack.com/api/chat.postMessage", content).Result;
            LogSlackApiResult("chat.postMessage " + user.Username, result);

            if (!result.IsSuccessStatusCode)
            {
                Log.ErrorFormat("Unsuccessful response status for chat.postMessage: {0}", result.StatusCode);
            }

            Throttle();
        }

        public void UpdateProfileWithStatus(string authToken, SlackUserInfo user, CustomStatus status)
        {            
            if (status == null)
            {
                return;
            }

            var profile = $"{{\"status_text\":\"{status.StatusText}\",\"status_emoji\":\"{status.StatusEmoji}\"}}";

            Log.Info($"Changed profile status text to {status.StatusText} and emoji to {status.StatusEmoji}");
            
            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "token", authToken },
                { "profile", profile },
            });
            
            var result = _http.PostAsync("https://slack.com/api/users.profile.set", content).Result;
            LogSlackApiResult("users.profile.set " + user.Username, result);

            if (!result.IsSuccessStatusCode)
            {
                Log.ErrorFormat("Unsuccessful response status for users.profile.set: {0}", result.StatusCode);
            }

            Throttle();
        }

        public List<SlackUserInfo> ListUsers(string authToken)
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/users.list?token={0}&presence=1", authToken)).Result;
            LogSlackApiResult("users.list", result, false);
            result.EnsureSuccessStatusCode();

            var content = result.Content.ReadAsStringAsync().Result;

            Throttle();

            var results = new List<SlackUserInfo>();
            
            var data = (dynamic)JsonConvert.DeserializeObject(content);
            var members = data.members;
            foreach (var member in members)
            {
                // startup presence = member.presence
                // 
                // This assumes that the custom status of the user at startup is their desired default, 
                // but if the app starts when the user has a meeting or OOO-related status set, that will be
                // used as the default. TODO: add manual default status setting: https://github.com/robhruska/CalendarToSlack/issues/17
                results.Add(new SlackUserInfo
                {
                    UserId = member.id,
                    Username = member.name,
                    FirstName = member.profile.first_name,
                    LastName = member.profile.last_name,
                    Email = member.profile.email,
                    DefaultCustomStatus = new CustomStatus { StatusText = member.profile.status_text, StatusEmoji = member.profile.status_emoji }
                });
            }
            return results;
        }

        private static void LogSlackApiResult(string action, HttpResponseMessage response, bool logContent = true)
        {
            try
            {
                Log.DebugFormat("Slack API result ({0}): Status={1} Content={2}", action, response.StatusCode, (logContent ? response.Content.ReadAsStringAsync().Result : "<omitted>"));
            }
            catch (Exception e)
            {
                Log.ErrorFormat("Error logging Slack API result: " + e.Message);
            }
        }

        private void Throttle()
        {
            // To avoid Slack's rate limit. This is a carryover from when this app used a different API; it may
            // not be needed anymore. It used to be 1500. I dropped it to 100 just to keep a bit of a throttle
            // in place.
            Thread.Sleep(100);
        }
    }

    class SlackUserInfo
    {
        public string UserId { get; set; }
        public string Username { get; set; }
        
        public string FirstName { get; set; }
        public string LastName { get; set; }
        public string Email { get; set; }

        public CustomStatus DefaultCustomStatus { get; set; }
    }

    class CustomStatus
    {
        public string StatusText { get; set; }
        public string StatusEmoji { get; set; }

        public override string ToString()
        {
            return !string.IsNullOrWhiteSpace(StatusEmoji) ? $"{StatusText};{StatusEmoji}" : StatusText;
        }
    }

    enum Presence
    {
        Away,
        Auto,
    }
}