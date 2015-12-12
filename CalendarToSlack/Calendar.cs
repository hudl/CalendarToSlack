using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using Microsoft.Exchange.WebServices.Data;

namespace CalendarToSlack
{
    class Calendar
    {
        private readonly ExchangeService _exchange;

        public Calendar(string username, string password)
        {
            if (string.IsNullOrWhiteSpace(username))
            {
                throw new ArgumentException("username");
            }

            Out.WriteInfo("Connecting to Exchange. This may take 30-60s.");

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
}