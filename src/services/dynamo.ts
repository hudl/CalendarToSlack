import { SlackStatus } from './slack';
import { Token } from 'simple-oauth2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchGetCommand,
  ScanCommand,
  UpdateCommand,
  UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import config from '../../config';
import { CalendarEvent } from './calendar';
import { v4 as uuidv4 } from 'uuid';

export type StatusMapping = {
  calendarText: string;
  slackStatus: SlackStatus;
  dnd?: boolean;
};

export type ExportedSettings = {
  settingsId: string;
  statusMappings: StatusMapping[];
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
  exportedSettings?: ExportedSettings[];
};

const toDynamoStatus = (status: SlackStatus) => ({
  text: status.text || null,
  emoji: status.emoji || null,
});

const getKeyForEmail = (email: string): Record<string, string> => {
  return {
    email: email,
  };
};

const getClient = () => {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: config.region,
    }),
    {
      marshallOptions: {
        convertClassInstanceToMap: true,
      },
    },
  );
};

const updateUserSettings = async (email: string, settings: Partial<UpdateCommandInput>): Promise<UserSettings> => {
  const client = getClient();
  const command = new UpdateCommand({
    ...settings,
    TableName: config.dynamoDb.tableName,
    Key: getKeyForEmail(email),
    ReturnValues: 'ALL_NEW',
  });

  const response = await client.send(command);
  if (!response?.Attributes) {
    return {} as UserSettings;
  }
  return response.Attributes as UserSettings;
};

export const clearUserTokens = async (email: string) => {
  try {
    await updateUserSettings(email, { UpdateExpression: 'remove calendarStoredToken, slackToken' });
  } catch (err) {
    console.error(err, 'Error clearing user tokens for email: ', email);
    throw err;
  }
};

export const storeCalendarAuthenticationToken = async (email: string, calendarStoredToken: Token) => {
  try {
    await updateUserSettings(email, {
      UpdateExpression: 'set calendarStoredToken = :t',
      ExpressionAttributeValues: {
        ':t': calendarStoredToken,
      },
    });
  } catch (err) {
    console.error(err, 'Error storing calendar token for email: ', email);
    throw err;
  }
};

export const upsertSlackToken = async (email: string, slackToken: string) => {
  try {
    await updateUserSettings(email, {
      UpdateExpression: 'set slackToken = :t',
      ExpressionAttributeValues: {
        ':t': slackToken,
      },
    });
  } catch (err) {
    console.error(err, 'Error storing slack token for email: ', email);
    throw err;
  }
};

export const upsertDefaultStatus = async (email: string, defaultStatus: SlackStatus) => {
  if (!defaultStatus) {
    return await removeDefaultStatus(email);
  }

  try {
    await updateUserSettings(email, {
      UpdateExpression: 'set defaultStatus = :s',
      ExpressionAttributeValues: {
        ':s': toDynamoStatus(defaultStatus),
      },
    });
  } catch (err) {
    console.error(err, 'Error storing default status for email: ', email);
    throw err;
  }
};

export const removeDefaultStatus = async (email: string) => {
  try {
    await updateUserSettings(email, { UpdateExpression: 'remove defaultStatus' });
  } catch (err) {
    console.error(err, 'Error removing default status for email: ', email);
    throw err;
  }
};

export const upsertStatusMappings = async (email: string, statusMappings: StatusMapping[]): Promise<UserSettings> => {
  try {
    return updateUserSettings(email, {
      UpdateExpression: 'set statusMappings = :s',
      ExpressionAttributeValues: {
        ':s': statusMappings,
      },
    });
  } catch (err) {
    console.error(err, 'Error storing status mappings for email: ', email);
    throw err;
  }
};

export const upsertCurrentEvent = async (email: string, event: CalendarEvent) => {
  try {
    await updateUserSettings(email, {
      UpdateExpression: 'set currentEvent = :e',
      ExpressionAttributeValues: {
        ':e': { ...event, location: event.location || null },
      },
    });
  } catch (err) {
    console.error(err, 'Error storing current event for email: ', email);
    throw err;
  }
};

export const removeCurrentEvent = async (email: string) => {
  try {
    await updateUserSettings(email, {
      UpdateExpression: 'remove currentEvent',
    });
  } catch (err) {
    console.error(err, 'Error removing current event for email: ', email);
    throw err;
  }
};

