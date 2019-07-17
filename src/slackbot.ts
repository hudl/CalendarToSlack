import crypto from 'crypto';
import { getSlackSecretWithKey } from './utils/secrets';
import { getUserProfile, postMessage } from './services/slack';
import { getSettingsForUsers, upsertStatusMappings, UserSettings } from './services/dynamo';
import config from '../config';

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
  const requestTimestamp: number = +event.headers['X-Slack-Request-Timestamp'];
  if (!validateTimestamp(requestTimestamp)) {
    return false;
  }

  const signingSecret = await getSlackSecretWithKey('signing-secret');
  const hmac = crypto.createHmac('sha256', signingSecret);

  const requestSignature = event.headers['X-Slack-Signature'];
  const [version, slackHash] = requestSignature.split('=');

  const calculatedSignature = hmac.update(`${version}:${requestTimestamp}:${event.body}`).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(calculatedSignature, 'utf8'), Buffer.from(slackHash, 'utf8'));
}

function serializeStatusMappings(userSettings: UserSettings): string[] {
  if (userSettings.statusMappings) {
    const serialized = userSettings.statusMappings.map(
      m =>
        `\n${m.slackStatus.emoji} \`${m.calendarText}\` ${
          m.slackStatus.text ? 'uses status `' + m.slackStatus.text + '`' : ''
        }`
    );
    return serialized;
  }

  return [];
}

async function handleSlackEventCallback(event: SlackEventCallback): Promise<SlackResponse> {
  console.debug(JSON.stringify(event));
  if (event.event.type !== 'message' || event.event.channel_type !== 'im') {
    console.log(`Event type ${event.event.type}/${event.event.channel_type} is not handled by this version.`);
    return EMPTY_RESPONSE_BODY;
  }
  if (event.event.subtype === 'bot_message' || !event.event.user) {
    // ignore messages from self
    return EMPTY_RESPONSE_BODY;
  }

  const botToken = await getSlackSecretWithKey('bot-token');
  const sendMessage = async (message: string): Promise<SlackResponse> => {
    const ok = await postMessage(botToken, { text: message, channel: event.event.channel });
    return EMPTY_RESPONSE_BODY;
  }

  const userProfile = await getUserProfile(botToken, event.event.user);
  if (!userProfile) {
    return await sendMessage("Something went wrong fetching your user profile. Maybe try again?");
  }
  const userEmail = userProfile.email;

  const userSettings = await getSettingsForUsers([userEmail]);
  if (!userSettings.length || !userSettings[0].slackToken) {
    return await sendMessage(`Hello :wave:

You need to authorize me before we can do anything else: ${config.endpoints.slackInstall}`);
  }

  const command = event.event.text;
  const usersSettings = userSettings[0];
  if (/^\s*show/i.test(command)) {
    const serialized = serializeStatusMappings(usersSettings);
    if (serialized.length) {
      return await sendMessage(`Here's what I've got for you:${serialized}`);
    }

    return await sendMessage('You don\'t have any status mappings yet. Try `set`');
  }

  if (/^\s*set/i.test(command)) {
    const tokens = command.match(/[\w]+=[""][^""]+[""]|[^ """]+/g) || [];
    const defaults: {[prop:string]: string} = {meeting:'', message:'', emoji:''};
    for (let token of tokens) {
      const [ key, value ] = token.split('=');
      if (key in defaults) {
        defaults[key] = value;
      }
    }

    if (!defaults.meeting) {
      return await sendMessage("The `meeting` part can't be empty.");
    }

    if (!usersSettings.statusMappings) {
      usersSettings.statusMappings = [];
    }

    const existingMeeting = usersSettings.statusMappings.find(m => m.calendarText.toLowerCase() === defaults.meeting.toLowerCase());
    if (existingMeeting) {
      existingMeeting.slackStatus = {
        text: defaults.message,
        emoji: defaults.emoji
      };
    } else {
      usersSettings.statusMappings.push({
        calendarText: defaults.meeting,
        slackStatus: {
          text: defaults.message,
          emoji: defaults.emoji
        }
      });
    }

    const updated = await upsertStatusMappings(usersSettings);
    const serialized = serializeStatusMappings(updated);

    return await sendMessage(`Here's what I got: ${serialized}`);
  }

  return await sendMessage(`:shrug: Maybe try one of these:
  - \`help\`
  - \`show\`
  - \`set\`
  - \`remove\``);
}

export const handler = async (event: ApiGatewayEvent) => {
  let body = JSON.parse(event.body);

  if (!(await validateSlackRequest(event))) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Request was invalid' })
    };
  }

  let responseBody: SlackResponse;
  switch (body.type) {
    case 'url_verification':
      responseBody = { challenge: body.challenge };
      break;
    case 'event_callback':
      responseBody = await handleSlackEventCallback(body as SlackEventCallback);
      break;
    default:
      console.log('Event type not recognized: ' + body.type);
      console.log(event.body);
      responseBody = EMPTY_RESPONSE_BODY;
  }

  let response = {
    statusCode: 200,
    body: JSON.stringify(responseBody)
  };

  return response;
};
