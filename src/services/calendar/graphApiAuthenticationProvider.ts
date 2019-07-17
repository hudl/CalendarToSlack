import { AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import oauth2, { OAuthClient, Token, AccessToken } from "simple-oauth2";
import env from "dotenv";
import {
  getSettingsForUsers,
  storeCalendarAuthenticationToken,
  UserSettings
} from "../dynamo";
import config from '../../config';

export class GraphApiAuthenticationProvider implements AuthenticationProvider {
  private userEmail: string;
  private authentication: OAuthClient;

  private readonly oauthAuthority: string = 'https://login.microsoftonline.com/';
  private readonly authorizePath: string = '/oauth2/v2.0/authorize';
  private readonly tokenPath: string = '/oauth2/v2.0/token';
  private readonly scope: string = 'offline_access https://graph.microsoft.com/.default';
  private readonly redirectUri: string = process.env.IS_OFFLINE ?
                                          'http://localhost:3000/authorize-microsoft-graph' :
                                          config.endpoints.authorizeMicrosoftGraph;

  constructor(userEmail: string) {
    this.userEmail = userEmail;
    env.config();
    this.authentication = this.createOAuthClient();
  }

  private createOAuthClient(): OAuthClient<string> {
    return oauth2.create({
      client: {
        id: config.microsoftGraph.clientId || '',
        secret: process.env.CLIENT_SECRET || '', // TODO: move the secret into AWS secrets
      },
      auth: {
        tokenHost: `${this.oauthAuthority}${config.microsoftGraph.tenantId || ''}`,
        tokenPath: this.tokenPath,
        authorizePath: this.authorizePath,
      }
    });
  }

  private async getUserInformation(): Promise<UserSettings> {
    return new Promise(async (resolve, reject) => {
      try {
        const settings = await getSettingsForUsers([this.userEmail]);
        if (!settings || !settings.length) {
          throw new Error(`Didn't find stored user settings for email ${this.userEmail}`);
        }
        resolve(settings[0]);
      } catch (error) {
        reject(error.message);
      }
    });
  };

  private async shouldRefreshToken({ "expires_at_timestamp": expiresAtTimestamp }: Token): Promise<boolean> {
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
      const tokenConfig: any = {
        scope: this.scope,
        code: authCode || '',
        redirect_uri: this.redirectUri // should be the lambda
      };
      try {
        const result = await this.authentication.authorizationCode.getToken(tokenConfig);
        const { token } = this.authentication.accessToken.create(result);
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
      const { calendarStoredToken } = await this.getUserInformation();

      if (calendarStoredToken) {
        if (this.shouldRefreshToken(calendarStoredToken)) {
          try {
            const accessToken = this.authentication.accessToken.create(calendarStoredToken);
            const newToken = (await accessToken.refresh()).token;
            newToken.expires_at_timestamp = newToken.expires_at.toISOString();
            await storeCalendarAuthenticationToken(this.userEmail, newToken);
            resolve(newToken.access_token);
          } catch (error) {
            console.error(error);
            reject(error);
          }
        }
        resolve(calendarStoredToken.access_token);
      } else {
        reject(`Could not authenticate user ${this.userEmail} with Microsoft Graph`);
      }
    });   
  }
}
