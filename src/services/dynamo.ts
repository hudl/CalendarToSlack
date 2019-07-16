import { SlackStatus } from './slack';
import AWS from 'aws-sdk';
import config from '../../config';

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
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.scan(
      {
        TableName: config.dynamoDb.tableName,
        ProjectionExpression: 'email',
      },
      (err, data) => {
        if (err) {
          reject(err.message);
          return;
        }

        resolve(data.Items as UserSettings[]);
      },
    ),
  );
};

export const getSettingsForUsers = async (emails: string[]): Promise<UserSettings[]> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.batchGet(
      {
        RequestItems: {
          [config.dynamoDb.tableName]: { Keys: emails.map(email => ({ email })) },
        },
      },
      (err, data) => {
        if (err) {
          reject(err.message);
          return;
        }

        resolve(
          data.Responses ? (data.Responses[config.dynamoDb.tableName] as UserSettings[]) : ([] as UserSettings[]),
        );
      },
    ),
  );
};
