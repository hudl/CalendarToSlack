import { AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import oauth2, { OAuthClient, Token } from "simple-oauth2";
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
  private readonly scope: string = 'https://graph.microsoft.com/.default';

  constructor(userEmail: string) {
    this.userEmail = userEmail;
    env.config();
    this.authentication = this.createOAuthClient();
  }

  private createOAuthClient(): OAuthClient<string> {
    return oauth2.create({
      client: {
        id: config.outlook.clientId || '',
        secret: process.env.CLIENT_SECRET || '', // TODO: move the secret into AWS secrets
      },
      auth: {
        tokenHost: `${this.oauthAuthority}${config.outlook.tenantId || ''}`,
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

  public async getTokenWithAuthCode(authCode: string): Promise<Token> {
    return new Promise(async (resolve, reject) => {
      const tokenConfig: any = {
        scope: this.scope,
        code: authCode || '',
        redirect_uri: 'http://localhost:3000/authorize-outlook' // should be the lambda
      };
      try {
        const result = await this.authentication.authorizationCode.getToken(tokenConfig);
        const token = this.authentication.accessToken.create(result);
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
        const token = this.authentication.accessToken.create(calendarStoredToken);
        if (token.expired()) {
          const newToken = await token.refresh();
          await storeCalendarAuthenticationToken(this.userEmail, newToken);
          resolve(newToken.token.token.access_token);
        }
        resolve(token.token.token.access_token);
      } else {
        reject(`Could not authenticate user ${this.userEmail} with Outlook`);
      }
    });   
  }
}
