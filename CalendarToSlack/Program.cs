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
    // TODO error handling
    // - i've left out try/catches, response status code checks, etc. for now. as i prototype, i'd
    //   prefer to just crash and find out about the error. once this is all proven out, come back
    //   through and give errors better consideration.

    // TODO consider a "business hours" rule to just auto-away anytime outside of business hours
    // TODO convert to a service?
    // TODO if user sets Away before an event manually, make sure we don't set them back to Auto after the event ends? depends, i guess.

    class Program
    {
        static void Main(string[] args)
        {
            Out.WriteInfo("Setting up Exchange and Slack connectivity");

            // args[1] = exchange username
            // args[2] = exchange password
            // args[3] = slack auth token
            // args[4] = slack user id
            
            var slack = new Slack(args[2], args[3]);
            

            var presence = slack.GetPresence();
            Out.WriteInfo("Current Slack presence is {0}", presence);

            //slack.PostSlackbotMessage("This is a test message");

            //slack.UpdateProfileWithStatusMessage("foo");
            //userInfo = slack.GetUserInfo();
            //Out.WriteDebug("Updated Slack user info is FirstName={0}, LastName={1}", userInfo.FirstName, userInfo.LastName);

            var calendar = new Calendar(args[0], args[1]);

            var updater = new Updater(calendar, slack);
            updater.Start();

            Console.ReadLine();
        }
    }

    class Updater
    {
        private readonly Calendar _calendar;
        private readonly Slack _slack;
        private readonly Timer _timer;
        private DateTime _lastCheck;
        private LegacyFreeBusyStatus? _lastStatusUpdate;

        public Updater(Calendar calendar, Slack slack)
        {
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
            _slack.PostSlackbotMessage("CalendarToSlack is up and running");

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

                Out.WriteDebug("Polling calendar");

                var events = _calendar.GetEventsHappeningNow();
                var status = LegacyFreeBusyStatus.Free;
                CalendarEvent busyEvent = null;
                if (events.Any())
                {
                    // Could be improved, the status and event selection here is disjoint.
                    status = GetBusiestStatus(events);
                    busyEvent = events.First(ev => ev.FreeBusyStatus == status);
                }

                if (_lastStatusUpdate != null && _lastStatusUpdate == status)
                {
                    Out.WriteDebug("No status change since last check");
                    return;
                }

                _lastStatusUpdate = status;
                var presenceToSet = GetPresenceForAvailability(status);

                var currentPresence = _slack.GetPresence();
                if (currentPresence != presenceToSet)
                {
                    if (presenceToSet == Presence.Away)
                    {
                        Out.WriteStatus("Changing current presence to {0} for \"{1}\" ({2}) ", presenceToSet, busyEvent.Subject, status);
                        _slack.PostSlackbotMessage(string.Format("Changed your status to Away for {0}", busyEvent.Subject));
                    }
                    else
                    {
                        Out.WriteStatus("Changing current presence to {0} for availability {1}", presenceToSet, status);
                        _slack.PostSlackbotMessage("Changed your status from Away to Auto");
                    }
                    _slack.SetPresence(presenceToSet);
                }
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
        private readonly string _username;

        public Calendar(string username, string password)
        {
            if (string.IsNullOrWhiteSpace(username))
            {
                throw new ArgumentException("username");
            }

            _username = username;
            _exchange = new ExchangeService(TimeZoneInfo.Utc)
            {
                Credentials = new NetworkCredential(username, password),

                // Since we poll every 60s, let's set a lower timeout here. The default
                // (if not set here) is 100s.
                Timeout = 30000,
            };
            _exchange.AutodiscoverUrl(username, url => true);
        }

        public List<CalendarEvent> GetEventsHappeningNow()
        {
            Out.WriteDebug("Getting availability for {0}", _username);

            // According to the docs, the query period has to be at least 24 hours, with times
            // from midnight to midnight.
            var today = DateTime.UtcNow.Date;
            var tomorrow = today.AddDays(1);
            var results = _exchange.GetUserAvailability(new List<AttendeeInfo> { _username },
                new TimeWindow(today, tomorrow),
                AvailabilityData.FreeBusy);

            Out.WriteDebug("Availability retrieved, parsing results");
            var events = results.AttendeesAvailability.SelectMany(a => a.CalendarEvents).ToList();

            Out.WriteDebug("Found {0} events today (between {1} and {2})", events.Count, today, tomorrow);

            var now = DateTime.UtcNow;
            var ninetySecondsFromNow = now.AddSeconds(90);

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

            Out.WriteDebug("Done retrieving");
            return result;
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
        private readonly string _authToken;
        private readonly string _userId;
        private readonly string _username;
        private readonly HttpClient _http;

        public Slack(string authToken, string userId)
        {
            if (string.IsNullOrWhiteSpace(authToken))
            {
                throw new ArgumentException("authToken");
            }

            if (string.IsNullOrWhiteSpace(userId))
            {
                throw new ArgumentException("userId");
            }

            _authToken = authToken;
            _userId = userId;

            _http = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(5),
            };

            // Making network calls in a constructor, eh? Ballsy.
            var userInfo = GetUserInfo();
            Out.WriteDebug("Current Slack user info is FirstName={0}, LastName={1} Username={2}", userInfo.FirstName, userInfo.LastName, userInfo.Username);

            _username = userInfo.Username;
        }

        public Presence GetPresence()
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/users.getPresence?token={0}", _authToken)).Result;
            result.EnsureSuccessStatusCode();

            var content = result.Content.ReadAsStringAsync().Result;
            var data = Json.Decode(content);
            return (string.Equals(data.presence, "away", StringComparison.OrdinalIgnoreCase) ? Presence.Away : Presence.Auto);
        }

        public void SetPresence(Presence presence)
        {
            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "token", _authToken },
                { "presence", (presence == Presence.Auto ? "auto" : "away") }
            });
            var result = _http.PostAsync("https://slack.com/api/users.setPresence", content).Result;
            result.EnsureSuccessStatusCode();
        }

        public SlackUserInfo GetUserInfo()
        {
            var result = _http.GetAsync(string.Format("https://slack.com/api/users.info?token={0}&user={1}", _authToken, _userId)).Result;
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

        public void PostSlackbotMessage(string message)
        {
            Out.WriteInfo("Posting message to @{0}'s slackbot: {1}", _username, message);
            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "token", _authToken },
                { "channel", "@" + _username },
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
        public void UpdateProfileWithStatusMessage(string message)
        {
            throw new NotImplementedException();

            // The web application version of slack uses the `users.profile.set` API endpoint
            // to update profile information. I've been trying to mimic it, but haven't been
            // successful.
            //
            // Slack's support for status/presence (i.e. only auto/away) is limited, and one of
            // our conventions for broadcasting more precise status is to change our last name
            // to something like "Rob Hruska | Busy" or "Rob Hruska | OOO til Mon".
            //
            // If Slack ever 1) opens up their profile API, or 2) builds a more
            // full-featured status, we can try wiring that up here.

            // TODO enforce limits and truncation on message

            
            var profile = string.Format("{{\"first_name\":\"Rob\",\"last_name\":\"H\"}}");

            Out.WriteDebug("Sending profile update with profile: {0}", profile);

            var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                { "users", _userId },
                { "profile", profile },
                { "token", _authToken }
            });
            var result = _http.PostAsync("https://hudl.slack.com/api/users.profile.set", content).Result;

            Out.WriteDebug("Status: " + result.StatusCode);
            result.EnsureSuccessStatusCode();
            Out.WriteDebug("Profile update complete");
        }
    }

    class SlackUserInfo
    {
        public string FirstName { get; set; }
        public string LastName { get; set; }
        public string Username { get; set; }
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
