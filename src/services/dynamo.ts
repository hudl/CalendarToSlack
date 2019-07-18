import { SlackStatus } from './slack';
import { Token } from 'simple-oauth2';
import AWS from 'aws-sdk';
import config from '../../config';

type StatusMapping = {
  calendarText: string;
  slackStatus: SlackStatus;
};

export type UserSettings = {
  email: string;
  slackToken: string;
  calendarStoredToken?: any | null;
  defaultStatus?: SlackStatus;
  statusMappings?: StatusMapping[];
};

const toDynamoStatus = (status: SlackStatus) => ({
  text: status.text || null,
  emoji: status.emoji || null,
});

const toDynamoStatusMappings = (statusMappings?: StatusMapping[]) => {
  return (
    statusMappings &&
    statusMappings.map(sm => ({
      ...sm,
      slackStatus: toDynamoStatus(sm.slackStatus),
    }))
  );
};

export const clearUserTokens = async (email: string): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: { email: email },
        UpdateExpression: 'remove calendarStoredToken, slackToken',
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

export const upsertSlackToken = async (email: string, slackToken: string): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: {
          email: email,
        },
        UpdateExpression: 'set slackToken = :t',
        ExpressionAttributeValues: {
          ':t': slackToken,
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

export const upsertDefaultStatus = async (email: string, defaultStatus: SlackStatus): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  if (!defaultStatus) {
    return await removeDefaultStatus(email);
  }

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: {
          email: email,
        },
        UpdateExpression: 'set defaultStatus = :s',
        ExpressionAttributeValues: {
          ':s': toDynamoStatus(defaultStatus),
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

export const removeDefaultStatus = async (email: string): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: {
          email: email,
        },
        UpdateExpression: 'remove defaultStatus',
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

export const upsertStatusMappings = async (email: string, statusMappings: StatusMapping[]): Promise<UserSettings> => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();

  return new Promise((resolve, reject) =>
    dynamoDb.update(
      {
        TableName: config.dynamoDb.tableName,
        Key: {
          email: email,
        },
        UpdateExpression: 'set statusMappings = :s',
        ExpressionAttributeValues: {
          ':s': toDynamoStatusMappings(statusMappings),
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

        resolve(data.Responses ? (data.Responses[config.dynamoDb.tableName] as UserSettings[]) : []);
      },
    ),
  );
};
