import AWS from 'aws-sdk';
import { getEventsForUser, CalendarEvent } from './services/calendar/calendar';
import { setSlackStatus } from './services/slack';
import { getAllUserSettings, getSettingsForUsers } from './services/dynamo';
import { Handler } from 'aws-lambda';
import { InvocationRequest } from 'aws-sdk/clients/lambda';
import { getStatusForUserEvent } from './utils/map-event-status';
import { GraphApiAuthenticationProvider } from "./services/calendar/graphApiAuthenticationProvider";

const getHighestPriorityEvent = (events: CalendarEvent[]) => {
  const now: Date = new Date();
  const ninetySecondsFromNow: Date = new Date();
  ninetySecondsFromNow.setSeconds(ninetySecondsFromNow.getSeconds() + 90);

  const eventsHappeningNow: CalendarEvent[] = events
    .filter(e => e.startTime <= ninetySecondsFromNow && now < e.endTime)
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

export const authorizeMicrosoftGraph: Handler = async (event: any) => {
  const { queryStringParameters: { code, state } } = event;
  const authProvider = new GraphApiAuthenticationProvider(state);
  await authProvider.getTokenWithAuthCode(code);
};
