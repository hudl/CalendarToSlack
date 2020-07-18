import { Handler } from 'aws-lambda';
import oauth from 'simple-oauth2';
import config from '../../config';
import { getSlackSecretWithKey } from '../services/secretsManager';
import { createUserUrl, authorizeMicrosoftGraphUrl } from '../utils/urls';
import { upsertSlackToken } from '../services/dynamo';
import { getUserProfile } from '../services/slack';

type GetProfileResult = {
  email: string;
};

const microsoftAuthRedirect = (email: string) => ({
  statusCode: 301,
  headers: {
    Location: `https://login.microsoftonline.com/${config.microsoftGraph.tenantId}/oauth2/v2.0/authorize?client_id=${
      config.microsoftGraph.clientId
    }&response_type=code&redirect_uri=${authorizeMicrosoftGraphUrl()}&response_mode=query&scope=calendars.read&state=${email}`,
  },
});

const createUser: Handler = async (event: any) => {
  const code = event.queryStringParameters.code;
  const clientId = config.slack.clientId;
  const clientSecret = await getSlackSecretWithKey('client-secret');

  const oauthClient = oauth.create({
    client: {
      id: clientId,
      secret: clientSecret,
    },
    auth: {
      tokenHost: 'https://slack.com',
      tokenPath: '/api/oauth.access',
    },
  });

  const tokenResult = await oauthClient.authorizationCode.getToken({
    code,
    redirect_uri: createUserUrl(),
  });
  const accessToken = oauthClient.accessToken.create(tokenResult);
  const tokenStr: string = accessToken.token.access_token;

  const authorizedUser = await getUserProfile(tokenStr);
  if (!authorizedUser) {
    console.warn('Unable to locate Slack user during authorization flow');
    return;
  }

  await upsertSlackToken(authorizedUser.email, tokenStr);

  return microsoftAuthRedirect(authorizedUser.email);
};

export default createUser;
