import { Handler } from 'aws-lambda';
import {
  getSettingsForUsers,
  upsertCurrentEvent,
  removeCurrentEvent,
  UserSettings,
  setLastReminderEventId,
} from '../services/dynamo';
import { getEventsForUser, ShowAs, CalendarEvent } from '../services/calendar';
import { getSlackSecretWithKey } from '../services/secretsManager';
import { getUserByEmail, setUserStatus, setUserPresence, postMessage, SlackUser } from '../services/slack';
import { getStatusForUserEvent } from '../utils/mapEventStatus';
import { getUpcomingEventMessage } from '../utils/eventReminders';

const getHighestPriorityEvent = (events: CalendarEvent[]) =>
  events.length
    ? events.sort(
        (event1, event2) => event2.showAs - event1.showAs || event2.startTime.getTime() - event1.startTime.getTime(),
      )[0]
    : null;

const areEventsDifferent = (e1: CalendarEvent | undefined, e2: CalendarEvent | null) =>
  (!e1 && e2) || (e1 && !e2) || (e1 && e2 && e1.id !== e2.id);

const sendUpcomingEventMessage = async (
  token: string,
  user: SlackUser,
  event: CalendarEvent | null,
  settings: UserSettings,
) => {
  if (!event || !user) return;

  const message = getUpcomingEventMessage(event, settings);
  if (!message) return;

  await postMessage(token, { text: message, channel: user.id });
  await setLastReminderEventId(settings.email, event.id);
};

const updateBatch: Handler = async (event: any) => {
  const userSettings = await getSettingsForUsers(event.emails);

  await Promise.all(userSettings.map(updateOne));
};

export const updateOne = async (us: UserSettings) => {
  const userEvents = await getEventsForUser(us.email, us.calendarStoredToken);
  if (!userEvents) return;

  const relevantEvent = getHighestPriorityEvent(userEvents);

  let reminderEvent = relevantEvent;
  if (us.meetingReminderTimingOverride && us.meetingReminderTimingOverride > 1) {
    const upcomingEvents = await getEventsForUser(us.email, us.calendarStoredToken, us.meetingReminderTimingOverride);
    reminderEvent = getHighestPriorityEvent(upcomingEvents || []);
  }

  const shouldUpdateSlackStatus = areEventsDifferent(us.currentEvent, relevantEvent);
  const shouldSendReminder = reminderEvent && reminderEvent.id !== us.lastReminderEventId;

  if (!shouldUpdateSlackStatus && !shouldSendReminder) return;

  const botToken = await getSlackSecretWithKey('bot-token');
  const user = await getUserByEmail(botToken, us.email);

  if (!user) return;

  const status = getStatusForUserEvent(us, relevantEvent, user.tz);
  const presence = relevantEvent && relevantEvent.showAs > ShowAs.Tentative ? 'away' : 'auto';

  const promises: Promise<UserSettings | void>[] = [];
  if (shouldUpdateSlackStatus) {
    promises.push(
      setUserStatus(us.email, us.slackToken, status),
      setUserPresence(us.email, us.slackToken, presence),
      relevantEvent ? upsertCurrentEvent(us.email, relevantEvent) : removeCurrentEvent(us.email),
    );
  }

  if (shouldSendReminder) {
    promises.push(sendUpcomingEventMessage(botToken, user, reminderEvent, us));
  }

  await Promise.all(promises);
};

export default updateBatch;
