import { AuthenticationProvider, AuthenticationProviderOptions } from "@microsoft/microsoft-graph-client";
import oauth2, { OAuthClient } from "simple-oauth2";
import env from "dotenv";
import { UserSettings } from "services/dynamo";

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
    // lookup the user data from dynamo w/ the user email
    console.log(this.userEmail);
    throw Error('couldn\'t find user');
  };

  public async getAccessToken(options?: AuthenticationProviderOptions): Promise<any> {
    return new Promise(async (resolve, reject) => {
      const { calendarAuthCode, calendarStoredToken } = await this.getUserInformation();

      if (calendarStoredToken) {
        const token = this.authentication.accessToken.create(calendarStoredToken);
        if (token.expired()) {
          const newToken = await token.refresh();
          // persist newToken to db
          resolve(newToken.token.access_token);
        }
        resolve(token.token.access_token);
      } else {
        // get token with auth code
        const tokenConfig: any = {
          scope: (process.env.OAUTH_SCOPE || '').split(' '),
          code: calendarAuthCode || '',
          redirect_uri: 'https://localhost:3000/authorize' // should be the lambda
        };
        const result = await this.authentication.authorizationCode.getToken(tokenConfig);
        const token = this.authentication.accessToken.create(result).token.access_token;
        // persist token to db
        resolve(token.token.access_token);
      }
    });   
  }
}
