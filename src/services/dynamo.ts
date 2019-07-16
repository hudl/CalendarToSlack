import { SlackStatus } from './slack';
import { Token } from 'simple-oauth2';

const userSettings: UserSettings[] = [
  {
    email: 'jordan.degner@hudl.com',
    slackToken: 'abcd',
  },
];

export type UserSettings = {
  email: string;
  slackToken: string;
  calendarAuthCode?: string | '';
  calendarStoredToken?: Token | null;
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
