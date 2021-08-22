import 'isomorphic-fetch';
import { AuthenticationProvider } from '@microsoft/microsoft-graph-client';
import oauth2, { OAuthClient, Token } from 'simple-oauth2';
import { storeCalendarAuthenticationToken } from '../dynamo';
import config from '../../../config';
import { getMicrosoftGraphSecretWithKey } from '../../utils/secrets';
import { authorizeMicrosoftGraphUrl } from '../../utils/urls';

export class GraphApiAuthenticationProvider implements AuthenticationProvider {
  private storedToken?: Token;
  private userEmail: string;

  private readonly oauthAuthority: string = 'https://login.microsoftonline.com/';
  private readonly authorizePath: string = '/oauth2/v2.0/authorize';
  private readonly tokenPath: string = '/oauth2/v2.0/token';
  private readonly scope: string = 'offline_access https://graph.microsoft.com/.default';

  constructor(userEmail: string, storedToken?: Token) {
    this.userEmail = userEmail;
    this.storedToken = storedToken;
  }

  private async createOAuthClient(): Promise<OAuthClient<string>> {
    const clientSecret = await getMicrosoftGraphSecretWithKey('client-secret');
    return oauth2.create({
      client: {
        id: config.microsoftGraph.clientId || '',
        secret: clientSecret,
      },
      auth: {
        tokenHost: `${this.oauthAuthority}${config.microsoftGraph.tenantId || ''}`,
        tokenPath: this.tokenPath,
        authorizePath: this.authorizePath,
      },
    });
  }

  private shouldRefreshToken({ expires_at_timestamp: expiresAtTimestamp }: Token) {
    if (!expiresAtTimestamp) {
      return true;
    }
    const now = new Date();
    const expiration = new Date(expiresAtTimestamp);
    expiration.setMinutes(expiration.getMinutes() - 1);
    return now >= expiration;
  }

  public async getTokenWithAuthCode(authCode: string): Promise<Token> {
    const tokenConfig = {
      scope: this.scope,
      code: authCode || '',
      redirect_uri: authorizeMicrosoftGraphUrl(),
    };

    const authentication = await this.createOAuthClient();
    const result = await authentication.authorizationCode.getToken(tokenConfig);
    const { token } = authentication.accessToken.create(result);
    token.expires_at_timestamp = token.expires_at.toISOString();

    await storeCalendarAuthenticationToken(this.userEmail, token);
    return token;
  }

  public async getAccessToken(): Promise<any> {
    if (!this.storedToken) {
      throw new Error(`Could not authenticate user ${this.userEmail} with Microsoft Graph`);
    }

    if (!this.shouldRefreshToken(this.storedToken)) {
      return this.storedToken.access_token;
    }

    console.log(
      `Microsoft Graph access token expired for ${this.userEmail} at ${
        this.storedToken.expires_at_timestamp
      }. Refreshing...`,
    );

    try {
      const authentication = await this.createOAuthClient();
      const accessToken = authentication.accessToken.create(this.storedToken);

      const newToken = (await accessToken.refresh()).token;
      newToken.expires_at_timestamp = newToken.expires_at.toISOString();

      console.log(
        `Refreshed Microsoft graph access token for ${this.userEmail} with expiration: ${
          newToken.expires_at_timestamp
        }`,
      );

      await storeCalendarAuthenticationToken(this.userEmail, newToken);
      return newToken.access_token;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
}
