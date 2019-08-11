import crypto from 'crypto';
import { getSlackSecretWithKey } from './utils/secrets';
import { getUserInfo, postMessage, setUserStatus } from './services/slack';
import {
  getSettingsForUsers,
  upsertStatusMappings,
  UserSettings,
  upsertDefaultStatus,
  removeDefaultStatus,
  setZoomLinksDisabled,
} from './services/dynamo';
import { slackInstallUrl } from './utils/urls';

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

type CalendarCommandArguments = {
  meeting?: string;
  message?: string;
  emoji?: string;
};

type SettingsCommandArguments = {
  zoomLinksEnabled?: boolean;
};

interface SlackResponse {}

const validateTimestamp = (slackRequestTimestampInSec: number): boolean => {
  const currentTimeInSec = Math.floor(new Date().getTime() / MILLIS_IN_SEC);
  return Math.abs(currentTimeInSec - slackRequestTimestampInSec) < FIVE_MIN_IN_SEC;
};

const validateSlackRequest = async (event: ApiGatewayEvent): Promise<boolean> => {
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
};

const serializeStatusMappings = (userSettings: UserSettings): string[] => {
  if (userSettings.statusMappings) {
    const serialized = userSettings.statusMappings.map(
      m =>
        `\n${m.slackStatus.emoji || ':transparent:'} \`${m.calendarText}\` ${
          m.slackStatus.text ? 'uses status `' + m.slackStatus.text + '`' : ''
        }`,
    );
    return serialized;
  }

  return [];
};

