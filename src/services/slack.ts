import { WebClient, ChatPostMessageArguments, ErrorCode, WebAPICallError, WebAPIPlatformError } from '@slack/web-api';
import { clearUserTokens } from './dynamo';
import { getSlackSecretWithKey } from '../utils/secrets';
import { slackInstallUrl } from '../utils/urls';

export type SlackStatus = {
  text?: string;
  emoji?: string;
  expiration?: number;
  dnd?: boolean;
};

export type SlackUserProfile = {
  status_text: string;
  status_emoji: string;
  real_name: string;
  display_name: string;
  email: string;
};

export type SlackUser = {
  id: string;
  tz: string;
};

const handleError = async (error: any, email: string) => {
  console.error(error);

  const errorMessage = error?.data.error ?? error?.toString();
  if (errorMessage === 'token_revoked' || errorMessage === 'invalid_auth') {
    console.error(`No authorization for Slack for user ${email}`);
    try {
      await sendAuthErrorMessage(email);
      await clearUserTokens(email);
    } finally {
      return;
    }
  }
};

export const setUserPresence = async (email: string, token: string | undefined, presence: 'auto' | 'away') => {
  if (!token) return;

  console.log(`Setting presence to '${presence}' for ${email}`);

  const slackClient = new WebClient(token);

  try {
    const result = await slackClient.users.setPresence({ presence });
    if (!result.ok) {
      throw result.error;
    }
  } catch (error) {
    await handleError(error, email);
  }
};

export const setUserStatus = async (email: string, token: string | undefined, status: SlackStatus) => {
  if (!token) return;

  console.log(
    `Setting Slack status to ${status.text} with emoji ${status.emoji} for ${email} until ${status.expiration}`,
  );

  const slackClient = new WebClient(token);

  const expiration_seconds = Math.floor((status?.expiration || 0) / 1000);

  try {
    await slackClient.users.profile.set({
      profile: {
        status_text: status?.text || '',
        status_emoji: status?.emoji || '',
        status_expiration: expiration_seconds,
      },
    });
  } catch (error) {
    await handleError(error, email);
  }
};

export const setUserDnd = async (email: string, token: string | undefined, status: SlackStatus) => {
  if (!token || !status.dnd || !status.expiration) return;

  const slackClient = new WebClient(token);

  const num_milliseconds = Date.now().valueOf() - status.expiration;
  const num_seconds = num_milliseconds / 1000;
  const num_minutes = Math.ceil(num_seconds / 60);

  console.log(`Setting DND on for ${email} for ${num_minutes} minutes`);

  try {
    await slackClient.dnd.setSnooze({
      num_minutes,
    });
  } catch (error) {
    await handleError(error, email);
  }
};

export const getUserInfo = async (token: string, slackUserId: string): Promise<SlackUserProfile | undefined> => {
  if (!token) return;

  const slackClient = new WebClient(token);
  const response = await slackClient.users.info({ user: slackUserId });
  return response?.user?.profile as SlackUserProfile;
};

export const getUserByEmail = async (token: string, email: string): Promise<SlackUser | undefined> => {
  if (!token || !email) return;

  const slackClient = new WebClient(token);

  try {
    return (await slackClient.users.lookupByEmail({ token, email })).user as SlackUser;
  } catch (e: any) {
    if (e?.data?.error === 'users_not_found') {
      console.warn(`Could not find Slack user for email: ${email}`);
      return;
    }

    console.error(`Error getting Slack user for email: ${email}`, e);
    throw e;
  }
};

export const postMessage = async (token: string, params: ChatPostMessageArguments): Promise<boolean> => {
  if (!token) return false;

  const slackClient = new WebClient(token);
  const response = await slackClient.chat.postMessage(params);
  return response.ok;
};

export const sendAuthErrorMessage = async (email: string): Promise<boolean> => {
  const botToken = await getSlackSecretWithKey('bot-token');
  const user = await getUserByEmail(botToken, email);

  if (!user) return false;

  return await postMessage(botToken, {
    text: `Oops! CalendarToSlack had an authorization-related problem with one or more of your access tokens. Please re-authorize the app at ${slackInstallUrl()}. **Note:** If you want to disable Cal2Slack, ignore this message. *Please* do not remove the app from the Slack workspace.`,
    channel: user.id,
  });
};
