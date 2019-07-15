import { getEventsForUser, CalendarEvent } from './services/calendar';
import { getAllUserSettings, UserSettings, getSettingsForUsers } from './services/dynamo';
import { setSlackStatus, SlackStatus } from './services/slack';
import AWS from 'aws-sdk';
import { Handler } from 'aws-lambda';

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

export const update: Handler = async () => {
  const batchSize = 10;

  const lambda = new AWS.Lambda({
    apiVersion: 'latest',
    region: 'us-east-1',
    endpoint: process.env.IS_OFFLINE ? 'http://localhost:3000' : undefined,
  });

  const invokeParams = {
    FunctionName: 'calendar2slack-prod-update-batch',
    InvocationType: 'Event',
    LogType: 'None',
  };

  const userSettings = await getAllUserSettings();
  for (var i = 0; i < userSettings.length; i += batchSize) {
    const batch = userSettings.slice(i, i + batchSize).map(us => us.email);

    lambda.invoke({ Payload: JSON.stringify({ emails: batch }), ...invokeParams }).send();
  }
};

export const updateBatch: Handler = async (event: any) => {
  const userSettings = await getSettingsForUsers(event.emails);

  await Promise.all(
    userSettings.map(async us => {
      const userEvents = await getEventsForUser(us.email);
      const relevantEvent = getHighestPriorityEvent(userEvents);

      const status = getStatusForUserEvent(us, relevantEvent);

      await setSlackStatus(us.email, us.slackToken, status);
    }),
  );
};
