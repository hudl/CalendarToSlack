import { WebClient, ChatPostMessageArguments } from '@slack/web-api';
import { clearUserTokens } from './dynamo';
import { getSlackSecretWithKey } from './secretsManager';
import { slackInstallUrl } from '../utils/urls';

export type SlackStatus = {
  text?: string;
  emoji?: string;
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
  profile: SlackUserProfile;
};

const handleError = async (error: any, email: string) => {
  console.error(error);

  const {
    data: { error: errorMessage },
  } = error;
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
    await slackClient.users.setPresence({ presence });
  } catch (error) {
    await handleError(error, email);
  }
};

export const setUserStatus = async (email: string, token: string | undefined, status: SlackStatus) => {
  if (!token) return;

  console.log(`Setting Slack status to ${status.text} with emoji ${status.emoji} for ${email}`);

  const slackClient = new WebClient(token);
  const profile = JSON.stringify({ status_text: status.text || '', status_emoji: status.emoji || '' });

  try {
    await slackClient.users.profile.set({ profile });
  } catch (error) {
    await handleError(error, email);
  }
};

export const getUserProfile = async (token: string): Promise<SlackUserProfile | undefined> => {
  if (!token) return;

  const slackClient = new WebClient(token);
  return (await slackClient.users.profile.get()).profile as SlackUserProfile;
};

export const getUserById = async (token: string, slackUserId: string): Promise<SlackUser | undefined> => {
  if (!token) return;

  const slackClient = new WebClient(token);
  return (await slackClient.users.info({ user: slackUserId })).user as SlackUser;
};

export const getUserByEmail = async (token: string, email: string): Promise<SlackUser | undefined> => {
  if (!token || !email) return;

  const slackClient = new WebClient(token);

  try {
    return (await slackClient.users.lookupByEmail({ token, email })).user as SlackUser;
  } catch (e) {
    if (e.data.error === 'users_not_found') {
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
    text: `Oops! CalendarToSlack had an authorization-related problem with one or more of your access tokens. Please re-authorize the app at ${slackInstallUrl()}.`,
    channel: user.id,
  });
};
