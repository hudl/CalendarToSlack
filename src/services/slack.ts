import { WebClient, ChatPostMessageArguments } from '@slack/web-api';
import { clearUserTokens } from './dynamo';

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

const handleError = async (error: any, email: string) => {
  console.error(error);
  error.data;
  const {
    data: { error: errorMessage },
  } = error;
  if (errorMessage === 'token_revoked' || errorMessage === 'invalid_auth') {
    console.error(`No authorization for Slack for user ${email}`);
    try {
      await clearUserTokens(email);
    } finally {
      return;
    }
  }
};

export const setUserPresence = async (email: string, token: string, presence: 'auto' | 'away') => {
  if (!token) return;

  const slackClient = new WebClient(token);

  try {
    await slackClient.users.setPresence({ presence });
  } catch (error) {
    await handleError(error, email);
  }
};

export const setUserStatus = async (email: string, token: string, status: SlackStatus) => {
  if (!token) return;

  const slackClient = new WebClient(token);
  const profile = JSON.stringify({ status_text: status.text, status_emoji: status.emoji });

  try {
    await slackClient.users.profile.set({ profile });
  } catch (error) {
    await handleError(error, email);
  }
};

export const getUserProfile = async (token: string, slackUserId: string): Promise<SlackUserProfile | undefined> => {
  if (!token) return undefined;

  const slackClient = new WebClient(token);
  const response: any = await slackClient.users.info({ user: slackUserId });
  return response.user.profile as SlackUserProfile;
};

export const postMessage = async (token: string, params: ChatPostMessageArguments): Promise<boolean> => {
  if (!token) return false;

  const slackClient = new WebClient(token);
  const response = await slackClient.chat.postMessage(params);
  return response.ok;
};
