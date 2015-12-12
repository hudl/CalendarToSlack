using System.IO;
using System.Timers;
using Microsoft.Exchange.WebServices.Data;
using System;
using System.Collections.Generic;
using System.Linq;

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
