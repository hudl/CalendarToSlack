import {InvokeCommand, LambdaClient} from '@aws-sdk/client-lambda';
import { AuthorizationCode } from 'simple-oauth2';
import {LogLevel, WebClient} from '@slack/web-api';
import {CalendarEvent, getEventsForUser, ShowAs} from './services/calendar';
import {
  getAllUserSettings,
  getSettingsForUsers,
  removeCurrentEvent,
  setLastReminderEventId,
  upsertCurrentEvent,
  upsertSlackToken,
  UserSettings,
} from './services/dynamo';
import {getUserByEmail, postMessage, setUserPresence, setUserStatus, SlackUser} from './services/slack';
import {Handler} from 'aws-lambda';
import {getStatusForUserEvent} from './utils/mapEventStatus';
import {GraphApiAuthenticationProvider} from './services/calendar/graphApiAuthenticationProvider';
import config from '../config';
import {getSlackSecretWithKey} from './utils/secrets';
import {authorizeMicrosoftGraphUrl, createUserUrl} from './utils/urls';
import {getUpcomingEventMessage} from './utils/eventHelper';

const getHighestPriorityEvent = (events: CalendarEvent[]) =>
  events.length
    ? events.sort(
        (event1, event2) => event2.showAs - event1.showAs || event2.startTime.getTime() - event1.startTime.getTime(),
      )[0]
    : null;

const microsoftAuthRedirect = (email: string) => ({
  statusCode: 301,
  headers: {
    Location: `https://login.microsoftonline.com/${config.microsoftGraph.tenantId}/oauth2/v2.0/authorize?client_id=${
      config.microsoftGraph.clientId
    }&response_type=code&redirect_uri=${authorizeMicrosoftGraphUrl()}&response_mode=query&scope=calendars.read&state=${email}`,
  },
});

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

export const update: Handler = async () => {
  const batchSize = 10;

  const lambda = new LambdaClient({
    apiVersion: 'latest',
    region: config.region,
    endpoint: process.env.IS_OFFLINE ? config.hosts.dev : undefined,
  });

  const userSettings = await getAllUserSettings();

  for (var i = 0; i < userSettings.length; i += batchSize) {
    const batch = userSettings.slice(i, i + batchSize).map((us) => us.email);
    const command = new InvokeCommand({
      FunctionName: 'calendar2slack-prod-update-batch',
      InvocationType: 'Event',
      LogType: process.env.IS_OFFLINE ? 'Tail' : 'None',
      Payload: JSON.stringify({ emails: batch }),
    });
    await lambda.send(command);
  }
};

export const updateBatch: Handler = async (event: any) => {
  const userSettings = await getSettingsForUsers(event?.emails ?? []);

  await Promise.all(userSettings.map(updateOne));
};

export const updateOne = async (us: UserSettings) => {
  if (us.snoozed) return;

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

export const authorizeMicrosoftGraph: Handler = async (event: any) => {
  if (!event.queryStringParameters || !event.queryStringParameters.code || !event.queryStringParameters.state) {
    console.error('Invalid request to Microsoft Graph authorization endpoint', event);
    return {
      statusCode: 400,
      body: 'Invalid request to Microsoft Graph authorization endpoint.',
    };
  }

  const {
    queryStringParameters: { code, state },
  } = event;
  const authProvider = new GraphApiAuthenticationProvider(state);
  await authProvider.getTokenWithAuthCode(code);

  return {
    statusCode: 301,
    headers: {
      Location: 'https://github.com/hudl/CalendarToSlack/wiki',
    },
  };
};

export const slackInstall: Handler = async () => ({
  statusCode: 302,
  headers: {
    Location: `https://slack.com/oauth/authorize?client_id=${
      config.slack.clientId
    }&redirect_uri=${createUserUrl()}&scope=${encodeURIComponent(
      'users.profile:read,users.profile:write,users:write,users:read,users:read.email',
    )}`,
  },
});

export const createUser: Handler = async (event: any) => {
  if (!event.queryStringParameters || !event.queryStringParameters.code) {
    console.error('Invalid request to Create User endpoint', event);
    return {
      statusCode: 400,
      body: 'Invalid request to Create User endpoint.',
    };
  }

  const code = event.queryStringParameters.code;
  const clientId = config.slack.clientId;
  const clientSecret = await getSlackSecretWithKey('client-secret');

  const oauthConfig = {
    client: {
      id: clientId,
      secret: clientSecret,
    },
    auth: {
      tokenHost: 'https://slack.com',
      tokenPath: '/api/oauth.access',
    },
  };
  const oauthClient = new AuthorizationCode(oauthConfig);

  const tokenResult = await oauthClient.getToken({
    code,
    redirect_uri: createUserUrl()
  });
  const tokenStr: string = tokenResult.token.access_token as string;
  const user: string = tokenResult.token.user_id as string;
  console.log(tokenResult.token);

  const slackClient = new WebClient(tokenStr);
  const userInfo = await slackClient.users.info({ token: tokenStr, user: user })

  console.log(userInfo);

  if (userInfo.error) {
    console.error('Error getting profile from Slack', userInfo.error);
    return {
      statusCode: 400,
      body: 'Error getting profile from Slack.',
    };
  }

  if (!userInfo.user || !userInfo.user.profile || !userInfo.user.profile.email) {
    console.error('No email returned from Slack', userInfo);
    return {
      statusCode: 400,
      body: 'No email returned from Slack.',
    };
  }

  const { email } = userInfo.user.profile;

  await upsertSlackToken(email, tokenStr);

  return microsoftAuthRedirect(email);
};