export const getAllUserSettings = async (): Promise<UserSettings[]> => {
  const dynamoDb = getClient();
  const command = new ScanCommand({
    TableName: config.dynamoDb.tableName,
    ProjectionExpression: 'email',
  });

  try {
    const response = await dynamoDb.send(command);
    if (!response.Items) return [];
    return response.Items.map((item) => item as UserSettings);
  } catch (err) {
    console.error(err);
    throw err;
  }
};

export const getSettingsForUsers = async (emails: string[]): Promise<UserSettings[]> => {
  const dynamoDb = getClient();
  const command = new BatchGetCommand({
    RequestItems: {
      [config.dynamoDb.tableName]: {
        Keys: emails.map(getKeyForEmail),
      },
    },
  });

  try {
    const response = await dynamoDb.send(command);
    if (!response.Responses?.[config.dynamoDb.tableName]) return [];
    return response.Responses[config.dynamoDb.tableName].map((item) => item as UserSettings);
  } catch (err) {
    console.error(err, 'Error getting user settings for emails: ', emails.join(', '));
    throw err;
  }
};

export const setZoomLinksDisabled = async (email: string, zoomLinksDisabled: boolean): Promise<UserSettings> => {
  try {
    return await updateUserSettings(email, {
      UpdateExpression: 'set zoomLinksDisabled = :z',
      ExpressionAttributeValues: {
        ':z': zoomLinksDisabled,
      },
    });
  } catch (err) {
    console.error(err, 'Error setting zoom links disabled for email: ', email);
    throw err;
  }
};

export const setMeetingReminderTimingOverride = async (
  email: string,
  meetingReminderTimingOverride: number,
): Promise<UserSettings> => {
  try {
    return await updateUserSettings(email, {
      UpdateExpression: 'set meetingReminderTimingOverride = :o',
      ExpressionAttributeValues: {
        ':o': meetingReminderTimingOverride,
      },
    });
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
  try {
    await updateUserSettings(email, {
      UpdateExpression: 'set lastReminderEventId = :id',
      ExpressionAttributeValues: {
        ':id': lastReminderEventId,
      },
    });
  } catch (err) {
    console.error(err, 'Error setting last reminder event id for email: ', email, ' to ', lastReminderEventId);
    throw err;
  }
};

export const setSnoozed = async (email: string, snoozed: boolean): Promise<UserSettings> => {
  try {
    return await updateUserSettings(email, {
      UpdateExpression: 'set snoozed = :s',
      ExpressionAttributeValues: {
        ':s': snoozed,
      },
    });
  } catch (err) {
    console.error(err, 'Error setting snoozed for email: ', email, ' to ', snoozed);
    throw err;
  }
};

export const getExportedSettingsBySettingsId = async (settingsId: string): Promise<ExportedSettings> => {
  const client = getClient();
  const command = new ScanCommand({
    TableName: config.dynamoDb.tableName,
    ProjectionExpression: 'exportedSettings',
  });

  try {
    const response = await client.send(command);
    if (!response?.Items) {
      return {} as ExportedSettings;
    }

    const userSettings = response.Items.map((item) => item as UserSettings);
    const exportedSettings = userSettings.flatMap((item) => item.exportedSettings?.map((es) => es as ExportedSettings));
    return exportedSettings.filter((item) => item && item?.settingsId === settingsId)[0] ?? ({} as ExportedSettings);
  } catch (err) {
    console.error(err, 'Error getting exported settings for id', settingsId);
    throw err;
  }
};

export const exportSettings = async (email: string, statusMappings: StatusMapping[]): Promise<string> => {
  const settingsId = uuidv4();

  try {
    await updateUserSettings(email, {
      UpdateExpression: 'set exportedSettings = list_append(if_not_exists(exportedSettings, :default), :s)',
      ExpressionAttributeValues: {
        ':default': [],
        ':s': [
          {
            settingsId: settingsId,
            statusMappings: statusMappings,
          },
        ],
      },
    });

    return settingsId;
  } catch (err) {
    console.error(err, 'Error storing current event for email: ', email);
    throw err;
  }
};
