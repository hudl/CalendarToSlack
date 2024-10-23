import 'isomorphic-fetch';
import { AuthenticationProvider } from '@microsoft/microsoft-graph-client';
import { AuthorizationCode, Token } from 'simple-oauth2';
import { storeCalendarAuthenticationToken } from '../dynamo';
import config from '../../../config';
import { getMicrosoftGraphSecretWithKey } from '../../utils/secrets';
import { authorizeMicrosoftGraphUrl } from '../../utils/urls';

export class GraphApiAuthenticationProvider implements AuthenticationProvider {
  private storedToken?: Token;
  private userEmail: string;

  private readonly oauthAuthority: string = 'https://login.microsoftonline.com/';
  private readonly authorizePath: string = '/oauth2/v2.0/authorize';
  private readonly tokenPath: string = 'oauth2/v2.0/token';
  private readonly scope: string = 'offline_access https://graph.microsoft.com/.default';

  constructor(userEmail: string, storedToken?: Token) {
    this.userEmail = userEmail;
    this.storedToken = storedToken;
  }

  private async createOAuthClient(): Promise<AuthorizationCode<string>> {
    const clientSecret = await getMicrosoftGraphSecretWithKey('client-secret');
    const oauthConfig = {
      client: {
        id: config.microsoftGraph.clientId || '',
        secret: clientSecret,
      },
      auth: {
        tokenHost: `${this.oauthAuthority}${config.microsoftGraph.tenantId || ''}/`,
        tokenPath: this.tokenPath,
        authorizePath: this.authorizePath,
      },
    };

    return new AuthorizationCode(oauthConfig);
  }

  private async shouldRefreshToken(token: Token) {
    const authentication = await this.createOAuthClient();
    const accessToken = authentication.createToken(token);
    // Return if token is expire or expires in next 120 seconds
    return accessToken.expired(120);
  }

  public async getTokenWithAuthCode(authCode: string): Promise<Token> {
    const authentication = await this.createOAuthClient();

    const tokenResult = await authentication.getToken({
      scope: this.scope,
      code: authCode || '',
      redirect_uri: authorizeMicrosoftGraphUrl()
    });

    await storeCalendarAuthenticationToken(this.userEmail, tokenResult.token);
    return tokenResult.token;
  }

  public async getAccessToken(): Promise<any> {
    if (!this.storedToken) {
      throw new Error(`Could not authenticate user ${this.userEmail} with Microsoft Graph`);
    }

    if (!(await this.shouldRefreshToken(this.storedToken))) {
      return this.storedToken.access_token;
    }

    console.log(
      `Microsoft Graph access token expired for ${this.userEmail}. Refreshing...`,
    );

    try {
      const authentication = await this.createOAuthClient();
      const accessToken = authentication.createToken(this.storedToken);

      const newToken = (await accessToken.refresh({ scope: this.scope }));

      console.log(
        `Refreshed Microsoft graph access token for ${this.userEmail} with expiration: ${
          newToken.token.expires_in as number
        }`,
      );

      await storeCalendarAuthenticationToken(this.userEmail, newToken.token);
      return newToken.token.access_token as string;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
}
