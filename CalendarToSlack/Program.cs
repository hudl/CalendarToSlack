using System.IO;
using System.Timers;
using CalendarToSlack.Http;
using Microsoft.Exchange.WebServices.Data;
using System;
using System.Collections.Generic;
using System.Linq;

namespace CalendarToSlack
{
    // TODO error handling, move beyond a prototype
    // TODO consider a "business hours" rule to just auto-away anytime outside of business hours
    // TODO convert to a service?

    class Program
    {
        static void Main(string[] args)
        {

            var server = new HttpServer();
            server.Start();
            Console.ReadLine();
            return;

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

        private CalendarEvent GetBusiestEvent(List<CalendarEvent> events)
        {
            if (!events.Any())
            {
                return null;
            }

            var status = GetBusiestStatus(events);
            return events.First(ev => ev.FreeBusyStatus == status);
        }

        private void CheckUserStatusAndUpdate(RegisteredUser user, List<CalendarEvent> events)
        {
            // Will return null if there are no events currently happening.
            var busiestEvent = GetBusiestEvent(events);

            // Only check if we've set a current event previously. Otherwise,
            // on the first check after startup, we don't "correct" the value
            // if the user became Free while this app was stopped.
            if (user.HasSetCurrentEvent && busiestEvent == user.CurrentEvent)
            {
                // User is still in the same event, no change.
                return;
            }

            user.CurrentEvent = busiestEvent;

            if (busiestEvent == null)
            {
                // Status changed to Free.
                Out.WriteStatus("{0} is now {1}", user.ExchangeUsername, Presence.Auto);
                MakeSlackApiCalls(user, Presence.Auto, null, "Changed your status to Auto");
                return;
            }

            // Otherwise, we're transitioning into an event that's coming up (or just got added).

            var presenceToSet = GetPresenceForAvailability(busiestEvent.FreeBusyStatus);
            var statusMessage = GetUserMessage(busiestEvent, user);
            var slackbotMessage = string.Format("Changed your status to {0} for {1}", presenceToSet, busiestEvent.Subject);
            Out.WriteStatus("{0} is now {1} for \"{2}\" ({3}) ", user.ExchangeUsername, presenceToSet, busiestEvent.Subject, busiestEvent.FreeBusyStatus);
            MakeSlackApiCalls(user, presenceToSet, statusMessage, slackbotMessage);
        }

        private void MakeSlackApiCalls(RegisteredUser user, Presence presence, string statusMessage, string slackbotMessage)
        {
            _slack.PostSlackbotMessage(user.SlackApplicationAuthToken, user.SlackUserInfo.Username, slackbotMessage);
            _slack.UpdateProfileWithStatusMessage(user, statusMessage);
            _slack.SetPresence(user.SlackApplicationAuthToken, presence);
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

        private static string GetUserMessage(CalendarEvent ev, RegisteredUser user)
        {
            // Will be null if no matches.
            var filterMatch = MatchFilter(ev.Subject, user.StatusMessageFilters);

            switch (ev.FreeBusyStatus)
            {
                case LegacyFreeBusyStatus.OOF:
                    return "OOO";
                
                // With the non-away statuses, we'll still update the user's message
                // but keep their status as Auto. This works for things like "Lunch"
                // and "Working From Home".
                case LegacyFreeBusyStatus.Tentative:
                case LegacyFreeBusyStatus.WorkingElsewhere:
                case LegacyFreeBusyStatus.Free:
                    return filterMatch;
                
                case LegacyFreeBusyStatus.NoData:
                case LegacyFreeBusyStatus.Busy:
                default:
                    return filterMatch ?? "Busy";
            }
        }

        private static string MatchFilter(string subject, Dictionary<string, string> filters)
        {
            foreach (var filter in filters)
            {
                if (subject.IndexOf(filter.Key, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return filter.Value;
                }
            }

            return null;
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

    public static class Out
    {
        public static void WriteDebug(string line, params object[] args)
        {
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
