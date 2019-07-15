import { SlackStatus } from './slack';
import AWS from 'aws-sdk';
import config from '../../config';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export type UserSettings = {
  email: string;
  slackToken: string;
  defaultStatus?: SlackStatus;
  statusMappings?: {
    calendarText?: string;
    slackStatus: SlackStatus;
  }[];
};

export const getAllUserSettings = async (): Promise<UserSettings[]> => {
  return new Promise(resolve =>
    dynamoDb.scan(
      {
        TableName: config.dynamoDb.tableName,
      },
      (_, data) => {
        resolve(data.Items as UserSettings[]);
      },
    ),
  );
};
