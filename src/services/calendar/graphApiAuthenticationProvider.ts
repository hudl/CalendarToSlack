import 'isomorphic-fetch';
import { AuthenticationProvider } from '@microsoft/microsoft-graph-client';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import { storeCalendarAuthenticationToken } from '../dynamo';
import config from '../../../config';
import { getMicrosoftGraphSecretWithKey } from '../../utils/secrets';
import { authorizeMicrosoftGraphUrl } from '../../utils/urls';

export class GraphApiAuthenticationProvider implements AuthenticationProvider {
  private storedToken?: string;
  private userEmail: string;

  private readonly oauthAuthority: string = 'https://login.microsoftonline.com/';
  private readonly authorizePath: string = '/oauth2/v2.0/authorize';
  private readonly tokenPath: string = '/oauth2/v2.0/token';
  private readonly scope: string = 'offline_access https://graph.microsoft.com/.default';

  private readonly tokenExpirationWindowInSeconds = 300;

  constructor(userEmail: string, storedToken?: string) {
    this.userEmail = userEmail;
    this.storedToken = storedToken;
  }

  private async createOAuthClient(): Promise<AuthorizationCode<string>> {
    const clientSecret = await getMicrosoftGraphSecretWithKey('client-secret');
    return new AuthorizationCode({
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

  private shouldRefreshToken(token: AccessToken): boolean {
    return token.expired(this.tokenExpirationWindowInSeconds);
  }

  public async getTokenWithAuthCode(authCode: string): Promise<AccessToken> {
    const tokenConfig = {
      scope: this.scope,
      code: authCode || '',
      redirect_uri: authorizeMicrosoftGraphUrl(),
    };

    const authentication = await this.createOAuthClient();
    const result = await authentication.getToken(tokenConfig);
    const token = authentication.createToken(result.token);

    await storeCalendarAuthenticationToken(this.userEmail, token);
    return token;
  }

  public async getAccessToken(): Promise<string> {
    if (!this.storedToken) {
      throw new Error(`Could not authenticate user ${this.userEmail} with Microsoft Graph`);
    }

    const client = await this.createOAuthClient();
    const tokenFromDb = client.createToken(JSON.parse(this.storedToken));

    if (!this.shouldRefreshToken(tokenFromDb)) {
      return this.storedToken;
    }

    console.log(
      `Microsoft Graph access token expired for ${this.userEmail} at ${tokenFromDb?.token['expires_at']}. Refreshing...`,
    );

    try {
      const newToken = await tokenFromDb.refresh();

      console.log(
        `Refreshed Microsoft graph access token for ${this.userEmail} with expiration: ${newToken?.token['expires_at']}`,
      );

      await storeCalendarAuthenticationToken(this.userEmail, newToken);
      return JSON.stringify(newToken.token);
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
}
