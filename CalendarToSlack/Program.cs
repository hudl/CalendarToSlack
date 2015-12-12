using System.IO;
using System.Net.Http;
using System.Timers;
using System.Web.Helpers;
using Microsoft.Exchange.WebServices.Data;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;

namespace CalendarToSlack
{
    // TODO error handling, move beyond a prototype
    // TODO consider a "business hours" rule to just auto-away anytime outside of business hours
    // TODO convert to a service?
    // TODO if user sets Away before an event manually, make sure we don't set them back to Auto after the event ends? depends, i guess.

    class Program
    {
        static void Main(string[] args)
        {
            Out.WriteInfo("Setting up Exchange and Slack connectivity");

            // args[0] = exchange username
            // args[1] = exchange password
            
            var slack = new Slack();

            var dbfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "calendar-to-slack-users.txt");
            Out.WriteInfo("Loading user database from {0}", dbfile);

            var database = new UserDatabase();
            database.Load(dbfile);
            database.QueryAndSetSlackUserInfo(slack);

            var calendar = new Calendar(args[0], args[1]);

            var updater = new Updater(database, calendar, slack);
            updater.Start();

            Console.ReadLine();
        }
    }

    class Updater
    {
        private readonly UserDatabase _userdb;
        private readonly Calendar _calendar;
        private readonly Slack _slack;
        private readonly Timer _timer;
        private DateTime _lastCheck;

        public Updater(UserDatabase userdb, Calendar calendar, Slack slack)
        {
            _userdb = userdb;
            _calendar = calendar;
            _slack = slack;
            
            _timer = new Timer
            {
                Enabled = false,
                AutoReset = true,
                Interval = 1000,
            };
            _timer.Elapsed += PollAndUpdateSlack;
        }

        public void Start()
        {
            
            _lastCheck = CurrentMinuteWithSecondsTruncated();
            Out.WriteDebug("Starting poll with last check time of {0}", _lastCheck);
            Out.WriteInfo("Started up and ready to rock");

            _timer.Start();
        }

        private DateTime CurrentMinuteWithSecondsTruncated()
        {
            var now = DateTime.UtcNow;
            return new DateTime(now.Ticks - (now.Ticks % TimeSpan.TicksPerMinute), now.Kind);
        }

        private void PollAndUpdateSlack(object o, ElapsedEventArgs args)
        {
            // If we're a minute+ later than the last check, fire again.
            // This is a naive attempt to avoid drift (by checking every second and comparing time).
            if (DateTime.UtcNow >= _lastCheck.AddMinutes(1))
            {
                _lastCheck = CurrentMinuteWithSecondsTruncated();

                var usernames = _userdb.Users.Select(u => u.ExchangeUsername).ToList();
                var allEvents = _calendar.GetEventsHappeningNow(usernames);

                foreach (var user in _userdb.Users)
                {
                    var events = allEvents[user.ExchangeUsername];
                    CheckUserStatusAndUpdate(user, events);
                }
            }
        }

        private void CheckUserStatusAndUpdate(RegisteredUser user, List<CalendarEvent> events)
        {
            var status = LegacyFreeBusyStatus.Free;
            CalendarEvent busyEvent = null;
            if (events.Any())
            {
                // Could be improved, the status and event selection here is disjoint.
                status = GetBusiestStatus(events);
                busyEvent = events.First(ev => ev.FreeBusyStatus == status);
            }

            if (user.LastStatusUpdate != null && user.LastStatusUpdate == status)
            {
                Out.WriteDebug("No status change since last check");
                return;
            }

            user.LastStatusUpdate = status;
            var presenceToSet = GetPresenceForAvailability(status);

            var currentPresence = _slack.GetPresence(user.SlackApplicationAuthToken);
            if (currentPresence != presenceToSet)
            {
                if (presenceToSet == Presence.Away)
                {
                    Out.WriteStatus("Changing current presence to {0} for \"{1}\" ({2}) ", presenceToSet, busyEvent.Subject, status);
                    _slack.PostSlackbotMessage(user.SlackApplicationAuthToken, user.SlackUserInfo.Username, string.Format("Changed your status to Away for {0}", busyEvent.Subject));
                    _slack.UpdateProfileWithStatusMessage(user, GetAwayMessageForStatus(status));
                }
                else
                {
                    Out.WriteStatus("Changing current presence to {0} for availability {1}", presenceToSet, status);
                    _slack.PostSlackbotMessage(user.SlackApplicationAuthToken, user.SlackUserInfo.Username, "Changed your status from Away to Auto");
                    _slack.UpdateProfileWithStatusMessage(user, null);
                }
                _slack.SetPresence(user.SlackApplicationAuthToken, presenceToSet);
            }
        }

        private static readonly List<LegacyFreeBusyStatus> StatusesOrderedByBusiest = new List<LegacyFreeBusyStatus>
        {
            LegacyFreeBusyStatus.OOF,
            LegacyFreeBusyStatus.Busy,
            LegacyFreeBusyStatus.Tentative,
            LegacyFreeBusyStatus.WorkingElsewhere,
            LegacyFreeBusyStatus.NoData,
            LegacyFreeBusyStatus.Free,
        };

        private static string GetAwayMessageForStatus(LegacyFreeBusyStatus status)
        {
            switch (status)
            {
                case LegacyFreeBusyStatus.OOF:
                    return "OOO";

                default:
                    return "Busy";
            }
        }

        private static LegacyFreeBusyStatus GetBusiestStatus(List<CalendarEvent> events)
        {
            var statuses = events.Select(e => e.FreeBusyStatus);
            return StatusesOrderedByBusiest.FirstOrDefault(statuses.Contains);
        }

        private static Presence GetPresenceForAvailability(LegacyFreeBusyStatus status)
        {
            switch (status)
            {
                case LegacyFreeBusyStatus.Busy:
                case LegacyFreeBusyStatus.OOF:
                    return Presence.Away;

                default:
                    return Presence.Auto;
            }
        }
    }

    class Calendar
    {
        private readonly ExchangeService _exchange;

        public Calendar(string username, string password)
        {
            if (string.IsNullOrWhiteSpace(username))
            {
                throw new ArgumentException("username");
            }

            _exchange = new ExchangeService(TimeZoneInfo.Utc)
            {
                Credentials = new NetworkCredential(username, password),

                // Since we poll every 60s, let's set a lower timeout here. The default
                // (if not set here) is 100s.
                Timeout = 30000,
            };
            _exchange.AutodiscoverUrl(username, url => true);
        }

        public Dictionary<string, List<CalendarEvent>> GetEventsHappeningNow(List<string> usernames)
        {
            // According to the docs, the query period has to be at least 24 hours, with times
            // from midnight to midnight.
            var today = DateTime.UtcNow.Date;
            var tomorrow = today.AddDays(1);

            var now = DateTime.UtcNow;
            var ninetySecondsFromNow = now.AddSeconds(90);

            var results = new Dictionary<string, List<CalendarEvent>>();
            foreach (var username in usernames)
            {
                var availability = _exchange.GetUserAvailability(new List<AttendeeInfo> { username },
                    new TimeWindow(today, tomorrow),
                    AvailabilityData.FreeBusy);
                var events = availability.AttendeesAvailability.SelectMany(a => a.CalendarEvents).ToList();
                
                // Look a bit into the future. If there's an event starting in 90 seconds, you're
                // probably on your way to it (or preparing).
                var happeningNow = events.Where(e => e.StartTime <= ninetySecondsFromNow && now < e.EndTime).ToList();

                Out.WriteDebug("Found {0} events starting/happening in the next 90 seconds (i.e. starting before {1}):", happeningNow.Count, ninetySecondsFromNow);
                var result = new List<CalendarEvent>();
                foreach (var e in happeningNow)
                {
                    Out.WriteDebug("> {0} {1} {2} {3}", e.StartTime, e.EndTime, e.FreeBusyStatus, e.Details.Subject);
                    result.Add(new CalendarEvent(e.StartTime, e.EndTime, e.FreeBusyStatus, e.Details.Subject));
                }

                results[username] = result;
            }
            
            return results;
        }
    }

    class CalendarEvent
    {
        private readonly DateTime _startTime;
        private readonly DateTime _endTime;
        private readonly LegacyFreeBusyStatus _freeBusyStatus;
        private readonly string _subject;

        public LegacyFreeBusyStatus FreeBusyStatus { get { return _freeBusyStatus; } }
        public string Subject { get { return _subject; } }

        public CalendarEvent(DateTime startTime, DateTime endTime, LegacyFreeBusyStatus freeBusyStatus, string subject)
        {
            _startTime = startTime;
            _endTime = endTime;
            _freeBusyStatus = freeBusyStatus;
            _subject = subject;
        }
    }

    class Slack
    {
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
            };
        }

        public void PostSlackbotMessage(string authToken, string username, string message)
        {
            Out.WriteInfo("Posting message to @{0}'s slackbot: {1}", username, message);
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

        /// <summary>
        /// Doesn't work.
        /// </summary>
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

            const int maxLastName = 35;
            const string separator = " | ";

            var newLastName = user.SlackUserInfo.ActualLastName;
            if (!string.IsNullOrWhiteSpace(message))
            {
                newLastName = user.SlackUserInfo.ActualLastName + separator + message.Substring(0, Math.Min(message.Length, maxLastName - (user.SlackUserInfo.ActualLastName.Length + separator.Length)));
            }

            var profile = string.Format("{{\"first_name\":\"{0}\",\"last_name\":\"{1}\"}}", user.SlackUserInfo.FirstName, newLastName);

            Out.WriteInfo("Changed profile last name to {0}", newLastName);
            Out.WriteDebug("Sending profile update with profile: {0}", profile);

            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "profile", profile },
                { "token", user.HackyPersonalFullAccessSlackToken } // TODO switch to auth token. see comments above in this method
            });
            var result = _http.PostAsync("https://slack.com/api/users.profile.set", content).Result;

            Out.WriteDebug("Status: " + result.StatusCode);
            result.EnsureSuccessStatusCode();

            Out.WriteDebug("Response: {0}", result.Content.ReadAsStringAsync().Result);

            Out.WriteDebug("Profile update complete");
        }
    }

    class SlackUserInfo
    {
        public string FirstName { get; set; }
        public string LastName { get; set; }
        public string Username { get; set; }

        public string ActualLastName { get { return LastName.Split('|')[0]; } }
    }

    enum Presence
    {
        Away,
        Auto,
    }

    public static class Out
    {
        private const bool IsDebugEnabled = true;

        public static void WriteDebug(string line, params object[] args)
        {
            if (!IsDebugEnabled)
            {
                return;
            }
            Write(ConsoleColor.Gray, line, args);
        }

        public static void WriteInfo(string line, params object[] args)
        {
            Write(ConsoleColor.Green, line, args);
        }


        public static void WriteStatus(string line, params object[] args)
        {
            Write(ConsoleColor.Cyan, line, args);
        }

        private static void Write(ConsoleColor color, string line, params object[] args)
        {
            var orig = Console.ForegroundColor;
            Console.ForegroundColor = color;
            var l = string.Format("[{0}] {1}", DateTime.UtcNow.ToString("yyyy'-'MM'-'dd HH':'mm':'ss fffffff K"), line);
            Console.WriteLine(l, args);
            Console.ForegroundColor = orig;
        }
    }
}
