import AWS from 'aws-sdk';
import config from '../config';

export const getSlackSecretWithKey = async (key: string): Promise<string> => {
  return getSecretWithKey(config.slack.secretName, key);
};

export const getMicrosoftGraphSecretWithKey = async (key: string): Promise<string> => {
  return getSecretWithKey(config.microsoftGraph.secretName, key);
};

const getSecretWithKey = async (secretName: string, key: string): Promise<string> => {
  const client = new AWS.SecretsManager({
    region: config.region,
  });

  try {
    console.log(secretName + ' ' + key);
    const data = await client.getSecretValue({ SecretId: secretName }).promise();
    if ('SecretString' in data && data.SecretString) {
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
