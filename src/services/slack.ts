import { WebClient } from '@slack/web-api';

export type SlackStatus = {
  text?: string;
  emoji?: string;
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
