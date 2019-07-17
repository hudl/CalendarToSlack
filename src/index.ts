import AWS from "aws-sdk";
import oauth from "simple-oauth2";
import { WebClient } from "@slack/web-api";
import {
  getEventsForUser,
  CalendarEvent,
  ShowAs
} from "./services/calendar/calendar";
import {
  getAllUserSettings,
  getSettingsForUsers,
  upsertUserSettings
} from "./services/dynamo";
import { setUserStatus, setUserPresence } from "./services/slack";
import { Handler } from "aws-lambda";
import { InvocationRequest } from "aws-sdk/clients/lambda";
import { getStatusForUserEvent } from "./utils/map-event-status";
import { GraphApiAuthenticationProvider } from "./services/calendar/graphApiAuthenticationProvider";
import config from "./config";
import { getSlackSecretWithKey } from "./utils/secrets";

type GetProfileResult = {
  email: string;
};

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
    apiVersion: "latest",
    region: "us-east-1",
    endpoint: process.env.IS_OFFLINE ? "http://localhost:3000" : undefined
  });

  const invokeParams: InvocationRequest = {
    FunctionName: "calendar2slack-prod-update-batch",
    InvocationType: "Event",
    LogType: "None"
  };

  const userSettings = await getAllUserSettings();
  for (var i = 0; i < userSettings.length; i += batchSize) {
    const batch = userSettings.slice(i, i + batchSize).map(us => us.email);

    lambda
      .invoke({ Payload: JSON.stringify({ emails: batch }), ...invokeParams })
      .send();
  }
};

export const updateBatch: Handler = async (event: any) => {
  const userSettings = await getSettingsForUsers(event.emails);

  await Promise.all(
    userSettings.map(async us => {
      const userEvents = await getEventsForUser(us.email);
      const relevantEvent = getHighestPriorityEvent(userEvents);

      const status = getStatusForUserEvent(us, relevantEvent);

      console.log(
        `Setting Slack status to ${status.text} with emoji ${
          status.emoji
        } for ${us.email}`
      );
      await setUserStatus(us.slackToken, status);

      const presence =
        relevantEvent &&
        [ShowAs.Busy, ShowAs.OutOfOffice].includes(relevantEvent.showAs)
          ? "away"
          : "auto";

      console.log(`Setting presence to '${presence}' for ${us.email}`);
      await setUserPresence(us.slackToken, presence);
    })
  );
};

export const authorizeMicrosoftGraph: Handler = async (event: any) => {
  const {
    queryStringParameters: { code, state }
  } = event;
  const authProvider = new GraphApiAuthenticationProvider(state);
  await authProvider.getTokenWithAuthCode(code);
};

const microsoftAuthRedirect = (email: string) => {
  const redirectUri = process.env.IS_OFFLINE
    ? "http://localhost:3000/authorize-microsoft-graph"
    : config.endpoints.authorizeMicrosoftGraph;
  return {
    statusCode: 301,
    headers: {
      Location: `https://login.microsoftonline.com/${
        config.microsoftGraph.tenantId
      }/oauth2/v2.0/authorize?client_id=${
        config.microsoftGraph.clientId
      }&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=calendars.read&state=${email}`
    }
  };
};

export const slackInstall: Handler = async () => {
  return {
    statusCode: 302,
    headers: {
      Location: `https://slack.com/oauth/authorize?client_id=${
        config.slack.clientId
      }&scope=${encodeURIComponent(
        "users.profile:read,users.profile:write,users:write"
      )}`
    }
  };
};

export const createUser: Handler = async (event: any) => {
  const code = event.queryStringParameters.code;
  const clientId = config.slack.clientId;
  const clientSecret = await getSlackSecretWithKey("client-secret");

  const oauthClient = oauth.create({
    client: {
      id: clientId,
      secret: clientSecret
    },
    auth: {
      tokenHost: "https://slack.com",
      tokenPath: "/api/oauth.access"
    }
  });

  const tokenResult = await oauthClient.authorizationCode.getToken({
    code,
    redirect_uri: process.env.IS_OFFLINE
      ? "http://localhost:3000/create-user"
      : config.endpoints.createUser
  });
  const accessToken = oauthClient.accessToken.create(tokenResult);
  const tokenStr: string = accessToken.token.access_token;

  const slackClient = new WebClient(tokenStr);
  const authorizedUser = (await slackClient.users.profile.get())
    .profile as GetProfileResult;

  await upsertUserSettings({
    email: authorizedUser.email,
    slackToken: tokenStr
  });

  const redirect = microsoftAuthRedirect(authorizedUser.email);
  console.log(redirect);
  return redirect;
};
