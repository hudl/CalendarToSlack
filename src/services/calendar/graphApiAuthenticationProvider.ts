import { AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import oauth2, { OAuthClient, Token } from "simple-oauth2";
import env from "dotenv";
import {
  getSettingsForUsers,
  storeCalendarAuthenticationToken,
  UserSettings
} from "../dynamo";

export class GraphApiAuthenticationProvider implements AuthenticationProvider {
  private userEmail: string;
  private authentication: OAuthClient;

  constructor(userEmail: string) {
    this.userEmail = userEmail;
    env.config();
    this.authentication = this.createOAuthClient();
  }

  private createOAuthClient(): OAuthClient<string> {
    return oauth2.create({
      client: {
        id: process.env.CLIENT_ID || '',
        secret: process.env.CLIENT_SECRET || '',
      },
      auth: {
        tokenHost: `${process.env.OAUTH_AUTHORITY || ''}${process.env.TENANT_ID || ''}`,
        tokenPath: process.env.OAUTH_TOKEN_PATH || '',
        authorizePath: process.env.OAUTH_AUTHORIZE_PATH || '',
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
        scope: (process.env.OAUTH_SCOPE || '').split(' '),
        code: authCode || '',
        redirect_uri: 'https://localhost:3000/authorize-outlook' // should be the lambda
      };
      const result = await this.authentication.authorizationCode.getToken(tokenConfig);
      const token = this.authentication.accessToken.create(result);
      await storeCalendarAuthenticationToken(this.userEmail, token);
      resolve(token);
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
          resolve(newToken.token.access_token);
        }
        resolve(token.token.access_token);
      } else {
        reject(`Could not authenticate user ${this.userEmail} with Outlook`);
      }
    });   
  }
}
