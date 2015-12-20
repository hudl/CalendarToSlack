using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Timers;
using log4net;

namespace CalendarToSlack
{
    // Keeps track of events that users have marked themselves "back" for.
    // Persists that information across restarts.
    class MarkedEventDatabase
    {
        private static readonly ILog Log = LogManager.GetLogger(typeof (MarkedEventDatabase).Name);

        private HashSet<MarkedEvent> _markedBack = new HashSet<MarkedEvent>();

        // ReSharper disable PrivateFieldCanBeConvertedToLocalVariable
        private readonly Timer _cleanupTimer;
        // ReSharper restore PrivateFieldCanBeConvertedToLocalVariable

        private readonly object _lock = new { };
        private readonly string _file;

        public MarkedEventDatabase(string file)
        {
            if (string.IsNullOrWhiteSpace(file))
            {
                throw new ArgumentException();
            }

            _file = file;

            lock (_lock)
            {
                if (!File.Exists(file))
                {
                    File.Create(file);
                }
                else
                {
                    _markedBack = ReadFile();
                    CleanupOldEvents();
                }
            }

            _cleanupTimer = new Timer
            {
                Enabled = true,
                AutoReset = true,
                Interval = 1000 * 60 * 60 * 12,
            };

            _cleanupTimer.Elapsed += (_, __) =>
            {
                lock (_lock)
                {
                    CleanupOldEvents();
                }
            };
        }

        // Caller should ensure they've acquired _lock;
        private HashSet<MarkedEvent> ReadFile()
        {
            Log.DebugFormat("Loading marked event database from file {0}", _file);

            var lines = File.ReadAllLines(_file);
            var result = new HashSet<MarkedEvent>();
            foreach (var line in lines)
            {
                var split = line.Split(',');
                var email = split[0];
                var hashcode = int.Parse(split[1]);
                var date = DateTime.Parse(split[2]);

                result.Add(new MarkedEvent(email, hashcode, date));
            }

            Log.DebugFormat("Loaded {0} marked-back events", result.Count);
            return result;
        }

        // Caller should ensure they've acquired _lock;
        private void WriteFile()
        {
            var lines = new List<string>();

            foreach (var marked in _markedBack)
            {
                var line = string.Format("{0},{1},{2}",
                    marked.Email,
                    marked.EventHashcode,
                    marked.MarkedBackOn.ToString("o"));
                lines.Add(line);
            }

            File.WriteAllLines(_file, lines);
        }

        public void MarkBack(RegisteredUser user, CalendarEvent calendarEvent)
        {
            lock (_lock)
            {
                _markedBack.Add(new MarkedEvent(user.Email, calendarEvent.GetHashCode()));
                WriteFile();
            }
        }

        public bool IsMarkedBack(RegisteredUser user, CalendarEvent calendarEvent)
        {
            lock (_lock)
            {
                return _markedBack.Contains(new MarkedEvent(user.Email, calendarEvent.GetHashCode()));
            }
        }

        // Caller should ensure they've acquired _lock;
        private void CleanupOldEvents()
        {
            Log.DebugFormat("Cleaning up old marked-back events");
            var twelveHoursAgo = DateTime.UtcNow.AddHours(-12);
            var recent = _markedBack.Where(e => e.MarkedBackOn > twelveHoursAgo).ToList();
            Log.DebugFormat("Pruned {0} events down to {1} recent ones", _markedBack.Count, recent.Count());
            _markedBack = new HashSet<MarkedEvent>(recent);
            WriteFile();
        }
    }

    public class MarkedEvent : IEquatable<MarkedEvent>
    {
        // Keep track of which user marked the event; people will share CalendarEvents,
        // and CalendarEvent equality is only on start, end, and subject. Tracking by
        // user helps avoid one user's /back command from marking everyone else with that
        // event "back", too.
        public string Email { get; private set; }

        // Hashcode's a quick/dirty way to ID an event without serializing all of its
        // members. Good enough for now, I think.
        public int EventHashcode { get; private set; }

        public DateTime MarkedBackOn { get; private set; }

        public MarkedEvent(string email, int eventHashcode, DateTime? markedBackOn = null)
        {
            Email = email;
            EventHashcode = eventHashcode;
            MarkedBackOn = markedBackOn ?? DateTime.UtcNow;
        }

        public bool Equals(MarkedEvent other)
        {
            // Don't use MarkedBackOn as part of the equality check. We'll create 
            // instances with null values (via the constructor) to compare against,
            // and we want those to match events that we're tracking in the set
            // (even though they'll have different datetimes).
            if (ReferenceEquals(null, other)) return false;
            if (ReferenceEquals(this, other)) return true;
            return string.Equals(Email, other.Email) && EventHashcode == other.EventHashcode;
        }

        public override bool Equals(object obj)
        {
            if (ReferenceEquals(null, obj)) return false;
            if (ReferenceEquals(this, obj)) return true;
            if (obj.GetType() != this.GetType()) return false;
            return Equals((MarkedEvent)obj);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                return ((Email != null ? Email.GetHashCode() : 0) * 397) ^ EventHashcode;
            }
        }

        public static bool operator ==(MarkedEvent left, MarkedEvent right)
        {
            return Equals(left, right);
        }

        public static bool operator !=(MarkedEvent left, MarkedEvent right)
        {
            return !Equals(left, right);
        }
    }
}
