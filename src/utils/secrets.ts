import AWS from 'aws-sdk';
import config from '../../config';

export const getSecretWithKey = async (key: string): Promise<string> => {
  const client = new AWS.SecretsManager({
    region: config.region,
  });

  try {
    const data = await client.getSecretValue({ SecretId: config.slack.secretName }).promise();
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

  throw new Error('Slack secret not configured properly');
};
