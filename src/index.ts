import { getEventsForUser, CalendarEvent, ShowAs } from './services/calendar';
import { getAllUserSettings, getSettingsForUsers, upsertUserSettings } from './services/dynamo';
import { setUserStatus, setUserPresence } from './services/slack';
import AWS from 'aws-sdk';
import { Handler } from 'aws-lambda';
import { InvocationRequest } from 'aws-sdk/clients/lambda';
import { getStatusForUserEvent } from './utils/map-event-status';
import oauth from 'simple-oauth2';
import config from '../config';
import { getSecretWithKey } from './utils/secrets';
import { WebClient } from '@slack/web-api';

type GetProfileResult = {
  email: string;
};

const getHighestPriorityEvent = (events: CalendarEvent[]) => {
  // TODO: Implement this function to resolve the event to use for status updates from a list of user events
  return events.length ? events[0] : null;
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

      console.log(`Setting Slack status to ${status.text} with emoji ${status.emoji} for ${us.email}`);
      await setUserStatus(us.slackToken, status);

      const presence =
        relevantEvent && [ShowAs.Busy, ShowAs.OutOfOffice].includes(relevantEvent.showAs) ? 'away' : 'auto';

      console.log(`Setting presence to "${presence}" for ${us.email}`);
      await setUserPresence(us.slackToken, presence);
    }),
  );
};

export const slackInstall: Handler = async () => {
  return {
    statusCode: 302,
    headers: {
      Location: `https://slack.com/oauth/authorize?client_id=${config.slack.clientId}&scope=${encodeURIComponent(
        'users.profile:read,users.profile:write,users:write',
      )}`,
    },
  };
};

export const createUser: Handler = async (event: any) => {
  const code = event.queryStringParameters.code;
  const clientId = config.slack.clientId;
  const clientSecret = await getSecretWithKey('client-secret');

  const oauthClient = oauth.create({
    client: {
      id: clientId,
      secret: clientSecret,
    },
    auth: {
      tokenHost: 'https://slack.com',
      tokenPath: '/api/oauth.access',
    },
  });

  const tokenResult = await oauthClient.authorizationCode.getToken({
    code,
    redirect_uri: process.env.IS_OFFLINE ? 'http://localhost:3000/create-user' : 'IMPLEMENT_URL',
  });
  const accessToken = oauthClient.accessToken.create(tokenResult);
  const tokenStr: string = accessToken.token.access_token;

  const slackClient = new WebClient(tokenStr);
  const authorizedUser = (await slackClient.users.profile.get()).profile as GetProfileResult;

  await upsertUserSettings({ email: authorizedUser.email, slackToken: tokenStr });
};
