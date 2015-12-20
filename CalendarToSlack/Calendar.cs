using System;
using System.Collections.Generic;
using System.Diagnostics;
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

            var stopwatch = Stopwatch.StartNew();
            _exchange = new ExchangeService(TimeZoneInfo.Utc)
            {
                Credentials = new NetworkCredential(username, password),

                // Since we poll every 60s, let's set a lower timeout here. The default
                // (if not set here) is 100s.
                Timeout = 30000,
            };
            _exchange.AutodiscoverUrl(username, url => true);
            Console.WriteLine("Exchange discovery took {0}ms", stopwatch.Elapsed.TotalMilliseconds);
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

            var availabilities = _exchange.GetUserAvailability(
                usernames.Select(username => (AttendeeInfo) username).ToList(),
                new TimeWindow(today, tomorrow),
                AvailabilityData.FreeBusy);

            var stopwatch = Stopwatch.StartNew();
            var index = 0;

            // When querying multiple usernames, the returned availability list has an entry for
            // each username queried, in order. We have to use the index to associate because the
            // actual username isn't present anywhere in the results.
            foreach (var availability in availabilities.AttendeesAvailability)
            {
                var username = usernames[index++];
                var events = availability.CalendarEvents;

                // Look a bit into the future. If there's an event starting in 90 seconds, you're
                // probably on your way to it (or preparing).
                var happeningNow = events.Where(e => e.StartTime <= ninetySecondsFromNow && now < e.EndTime).ToList();

                //Out.WriteDebug("Found {0} events starting/happening in the next 90 seconds for {1} (i.e. starting before {2}):", happeningNow.Count, username, ninetySecondsFromNow);
                var result = new List<CalendarEvent>();
                foreach (var e in happeningNow)
                {
                    //Out.WriteDebug("> {0} {1} {2} {3}", e.StartTime, e.EndTime, e.FreeBusyStatus, e.Details.Subject);
                    result.Add(new CalendarEvent(e.StartTime, e.EndTime, e.FreeBusyStatus, e.Details.Subject));
                }

                results[username] = result;
            }

            //Console.WriteLine("Exchange lookup took {0}ms", stopwatch.Elapsed.TotalMilliseconds);
            
            return results;
        }
    }

    class CalendarEvent : IEquatable<CalendarEvent>
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

        public bool Equals(CalendarEvent other)
        {
            if (ReferenceEquals(null, other)) return false;
            if (ReferenceEquals(this, other)) return true;
            return _startTime.Equals(other._startTime) && _endTime.Equals(other._endTime) && _freeBusyStatus == other._freeBusyStatus && string.Equals(_subject, other._subject);
        }

        public override bool Equals(object obj)
        {
            if (ReferenceEquals(null, obj)) return false;
            if (ReferenceEquals(this, obj)) return true;
            if (obj.GetType() != this.GetType()) return false;
            return Equals((CalendarEvent)obj);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                int hashCode = _startTime.GetHashCode();
                hashCode = (hashCode * 397) ^ _endTime.GetHashCode();
                hashCode = (hashCode * 397) ^ (int)_freeBusyStatus;
                hashCode = (hashCode * 397) ^ (_subject != null ? _subject.GetHashCode() : 0);
                return hashCode;
            }
        }

        public static bool operator ==(CalendarEvent left, CalendarEvent right)
        {
            return Equals(left, right);
        }

        public static bool operator !=(CalendarEvent left, CalendarEvent right)
        {
            return !Equals(left, right);
        }
    }
}