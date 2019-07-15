export type SlackStatus = {
  text?: string;
  emoji?: string;
};

export const setSlackStatus = async (email: string, token: string, status: SlackStatus) => {
  // TODO: Implement this function to set the Slack status to a given status text and emoji for a user
  console.log(`Setting Slack status to ${status.text} with emoji ${status.emoji} for ${email}`);
};
