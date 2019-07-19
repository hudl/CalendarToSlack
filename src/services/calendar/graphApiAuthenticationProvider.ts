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

  private async shouldRefreshToken({ expires_at_timestamp: expiresAtTimestamp }: Token): Promise<boolean> {
    if (!expiresAtTimestamp) {
      return true;
    }
    const now = new Date();
    const expiration = new Date(expiresAtTimestamp);
    expiration.setMinutes(expiration.getMinutes() + 1);
    return now >= expiration;
  }

  public async getTokenWithAuthCode(authCode: string): Promise<Token> {
    return new Promise(async (resolve, reject) => {
      const tokenConfig = {
        scope: this.scope,
        code: authCode || '',
        redirect_uri: authorizeMicrosoftGraphUrl(),
      };
      try {
        const authentication = await this.createOAuthClient();
        const result = await authentication.authorizationCode.getToken(tokenConfig);
        const { token } = authentication.accessToken.create(result);
        token.expires_at_timestamp = token.expires_at.toISOString();
        await storeCalendarAuthenticationToken(this.userEmail, token);
        resolve(token);
      } catch (error) {
        reject(error);
      }
    });
  }

  public async getAccessToken(): Promise<any> {
    return new Promise(async (resolve, reject) => {
      if (this.storedToken) {
        if (this.shouldRefreshToken(this.storedToken)) {
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
              `Refreshed Microsoft graph token for ${this.userEmail} with expiration: ${newToken.expires_at_timestamp}`,
            );
            await storeCalendarAuthenticationToken(this.userEmail, newToken);
            resolve(newToken.access_token);
          } catch (error) {
            console.error(error);
            reject(error);
          }
        }
        resolve(this.storedToken.access_token);
      } else {
        reject(`Could not authenticate user ${this.userEmail} with Microsoft Graph`);
      }
    });
  }
}
