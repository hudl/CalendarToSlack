import { SlackStatus } from './slack';
import { Token } from 'simple-oauth2';
import AWS from 'aws-sdk';
import config from '../../config';

export type UserSettings = {
  email: string;
  slackToken: string;
  calendarStoredToken?: any | null;
  defaultStatus?: SlackStatus | null;
  statusMappings?: {
    calendarText: string;
    slackStatus: SlackStatus;
  }[];
};

export const clearUserTokens = async (email: string): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: { email: email },
        UpdateExpression: 'set calendarStoredToken = :ct, slackToken = :st',
        ExpressionAttributeValues: {
          ':ct': null,
          ':st': null,
        },
        ReturnValues: 'ALL_NEW',
      },
      (err, data) => {
        if (err) {
          reject(err.message);
          return;
        }

        resolve(data as UserSettings);
      },
    ),
  );
};

export const storeCalendarAuthenticationToken = async (
  email: string,
  calendarStoredToken: Token,
): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: { email: email },
        UpdateExpression: 'set calendarStoredToken = :t',
        ExpressionAttributeValues: {
          ':t': calendarStoredToken,
        },
        ReturnValues: 'ALL_NEW',
      },
      (err, data) => {
        if (err) {
          reject(err.message);
          return;
        }

        resolve(data.Attributes as UserSettings);
      },
    ),
  );
};

export const upsertUserSettings = async (userSettings: UserSettings): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: {
          email: userSettings.email,
        },
        UpdateExpression: 'set slackToken = :t',
        ExpressionAttributeValues: {
          ':t': userSettings.slackToken,
        },
        ReturnValues: 'ALL_NEW',
      },
      (err, data) => {
        if (err) {
          reject(err.message);
          return;
        }

        resolve(data.Attributes as UserSettings);
      },
    ),
  );
};

export const upsertDefaultStatus = async ({ email, defaultStatus }: UserSettings): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: {
          email: email,
        },
        UpdateExpression: 'set defaultStatus = :s',
        ExpressionAttributeValues: {
          ':s': defaultStatus,
        },
        ReturnValues: 'ALL_NEW',
      },
      (err, data) => {
        if (err) {
          reject(err.message);
          return;
        }

        resolve(data.Attributes as UserSettings);
      },
    ),
  );
};

export const upsertStatusMappings = async (userSettings: UserSettings): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: {
          email: userSettings.email,
        },
        UpdateExpression: 'set statusMappings = :s',
        ExpressionAttributeValues: {
          ':s': userSettings.statusMappings,
        },
        ReturnValues: 'ALL_NEW',
      },
      (err, data) => {
        if (err) {
          reject(err.message);
          return;
        }

        resolve(data.Attributes as UserSettings);
      },
    ),
  );
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
