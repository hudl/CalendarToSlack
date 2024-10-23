import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import config from "../../../config";
import {StatusMapping} from "../dynamo";
import { v4 as uuidv4 } from 'uuid';

export type ExportedSettings = {
  settings_id: string;
  email: string;
  // TODO create new status mapping type and map between types
  statusMappings: StatusMapping[];
};

const getKeyForSettingsId = (settingsId: string): Record<string, string> => {
  return {
    settings_id: settingsId,
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

export const getExportedSettingsBySettingsId = async (settingsId: string): Promise<ExportedSettings> => {
  const client = getClient();
  const command = new GetCommand({
    TableName: config.dynamoDb.exportedSettingsTableName,
    Key: getKeyForSettingsId(settingsId),
  });

  try {
    const response = await client.send(command);
    if (!response?.Item) {
      return {} as ExportedSettings;
    }
    
    return response.Item as ExportedSettings;
  } catch (err) {
    console.error(err, 'Error getting exported settings for id', settingsId);
    throw err;
  }
};

export const exportSettings = async (email: string, statusMapping: StatusMapping[]): Promise<ExportedSettings> => {
  const settingsId = uuidv4();
  
  const client = getClient();
  const command = new UpdateCommand({
    TableName: config.dynamoDb.exportedSettingsTableName,
    Key: getKeyForSettingsId(settingsId),
    ReturnValues: 'ALL_NEW',
    UpdateExpression: 'SET statusMappings = :sm, email = :e',
    ExpressionAttributeValues: {
      ':sm': statusMapping,
      ':e': email,
    },
  });

  try {
    const response = await client.send(command);
    if (!response?.Attributes) {
      return {} as ExportedSettings;
    }
    
    return response.Attributes as ExportedSettings;
  } catch (err) {
    console.error(err, 'Error exporting settings');
    throw err;
  }
};