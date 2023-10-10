import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import config from '../../config';

export const getSlackSecretWithKey = async (key: string): Promise<string> => {
  return getSecretWithKey(config.slack.secretName, key);
};

export const getMicrosoftGraphSecretWithKey = async (key: string): Promise<string> => {
  return getSecretWithKey(config.microsoftGraph.secretName, key);
};

const getSecretWithKey = async (secretName: string, key: string): Promise<string> => {
  const client = new SecretsManagerClient({
    region: config.region,
  });
  const command = new GetSecretValueCommand({
    SecretId: secretName,
  });

  try {
    const data = await client.send(command);
    if (data && data.SecretString) {
      const secrets = JSON.parse(data.SecretString);
      const value = secrets[key];
      if (!value) {
        throw new Error(`Property "${key}" is empty or does not exist`);
      }
      return value;
    }
  } catch (err) {
    console.error(err);
    throw err;
  }

  throw new Error('Secret not configured properly');
};
