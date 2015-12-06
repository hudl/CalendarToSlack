using System.Timers;
using Microsoft.Exchange.WebServices.Data;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;

namespace CalendarToSlack
{
    class Program
    {
        static void Main(string[] args)
        {
            // No try/catch for now. As I dev/prototype, I'd prefer to crash over doing something
            // like hammering the exchange server or slack API.

            Out.WriteLine("Initializing");
            var updater = new Updater(args[0], args[1]);
            updater.Start();

            Console.ReadLine();
        }
    }

    class Updater
    {
        private readonly Calendar _calendar;
        private readonly Timer _timer;
        private DateTime _lastCheck;
        private LegacyFreeBusyStatus? _lastStatusUpdate;

        public Updater(string username, string password)
        {
            _calendar = new Calendar(username, password);

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
            Out.WriteLine("Starting poll with last check time of {0}", _lastCheck);
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

                Out.WriteLine("Polling calendar");

                var events = _calendar.GetEventsHappeningNow();
                var status = LegacyFreeBusyStatus.Free;
                if (events.Any())
                {
                    status = events.First().FreeBusyStatus;
                }

                if (_lastStatusUpdate != null && _lastStatusUpdate == status)
                {
                    Out.WriteLine("No status change since last check");
                    return;
                }

                _lastStatusUpdate = status;
                Out.WriteLine("Changing current status to {0}", status);
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
            Out.WriteLine("Getting availability for {0}", _username);

            // According to the docs, the query period has to be at least 24 hours, with times
            // from midnight to midnight.
            var today = DateTime.UtcNow.Date;
            var tomorrow = today.AddDays(1);
            var results = _exchange.GetUserAvailability(new List<AttendeeInfo> { _username },
                new TimeWindow(today, tomorrow),
                AvailabilityData.FreeBusy);

            Out.WriteLine("Availability retrieved, parsing results");
            var events = results.AttendeesAvailability.SelectMany(a => a.CalendarEvents).ToList();

            Out.WriteLine("Found {0} events today (between {1} and {2})", events.Count, today, tomorrow);

            var now = DateTime.UtcNow;
            var ninetySecondsFromNow = now.AddSeconds(90);

            // Look a bit into the future. If there's an event starting in 90 seconds, you're
            // probably on your way to it (or preparing).
            var happeningNow = events.Where(e => e.StartTime <= ninetySecondsFromNow && now < e.EndTime).ToList();

            Out.WriteLine("Found {0} events starting/happening in the next 90 seconds (i.e. starting before {1}):", happeningNow.Count, ninetySecondsFromNow);
            var result = new List<CalendarEvent>();
            foreach (var e in happeningNow)
            {
                Out.WriteLine("> {0} {1} {2} {3}", e.StartTime, e.EndTime, e.FreeBusyStatus, e.Details.Subject);
                result.Add(new CalendarEvent(e.StartTime, e.EndTime, e.FreeBusyStatus, e.Details.Subject));
            }

            Out.WriteLine("Done retrieving");
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

        public CalendarEvent(DateTime startTime, DateTime endTime, LegacyFreeBusyStatus freeBusyStatus, string subject)
        {
            _startTime = startTime;
            _endTime = endTime;
            _freeBusyStatus = freeBusyStatus;
            _subject = subject;
        }
    }

    public static class Out
    {
        public static void WriteLine(string line, params object[] args)
        {
            var l = string.Format("[{0}] {1}", DateTime.UtcNow.ToString("yyyy'-'MM'-'dd HH':'mm':'ss fffffff K"), line);
            Console.WriteLine(l, args);
        }
    }

}
