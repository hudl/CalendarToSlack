import { Handler } from 'aws-lambda';
import config from '../../config';
import { createUserUrl } from '../utils/urls';

const slackInstall: Handler = async () => ({
  statusCode: 302,
  headers: {
    Location: `https://slack.com/oauth/authorize?client_id=${
      config.slack.clientId
    }&redirect_uri=${createUserUrl()}&scope=${encodeURIComponent(
      'users.profile:read,users.profile:write,users:write',
    )}`,
  },
});

export default slackInstall;