const constructCalendarCommandArgs = (argList: string[]): CalendarCommandArguments => {
  const args: { [key: string]: string } = { meeting: '', message: '', emoji: '' };

  for (let arg of argList) {
    const [key, value] = arg.split('=');
    if (key in args) {
      args[key] = value.replace(/["”“]/g, '');
    }
  }

  return {
    meeting: args['meeting'],
    message: args['message'],
    emoji: args['emoji'],
  };
};

const constructSettingsCommandArgs = (argList: string[]): SettingsCommandArguments => {
  const args: { [key: string]: string } = { 'zoom-links': '' };

  for (let arg of argList) {
    const [key, value] = arg.split('=');
    if (key in args) {
      args[key] = value.replace(/["”“]/g, '');
    }
  }

  return {
    zoomLinksEnabled: args['zoom-links'].length ? args['zoom-links'] === 'true' : undefined,
  };
};

const handleHelp = async (): Promise<string> => {
  return ':information_desk_person: Please visit https://github.com/hudl/CalendarToSlack/wiki for more information on how to use this app!';
};

const handleShow = async (userSettings: UserSettings): Promise<string> => {
  const serialized = serializeStatusMappings(userSettings);
  if (serialized.length) {
    return `Here's what I've got for you:${serialized}`;
  }

  return "You don't have any status mappings yet. Try `set`";
};

const handleSet = async (userSettings: UserSettings, argList: string[]): Promise<string> => {
  const args = constructCalendarCommandArgs(argList);
  if (!args.meeting) {
    return `You must specify a meeting using \`meeting="My Meeting"\`.`;
  }

  const slackStatus = {
    text: args.message || args.meeting,
    emoji: args.emoji,
  };

  const updatedMappings = userSettings.statusMappings || [];
  const existingMapping = updatedMappings.find(
    m => args.meeting && m.calendarText.toLowerCase() === args.meeting.toLowerCase(),
  );

  if (existingMapping) {
    existingMapping.slackStatus = slackStatus;
  } else {
    updatedMappings.push({ calendarText: args.meeting, slackStatus });
  }

  const slackPromise =
    userSettings.currentEvent && userSettings.currentEvent.name.toLowerCase().includes(args.meeting.toLowerCase())
      ? setUserStatus(userSettings.email, userSettings.slackToken, slackStatus)
      : Promise.resolve();

  const updateResult = await Promise.all([upsertStatusMappings(userSettings.email, updatedMappings), slackPromise]);
  const serialized = serializeStatusMappings(updateResult[0]);

  return `Added! Here's what I got: ${serialized}`;
};

const handleRemove = async (userSettings: UserSettings, argList: string[]): Promise<string> => {
  const args = constructCalendarCommandArgs(argList);
  if (!args.meeting) {
    return `You must specify a meeting using \`meeting="My Meeting"\`.`;
  }

  if (!userSettings.statusMappings) {
    userSettings.statusMappings = [];
  }

  const filteredMappings = userSettings.statusMappings.filter(
    sm => !args.meeting || sm.calendarText.toLowerCase() !== args.meeting.toLowerCase(),
  );

  const updated = await upsertStatusMappings(userSettings.email, filteredMappings);
  const serialized = serializeStatusMappings(updated);

  return `Removed! Here's what I got: ${serialized}`;
};

const handleSetDefault = async (userSettings: UserSettings, argList: string[]): Promise<string> => {
  const args = constructCalendarCommandArgs(argList);
  const { message, emoji } = args;

  if (!message && !emoji) {
    return 'Please set a default `message` and/or `emoji`.';
  }

  const slackStatus = { text: message, emoji };

  const slackPromise = !userSettings.currentEvent
    ? setUserStatus(userSettings.email, userSettings.slackToken, slackStatus)
    : Promise.resolve();

  await Promise.all([upsertDefaultStatus(userSettings.email, slackStatus), slackPromise]);

  const emojiString = emoji ? ` ${emoji}` : '';
  const messageString = message ? ` \`${message}\`` : '';

  return `Your default status is${emojiString}${messageString}.`;
};

const handleRemoveDefault = async (userSettings: UserSettings): Promise<string> => {
  const slackPromise = !userSettings.currentEvent
    ? setUserStatus(userSettings.email, userSettings.slackToken, { text: '', emoji: '' })
    : Promise.resolve();

  await Promise.all([removeDefaultStatus(userSettings.email), slackPromise]);

  return 'Your default status has been removed.';
};

const handleUpdateSettings = async (userSettings: UserSettings, argList: string[]): Promise<string> => {
  const args = constructSettingsCommandArgs(argList);

  if (args.zoomLinksEnabled !== undefined) {
    await setZoomLinksDisabled(userSettings.email, !args.zoomLinksEnabled);
  }

  // TODO: Once more settings are present, change this to echo their settings
  return 'Your settings have been updated.';
};

const commandHandlerMap: {
  [command: string]: (userSettings: UserSettings, argList: string[]) => Promise<string>;
} = {
  help: handleHelp,
  show: handleShow,
  set: handleSet,
  remove: handleRemove,
  'set-default': handleSetDefault,
  'remove-default': handleRemoveDefault,
  settings: handleUpdateSettings,
};

const handleSlackEventCallback = async ({
  event: { type, subtype, channel, channel_type, user, text },
}: SlackEventCallback): Promise<SlackResponse> => {
  if (type !== 'message' || channel_type !== 'im') {
    console.log(`Event type ${type}/${channel_type} is not handled by this version.`);
    return EMPTY_RESPONSE_BODY;
  }

  if (subtype === 'bot_message' || !user) {
    // ignore messages from self
    return EMPTY_RESPONSE_BODY;
  }

  const botToken = await getSlackSecretWithKey('bot-token');
  const sendMessage = async (message: string): Promise<SlackResponse> => {
    await postMessage(botToken, { text: message, channel });

    return EMPTY_RESPONSE_BODY;
  };

  const userProfile = await getUserInfo(botToken, user);
  if (!userProfile) {
    return await sendMessage('Something went wrong fetching your user profile. Maybe try again?');
  }

  const userEmail = userProfile.email;
  const userSettings = await getSettingsForUsers([userEmail]);

  if (!userSettings.length || !userSettings[0].slackToken) {
    return await sendMessage(`Hello :wave:

You need to authorize me before we can do anything else: ${slackInstallUrl()}`);
  }

  const command = text;
  const tokens = command.match(/[\w]+=["“][^"”]+["”]|[^ "“”]+/g) || [];
  const subcommand = tokens[0];
  const args = tokens.slice(1);

  if (subcommand in commandHandlerMap) {
    const message = await commandHandlerMap[subcommand](userSettings[0], args);
    return await sendMessage(message);
  }

  return await sendMessage(`:shrug: Maybe try one of these:
  - \`help\`
  - \`show\`
  - \`set\`
  - \`set-default\`
  - \`remove\`
  - \`remove-default\``);
};

export const handler = async (event: ApiGatewayEvent) => {
  let body = JSON.parse(event.body);

  if (!(await validateSlackRequest(event))) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Request was invalid' }),
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
    body: JSON.stringify(responseBody),
  };

  return response;
};
