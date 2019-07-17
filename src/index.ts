import AWS from 'aws-sdk';
import oauth from 'simple-oauth2';
import { WebClient } from '@slack/web-api';
import { getEventsForUser, CalendarEvent, ShowAs } from './services/calendar/calendar';
import { getAllUserSettings, getSettingsForUsers, upsertUserSettings } from './services/dynamo';
import { setUserStatus, setUserPresence } from './services/slack';
import { Handler } from 'aws-lambda';
import { InvocationRequest } from 'aws-sdk/clients/lambda';
import { getStatusForUserEvent } from './utils/map-event-status';
import { GraphApiAuthenticationProvider } from './services/calendar/graphApiAuthenticationProvider';
import config from '../config';
import { getSlackSecretWithKey } from './utils/secrets';
import { authorizeMicrosoftGraphUrl, createUserUrl } from './utils/urls';

type GetProfileResult = {
  email: string;
};

const getHighestPriorityEvent = (events: CalendarEvent[]) =>
  events.length ? events.sort((event1, event2) => event2.showAs - event1.showAs)[0] : null;

const microsoftAuthRedirect = (email: string) => ({
  statusCode: 301,
  headers: {
    Location: `https://login.microsoftonline.com/${config.microsoftGraph.tenantId}/oauth2/v2.0/authorize?client_id=${
      config.microsoftGraph.clientId
    }&response_type=code&redirect_uri=${authorizeMicrosoftGraphUrl()}&response_mode=query&scope=calendars.read&state=${email}`,
  },
});

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
      const userEvents = await getEventsForUser(us.email, us.calendarStoredToken);
      if (!userEvents) return;

      const relevantEvent = getHighestPriorityEvent(userEvents);

      const status = getStatusForUserEvent(us, relevantEvent);

      console.log(`Setting Slack status to ${status.text} with emoji ${status.emoji} for ${us.email}`);
      await setUserStatus(us.email, us.slackToken, status);

      const presence = relevantEvent && relevantEvent.showAs < ShowAs.Busy ? 'auto' : 'away';

      console.log(`Setting presence to '${presence}' for ${us.email}`);
      await setUserPresence(us.email, us.slackToken, presence);
    }),
  );
};

export const authorizeMicrosoftGraph: Handler = async (event: any) => {
  const {
    queryStringParameters: { code, state },
  } = event;
  const authProvider = new GraphApiAuthenticationProvider(state);
  await authProvider.getTokenWithAuthCode(code);

  return {
    statusCode: 301,
    headers: {
      Location: 'https://github.com/hudl/CalendarToSlack/wiki/Cal2Slack-Home',
    },
  };
};

export const slackInstall: Handler = async () => ({
  statusCode: 302,
  headers: {
    Location: `https://slack.com/oauth/authorize?client_id=${
      config.slack.clientId
    }&redirect_uri=${createUserUrl()}&scope=${encodeURIComponent(
      'users.profile:read,users.profile:write,users:write',
    )}`,
  },
});

export const createUser: Handler = async (event: any) => {
  const code = event.queryStringParameters.code;
  const clientId = config.slack.clientId;
  const clientSecret = await getSlackSecretWithKey('client-secret');

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
    redirect_uri: createUserUrl(),
  });
  const accessToken = oauthClient.accessToken.create(tokenResult);
  const tokenStr: string = accessToken.token.access_token;

  const slackClient = new WebClient(tokenStr);
  const authorizedUser = (await slackClient.users.profile.get()).profile as GetProfileResult;

  await upsertUserSettings({
    email: authorizedUser.email,
    slackToken: tokenStr,
  });

  return microsoftAuthRedirect(authorizedUser.email);
};
