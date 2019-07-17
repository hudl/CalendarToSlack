import { WebClient } from '@slack/web-api';
import { clearUserTokens } from './dynamo';

export type SlackStatus = {
  text?: string;
  emoji?: string;
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
