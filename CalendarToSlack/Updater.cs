using System;
using System.Collections.Generic;
using System.Linq;
using System.Timers;
using log4net;
using Microsoft.Exchange.WebServices.Data;

namespace CalendarToSlack
{
    class Updater
    {
        private static readonly ILog Log = LogManager.GetLogger(typeof (Updater).Name);

        private readonly UserDatabase _userdb;
        private readonly MarkedEventDatabase _markdb;
        private readonly Calendar _calendar;
        private readonly Slack _slack;
        private readonly Timer _timer;

        private readonly object _updateLock = new { };

        private DateTime _lastCheck;

        // When we call MarkBack, we need to re-query the events for the user to see if
        // we should change them to a different status for another event going on. Rather
        // than re-querying exchange, let's just use the events we got on the last poll.
        // This'll take some query load off the exchange server.
        private Dictionary<string, List<CalendarEvent>> _eventsFromLastPoll;

        private static readonly Dictionary<LegacyFreeBusyStatus, string> StatusEmojiMap = new Dictionary<LegacyFreeBusyStatus, string>
        {
            { LegacyFreeBusyStatus.OOF, ":palm_tree:" },
            { LegacyFreeBusyStatus.Busy, ":spiral_calendar_pad:" },
            { LegacyFreeBusyStatus.NoData, ":spiral_calendar_pad:" }
        };

        public Updater(UserDatabase userdb, MarkedEventDatabase markdb, Calendar calendar, Slack slack)
        {
            _userdb = userdb;
            _markdb = markdb;
            _calendar = calendar;
            _slack = slack;
            
            _timer = new Timer
            {
                Enabled = false,
                AutoReset = true,
                Interval = 1000,
            };
            _timer.Elapsed += (_, __) => PollAndUpdateSlack();
        }

        public void Start()
        {
            CheckAllUsersAndUpdate();

            // Since we _just_ did an update, we can wait 1-2 minutes before we actually check
            // again via the poll. That's the reason for .AddMinutes(1) here. Helps avoid
            // back-to-back check/update calls if we happen to start up really close to :00.
            _lastCheck = CurrentMinuteWithSecondsTruncated().AddMinutes(1);

            Log.DebugFormat("Starting poll with last check time of {0}", _lastCheck);

            _timer.Start();
        }

        private DateTime CurrentMinuteWithSecondsTruncated()
        {
            var now = DateTime.UtcNow;
            return new DateTime(now.Ticks - (now.Ticks % TimeSpan.TicksPerMinute), now.Kind);
        }

        private void PollAndUpdateSlack()
        {
            // If we're a minute+ later than the last check, fire again.
            // This is a naive attempt to avoid drift (by checking every second and comparing time).
            if (DateTime.UtcNow >= _lastCheck.AddMinutes(1))
            {
                _lastCheck = CurrentMinuteWithSecondsTruncated();
                CheckAllUsersAndUpdate();
            }
        }

        private void CheckAllUsersAndUpdate()
        {
            lock (_updateLock)
            {
                var enabledUsers = _userdb.Users.Where(user => user.IsEnabled).ToList();

                var usernames = enabledUsers.Select(u => u.Email).ToList();
                var allEvents = _calendar.GetEventsHappeningNow(usernames);
                _eventsFromLastPoll = allEvents;

                foreach (var user in enabledUsers)
                {
                    var events = allEvents[user.Email];
                    CheckUserStatusAndUpdate(user, events);
                }
            }
        }

        private CalendarEvent GetBusiestEvent(RegisteredUser user, List<CalendarEvent> events)
        {
            var pruned = events.Where(ev => !_markdb.IsMarkedBack(user, ev)).ToList();

            if (!pruned.Any())
            {
                return null;
            }

            var status = GetBusiestStatus(pruned);
            return pruned.First(ev => ev.FreeBusyStatus == status);
        }

        public void MarkBack(string userid)
        {
            var user = _userdb.Users.FirstOrDefault(u => u.SlackUserInfo.UserId == userid);
            if (user == null)
            {
                Log.WarnFormat("No user with id {0} to mark /back", userid);
                return;
            }

            var eventToMark = user.CurrentEvent;
            if (eventToMark != null && !IsEligibleForMarkBack(eventToMark.FreeBusyStatus))
            {
                Log.DebugFormat("Not marking /back for ineligible event \"{0}\" with status {1}", eventToMark.Subject, eventToMark.FreeBusyStatus);
                return;
            }

            if (eventToMark == null)
            {
                Log.InfoFormat("Marking {0} /back (even though there's no current event)", user.SlackUserInfo.Username);
            }
            else
            {
                Log.InfoFormat("Marking {0} /back from \"{1}\"", user.SlackUserInfo.Username, eventToMark.Subject);
                _markdb.MarkBack(user, eventToMark);
            }
            
            // Since this happens off of the normal timer/poll loop, we lock around this
            // and within the timer callback. This helps avoid possible weirdness that could
            // happen if the user marks themselves /back right at the same time we're
            // attempting to update them on the normal interval.
            lock (_updateLock)
            {
                CheckUserStatusAndUpdate(user, _eventsFromLastPoll[user.Email]);
            }
        }

