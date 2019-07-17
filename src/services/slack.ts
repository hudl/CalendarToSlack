import { WebClient, ChatPostMessageArguments } from '@slack/web-api';

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

export const setUserPresence = async (token: string, presence: 'auto' | 'away') => {
  if (!token) return;

  const slackClient = new WebClient(token);

  await slackClient.users.setPresence({ presence });
};

export const setUserStatus = async (token: string, status: SlackStatus) => {
  if (!token) return;

  const slackClient = new WebClient(token);
  const profile = JSON.stringify({ status_text: status.text, status_emoji: status.emoji });

  await slackClient.users.profile.set({ profile });
};

export const getUserProfile = async (token: string, slackUserId: string): Promise<SlackUserProfile | undefined> => {
  if (!token) return undefined;

  const slackClient = new WebClient(token);
  const response: any = await slackClient.users.info({ user: slackUserId });
  return response.user.profile as SlackUserProfile;
}

export const postMessage = async (token: string, params: ChatPostMessageArguments): Promise<boolean> => {
  if (!token) return false;

  const slackClient = new WebClient(token);
  const response = await slackClient.chat.postMessage(params);
  return response.ok;
}