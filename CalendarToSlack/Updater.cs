using System;
using System.Collections.Generic;
using System.Linq;
using System.Timers;
using Amazon.SQS.Model;
using Microsoft.Exchange.WebServices.Data;

namespace CalendarToSlack
{
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

                var enabledUsers = _userdb.Users.Where(user => user.IsEnabled).ToList();

                var usernames = enabledUsers.Select(u => u.Email).ToList();
                var allEvents = _calendar.GetEventsHappeningNow(usernames);

                foreach (var user in enabledUsers)
                {
                    var events = allEvents[user.Email];
                    CheckUserStatusAndUpdate(user, events);
                }
            }
        }

        private CalendarEvent GetBusiestEvent(List<CalendarEvent> events)
        {
            var pruned = events.Where(ev => !_userdb.IsMarkedBack(ev)).ToList();

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
                Console.WriteLine("WARN: No user with id {0} to mark back", userid);
                return;
            }

            var eventToMark = user.CurrentEvent;
            if (eventToMark == null)
            {
                Console.WriteLine("INFO: Received 'back' message, but no current calendar event to mark");
                // They're not in an event, nothing to mark.
                return;
            }

            if (!IsEligibleForMarkBack(eventToMark.FreeBusyStatus))
            {
                Console.WriteLine("INFO: Not marking 'back' for ineligible event {0} with status {1}", eventToMark.Subject, eventToMark.FreeBusyStatus);
                return;
            }

            Console.WriteLine("Marking {0} 'back' from {1}", user.SlackUserInfo.Username, eventToMark.Subject);
            _userdb.MarkBack(eventToMark);
            // For now, we'll wait until the next minute, where CheckUserStatusAndUpdate() will
            // realize we've added this event and it'll omit it. If we need more responsiveness,
            // a call to CheckUserStatusAndUpdate() could be forced here. Just didn't want to
            // re-query exchange too frequently.
            // 
            // Also note: if we force the re-update here, consider adding a lock to help avoid
            // situations where the "/busy" came on the :00 of the minute and the updater
            // is already running.
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

            var previousEvent = user.CurrentEvent;
            user.CurrentEvent = busiestEvent;

            if (busiestEvent == null)
            {
                // Status changed to Free.
                Out.WriteStatus("{0} is now {1}", user.Email, Presence.Auto);
                var message = "Changed your status to Auto";
                if (previousEvent != null)
                {
                    message = string.Format("{0} after finishing \"{1}\"", message, previousEvent.Subject);
                }
                MakeSlackApiCalls(user, Presence.Auto, null, message);
                return;
            }

            // Otherwise, we're transitioning into an event that's coming up (or just got added).

            var presenceToSet = GetPresenceForAvailability(busiestEvent.FreeBusyStatus);
            var statusMessage = GetUserMessage(busiestEvent, user);
            var withMessage = (string.IsNullOrWhiteSpace(statusMessage) ? "(with no message)" : string.Format("(with message \"| {0}\")", statusMessage));
            var slackbotMessage = string.Format("Changed your status to {0} {1} for \"{2}\"", presenceToSet, withMessage, busiestEvent.Subject);
            Out.WriteStatus("{0} is now {1} ({2}) for \"{3}\" ({4}) ", user.Email, presenceToSet, statusMessage, busiestEvent.Subject, busiestEvent.FreeBusyStatus);
            MakeSlackApiCalls(user, presenceToSet, statusMessage, slackbotMessage);
        }

        private void MakeSlackApiCalls(RegisteredUser user, Presence presence, string statusMessage, string slackbotMessage)
        {
            if (user.SendSlackbotMessageOnChange)
            {
                _slack.PostSlackbotMessage(user.SlackApplicationAuthToken, user.SlackUserInfo.Username, slackbotMessage);
            }
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

        // Returns null if the user shoudl have no status message.
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
                
                    // ReSharper disable RedundantCaseLabel - Not a fan of this RS check. Leaving these here to show intent (i.e. that they're explicitly and not accidentally considered "Away").
                case LegacyFreeBusyStatus.NoData:
                case LegacyFreeBusyStatus.Busy:
                default:
                    return filterMatch ?? "Away";
                    // ReSharper restore RedundantCaseLabel
            }
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