import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import { getSecretWithKey } from "./utils/secrets";
import { getSettingsForUsers } from "./services/dynamo";
import config from "../config";

const MILLIS_IN_SEC = 1000;
const FIVE_MIN_IN_SEC = 300;
const EMPTY_RESPONSE_BODY = {};

type ApiGatewayEvent = {
  headers: {
    [header: string]: string;
  };
  body: string;
};

type SlackEvent = {
  client_msg_id: string;
  type: string;
  subtype?: string;
  text: string;
  user?: string;
  ts: string;
  team: string;
  channel: string;
  event_ts: string;
  channel_type: string;
};

type SlackEventCallback = {
  token: string;
  team_id: string;
  api_app_id: string;
  event: SlackEvent;
  type: string;
  event_id: string;
  event_time: number;
  authed_users: Array<string>;
};

interface SlackResponse {}

function validateTimestamp(slackRequestTimestampInSec: number): boolean {
  const currentTimeInSec = Math.floor(new Date().getTime() / MILLIS_IN_SEC);
  return Math.abs(currentTimeInSec - slackRequestTimestampInSec) < FIVE_MIN_IN_SEC;
}

async function validateSlackRequest(event: ApiGatewayEvent): Promise<boolean> {
  const requestTimestamp: number = +event.headers["X-Slack-Request-Timestamp"];
  if (!validateTimestamp(requestTimestamp)) {
    return false;
  }

  const signingSecret = await getSecretWithKey("signing-secret");
  const hmac = crypto.createHmac("sha256", signingSecret);

  const requestSignature = event.headers["X-Slack-Signature"];
  const [version, slackHash] = requestSignature.split("=");

  const calculatedSignature = hmac.update(`${version}:${requestTimestamp}:${event.body}`).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(calculatedSignature, "utf8"), Buffer.from(slackHash, "utf8"));
}

async function handleSlackEventCallback(event: SlackEventCallback): Promise<SlackResponse> {
  console.debug(JSON.stringify(event));
  if (event.event.type !== "message" || event.event.channel_type !== "im") {
    console.log(`Event type ${event.event.type}/${event.event.channel_type} is not handled by this version.`);
    return EMPTY_RESPONSE_BODY;
  }
  if (event.event.subtype === "bot_message" || !event.event.user) {
    // ignore messages from self
    return EMPTY_RESPONSE_BODY;
  }

  const botToken = await getSecretWithKey("bot-token");
  const slackWeb = new WebClient(botToken);

  const response: any = await slackWeb.users.info({ user: event.event.user });
  const userEmail = response.user.profile.email;
  const userSettings = await getSettingsForUsers([userEmail]);
  if (!userSettings.length || !userSettings[0].slackToken) {
    await slackWeb.chat.postMessage({
      text: `Hello :wave:

You need to authorize me before we can do anything else: ${config.endpoints.slackInstall}`,
      channel: event.event.channel
    });

    return EMPTY_RESPONSE_BODY;
  }

  const command = event.event.text;
  const usersSettings = userSettings[0];
  if (/^\s*show/i.test(command)) {
    let message = "You don't have any status mappings yet. Try `set`";
    if (usersSettings.statusMappings) {
      const serialized = usersSettings.statusMappings.map(
        m =>
          `\n${m.slackStatus.emoji} \`${m.calendarText}\` ${
            m.slackStatus.text ? "uses status `" + m.slackStatus.text + "`" : ""
          }`
      );
      message = `Here's what I've got for you:${serialized}`;
    }

    await slackWeb.chat.postMessage({
      text: message,
      channel: event.event.channel
    });

    return EMPTY_RESPONSE_BODY;
  }

  await slackWeb.chat.postMessage({
    text: `:shrug: Maybe try one of these:
- \`show\``,
    channel: event.event.channel
  });

  return EMPTY_RESPONSE_BODY;
}

export const handler = async (event: ApiGatewayEvent) => {
  let body = JSON.parse(event.body);

  if (!(await validateSlackRequest(event))) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Request was invalid" })
    };
  }

  let responseBody: SlackResponse;
  switch (body.type) {
    case "url_verification":
      responseBody = { challenge: body.challenge };
      break;
    case "event_callback":
      responseBody = await handleSlackEventCallback(body as SlackEventCallback);
      break;
    default:
      console.log("Event type not recognized: " + body.type);
      console.log(event.body);
      responseBody = EMPTY_RESPONSE_BODY;
  }

  let response = {
    statusCode: 200,
    body: JSON.stringify(responseBody)
  };

  return response;
};
