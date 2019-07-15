import { SlackStatus } from './slack';

const userSettings: UserSettings[] = [
  {
    email: 'jordan.degner@hudl.com',
    slackToken: 'abcd',
  },
];

export type UserSettings = {
  email: string;
  slackToken: string;
  statusMappings?: {
    isDefaultStatus?: boolean;
    calendarText?: string;
    slackStatus: SlackStatus;
  }[];
};

export const getUserSettings = async () => {
  // TODO: Implement this function to retrieve all user settings records from DynamoDB
  return userSettings;
};