        private void CheckUserStatusAndUpdate(RegisteredUser user, List<CalendarEvent> events)
        {
            // Will return null if there are no events currently happening.
            var busiestEvent = GetBusiestEvent(user, events);
            var statusMessage = GetUserMessage(busiestEvent, user);
            var statusEmoji = GetEmojiForCalendarEvent(busiestEvent);

            var isDifferentMessage = (statusMessage != user.CurrentCustomMessage);

            // Only check if we've set a current event previously. Otherwise,
            // on the first check after startup, we don't "correct" the value
            // if the user became Free while this app was stopped.
            if (user.HasSetCurrentEvent && busiestEvent == user.CurrentEvent && !isDifferentMessage)
            {
                // User is still in the same event, no change.
                return;
            }

            var previousEvent = user.CurrentEvent;
            user.CurrentEvent = busiestEvent;
            user.CurrentCustomMessage = statusMessage;

            if (busiestEvent == null)
            {
                // Status changed to Free.
                Log.InfoFormat("{0} is now {1}", user.Email, Presence.Auto);
                var message = "Changed your status to Auto";
                if (previousEvent != null)
                {
                    message = $"{message} after finishing \"{previousEvent.Subject}\"";
                }
                else if (isDifferentMessage)
                {
                    message = $"{message} after your whitelist was updated";
                }
                MakeSlackApiCalls(user, Presence.Auto, "", "", message);
                return;
            }

            // Otherwise, we're transitioning into an event that's coming up (or just got added).

            var presenceToSet = GetPresenceForAvailability(busiestEvent.FreeBusyStatus);
            var withMessage = (string.IsNullOrWhiteSpace(statusMessage) && string.IsNullOrWhiteSpace(statusEmoji)) ? "(with no status)" :
                $"with status text \"{statusMessage}\" and emoji \"{statusEmoji}\"";
            var slackbotMessage = $"Changed your status to {presenceToSet} {withMessage} for \"{busiestEvent.Subject}\"";
            Log.InfoFormat("{0} is now {1} {2} for \"{3}\" (event status \"{4}\") ", user.Email, presenceToSet, withMessage, busiestEvent.Subject, busiestEvent.FreeBusyStatus);
            MakeSlackApiCalls(user, presenceToSet, statusMessage, statusEmoji, slackbotMessage);
        }

        private void MakeSlackApiCalls(RegisteredUser user, Presence presence, string statusMessage, string statusEmoji, string slackbotMessage)
        {
            if (user.SendSlackbotMessageOnChange)
            {
                _slack.PostSlackbotMessage(user.SlackApplicationAuthToken, user.SlackUserInfo.Username, slackbotMessage);
            }
            _slack.UpdateProfileWithStatus(user, statusMessage, statusEmoji);
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

        // Returns an empty string if the user should have no status message.
        private static string GetUserMessage(CalendarEvent ev, RegisteredUser user)
        {
            if (ev == null)
            {
                return string.Empty;
            }

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
                
                    // ReSharper disable RedundantCaseLabel - Not a fan of this RS check. Leaving these here to show intent (i.e. that they're explicitly and not accidentally considered "Away").
                case LegacyFreeBusyStatus.NoData:
                case LegacyFreeBusyStatus.Busy:
                default:
                    return filterMatch ?? "Away";
                    // ReSharper restore RedundantCaseLabel
            }
        }

        // Returns an empty string if the user should have no status emoji.
        private static string GetEmojiForCalendarEvent(CalendarEvent ev)
        {
            string statusEmoji;
            if (ev == null || !StatusEmojiMap.TryGetValue(ev.FreeBusyStatus, out statusEmoji))
            {
                statusEmoji = "";
            }

            return statusEmoji;
        }

        private static bool IsEligibleForMarkBack(LegacyFreeBusyStatus status)
        {
            // This is experimental, not sure if it's the best way to go. If you've got a day-long
            // WorkingElsewhere event, you likely don't want to be marked "back" from it. The "/back"
            // functionality is mainly for shorter events that end early, like meetings and other
            // appointments.
            switch (status)
            {
                case LegacyFreeBusyStatus.Free:

                // These are an assumption. There might be cases where someone has an OOO lunch
                // or other partial-day event and they _do_ want to mark themselves back, but I'm
                // erring on the side of these usually being day-long or multi-day vacation-style
                // events, for which "/back" isn't as applicable.
                case LegacyFreeBusyStatus.WorkingElsewhere:
                case LegacyFreeBusyStatus.OOF:
                    return false;
            }

            return true;
        }

        private static string MatchFilter(string subject, Dictionary<string, string> filters)
        {
            if (string.IsNullOrWhiteSpace(subject))
            {
                return null;
            }

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
}