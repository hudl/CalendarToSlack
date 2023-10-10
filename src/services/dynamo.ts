import { SlackStatus } from './slack';
import { Token } from 'simple-oauth2';
import { DynamoDBClient, BatchGetItemCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import config from '../../config';
import { CalendarEvent } from './calendar';

type StatusMapping = {
  calendarText: string;
  slackStatus: SlackStatus;
};

export type UserSettings = {
  email: string;
  slackToken?: string;
  calendarStoredToken?: any | null;
  defaultStatus?: SlackStatus;
  statusMappings?: StatusMapping[];
  currentEvent?: CalendarEvent;
  zoomLinksDisabled?: boolean;
  meetingReminderTimingOverride?: number;
  lastReminderEventId?: string;
  snoozed?: boolean;
};

const toDynamoStatus = (status: SlackStatus) => ({
  text: status.text || null,
  emoji: status.emoji || null,
});

const getKeyForEmail = (email: string) => {
  return {
    email: { S: email },
  };
};

export const clearUserTokens = async (email: string) => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'remove calendarStoredToken, slackToken',
    ReturnValues: 'ALL_NEW',
  });

  try {
    await dynamoDb.send(command);
  } catch (err) {
    console.error(err, 'Error clearing user tokens for email: ', email);
    throw err;
  }
};

export const storeCalendarAuthenticationToken = async (email: string, calendarStoredToken: Token) => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'set calendarStoredToken = :t',
    ExpressionAttributeValues: {
      ':t': { M: marshall(calendarStoredToken) },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    await dynamoDb.send(command);
  } catch (err) {
    console.error(err, 'Error storing calendar token for email: ', email);
    throw err;
  }
};

export const upsertSlackToken = async (email: string, slackToken: string) => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'set slackToken = :t',
    ExpressionAttributeValues: {
      ':t': { S: slackToken },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    await dynamoDb.send(command);
  } catch (err) {
    console.error(err, 'Error storing slack token for email: ', email);
    throw err;
  }
};

export const upsertDefaultStatus = async (email: string, defaultStatus: SlackStatus) => {
  if (!defaultStatus) {
    return await removeDefaultStatus(email);
  }

  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'set defaultStatus = :s',
    ExpressionAttributeValues: {
      ':s': { M: marshall(toDynamoStatus(defaultStatus)) },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    await dynamoDb.send(command);
  } catch (err) {
    console.error(err, 'Error storing default status for email: ', email);
    throw err;
  }
};

export const removeDefaultStatus = async (email: string) => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'remove defaultStatus',
    ReturnValues: 'ALL_NEW',
  });

  try {
    await dynamoDb.send(command);
  } catch (err) {
    console.error(err, 'Error removing default status for email: ', email);
    throw err;
  }
};

export const upsertStatusMappings = async (email: string, statusMappings: StatusMapping[]): Promise<UserSettings> => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'set statusMappings = :s',
    ExpressionAttributeValues: {
      ':s': { L: statusMappings.map((sm) => ({ M: marshall(sm) })) },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    const response = await dynamoDb.send(command);
    if (!response?.Attributes) {
      return {} as UserSettings;
    }
    return unmarshall(response.Attributes) as UserSettings;
  } catch (err) {
    console.error(err, 'Error storing status mappings for email: ', email);
    throw err;
  }
};

export const upsertCurrentEvent = async (email: string, event: CalendarEvent) => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'set currentEvent = :e',
    ExpressionAttributeValues: {
      ':e': { M: marshall({ ...event, location: event.location || null }) },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    await dynamoDb.send(command);
  } catch (err) {
    console.error(err, 'Error storing current event for email: ', email);
    throw err;
  }
};

export const removeCurrentEvent = async (email: string) => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'remove currentEvent',
    ReturnValues: 'ALL_NEW',
  });

  try {
    await dynamoDb.send(command);
  } catch (err) {
    console.error(err, 'Error removing current event for email: ', email);
    throw err;
  }
};

export const getAllUserSettings = async (): Promise<UserSettings[]> => {
  const dynamoDb = new DynamoDBClient();
  const command = new ScanCommand({
    TableName: config.dynamoDb.tableName,
    ProjectionExpression: 'email',
  });

  try {
    const response = await dynamoDb.send(command);
    if (!response.Items) return [];
    return response.Items.map((item) => unmarshall(item) as UserSettings);
  } catch (err) {
    console.error(err);
    throw err;
  }
};

export const getSettingsForUsers = async (emails: string[]): Promise<UserSettings[]> => {
  const dynamoDb = new DynamoDBClient();
  const command = new BatchGetItemCommand({
    RequestItems: {
      [config.dynamoDb.tableName]: {
        Keys: emails.map(getKeyForEmail),
      },
    },
  });

  try {
    const response = await dynamoDb.send(command);
    if (!response.Responses?.[config.dynamoDb.tableName]) return [];
    return response.Responses[config.dynamoDb.tableName].map((item) => unmarshall(item) as UserSettings);
  } catch (err) {
    console.error(err, 'Error getting user settings for emails: ', emails.join(', '));
    throw err;
  }
};

export const setZoomLinksDisabled = async (email: string, zoomLinksDisabled: boolean): Promise<UserSettings> => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'set zoomLinksDisabled = :z',
    ExpressionAttributeValues: {
      ':z': { BOOL: zoomLinksDisabled },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    const response = await dynamoDb.send(command);
    if (!response?.Attributes) {
      return {} as UserSettings;
    }
    return unmarshall(response.Attributes) as UserSettings;
  } catch (err) {
    console.error(err, 'Error setting zoom links disabled for email: ', email);
    throw err;
  }
};

export const setMeetingReminderTimingOverride = async (
  email: string,
  meetingReminderTimingOverride: number,
): Promise<UserSettings> => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    UpdateExpression: 'set meetingReminderTimingOverride = :o',
    ExpressionAttributeValues: {
      ':o': { N: meetingReminderTimingOverride.toString() },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    const response = await dynamoDb.send(command);
    if (!response?.Attributes) {
      return {} as UserSettings;
    }
    return unmarshall(response.Attributes) as UserSettings;
  } catch (err) {
    console.error(
      err,
      'Error setting meeting reminder timing override for email: ',
      email,
      ' to ',
      meetingReminderTimingOverride,
    );
    throw err;
  }
};

export const setLastReminderEventId = async (email: string, lastReminderEventId: string) => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: {
      email: { S: email },
    },
    UpdateExpression: 'set lastReminderEventId = :id',
    ExpressionAttributeValues: {
      ':id': { S: lastReminderEventId },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    await dynamoDb.send(command);
  } catch (err) {
    console.error(err, 'Error setting last reminder event id for email: ', email, ' to ', lastReminderEventId);
    throw err;
  }
};

export const setSnoozed = async (email: string, snoozed: boolean): Promise<UserSettings> => {
  const dynamoDb = new DynamoDBClient();
  const command = new UpdateItemCommand({
    TableName: config.dynamoDb.tableName,
    Key: {
      email: { S: email },
    },
    UpdateExpression: 'set snoozed = :s',
    ExpressionAttributeValues: {
      ':s': { BOOL: snoozed },
    },
    ReturnValues: 'ALL_NEW',
  });

  try {
    const response = await dynamoDb.send(command);
    if (!response?.Attributes) {
      return {} as UserSettings;
    }
    return unmarshall(response.Attributes) as UserSettings;
  } catch (err) {
    console.error(err, 'Error setting snoozed for email: ', email, ' to ', snoozed);
    throw err;
  }
};
