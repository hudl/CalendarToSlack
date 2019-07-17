import { getEventsForUser, CalendarEvent } from './services/calendar';
import { getAllUserSettings, getSettingsForUsers } from './services/dynamo';
import { setSlackStatus } from './services/slack';
import AWS from 'aws-sdk';
import { Handler } from 'aws-lambda';
import { InvocationRequest } from 'aws-sdk/clients/lambda';
import { getStatusForUserEvent } from './utils/map-event-status';

const getHighestPriorityEvent = (events: CalendarEvent[]) => {
  const now: Date = new Date();
  const ninetySecondsFromNow: Date = new Date();
  ninetySecondsFromNow.setSeconds(ninetySecondsFromNow.getSeconds() + 90);

  const eventsHappeningNow: CalendarEvent[] = events
    .filter(e => e.startDate <= ninetySecondsFromNow && now < e.endDate)
    .sort((event1, event2) => event2.showAs - event1.showAs);
  return eventsHappeningNow.length ? eventsHappeningNow[0] : null;
};

export const update: Handler = async () => {
  const batchSize = 10;

  const lambda = new AWS.Lambda({
    apiVersion: 'latest',
    region: 'us-east-1',
    endpoint: process.env.IS_OFFLINE ? 'http://localhost:3000' : undefined,
  });

  const invokeParams: InvocationRequest = {
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
