import { getEventsForUser, CalendarEvent } from './services/calendar';
import { getAllUserSettings, UserSettings } from './services/dynamo';
import { setSlackStatus, SlackStatus } from './services/slack';

const getHighestPriorityEvent = (events: CalendarEvent[]) => {
  // TODO: Implement this function to resolve the event to use for status updates from a list of user events
  return events.length ? events[0] : null;
};

const getStatusForUserEvent = (settings: UserSettings, event: CalendarEvent | null): SlackStatus => {
  const defaultAwayStatus = {
    text: 'Away',
    emoji: ':spiral_calendar_pad:',
  };

  if (!settings.statusMappings) return defaultAwayStatus;

  if (!event) return settings.defaultStatus || { text: '', emoji: '' };

  // TODO: Implement here to get the status from a user's statusMappings for a specific calendar event
  return defaultAwayStatus;
};

export const handler = async (event: any) => {
  const userSettings = await getAllUserSettings();

  // TODO: Consider replacing this with code to start a separate lambda that runs for a smaller batch of users, depending on timing
  await Promise.all(
    userSettings.map(async us => {
      const userEvents = await getEventsForUser(us.email);
      const relevantEvent = getHighestPriorityEvent(userEvents);

      const status = getStatusForUserEvent(us, relevantEvent);

      await setSlackStatus(us.email, us.slackToken, status);
    }),
  );
};
