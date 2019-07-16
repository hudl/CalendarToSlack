import { AuthenticationProvider, AuthenticationProviderOptions } from "@microsoft/microsoft-graph-client";
import oauth2 from "simple-oauth2";
import env from "dotenv";

export class GraphApiAuthenticationProvider implements AuthenticationProvider {
  public async getAccessToken(options?: AuthenticationProviderOptions): Promise<any> {
    /*
      If we stored the last token with the user data in Dynamo,
      we could re-use valid tokens and refresh when expired.
    */
    return new Promise(async (resolve, reject) => {
      env.config();
      const client = {
        id: process.env.CLIENT_ID || '',
        secret: process.env.CLIENT_SECRET || '',
      };

      const auth = {
        tokenHost: `${process.env.OAUTH_AUTHORITY || ''}${process.env.TENANT_ID || ''}`,
        tokenPath: process.env.OAUTH_TOKEN_PATH || '',
        authorizePath: process.env.OAUTH_AUTHORIZE_PATH || '',
      };

      const authentication = oauth2.create({client, auth});

      const tokenConfig = {
        scope: (process.env.OAUTH_SCOPE || '').split(' ')
      };

      try {
        const result = await authentication.clientCredentials.getToken(tokenConfig);
        const token = authentication.accessToken.create(result).token.access_token;
        if (token) {
          resolve(token);
        } else {
          reject();
        }
      } catch (error) {
        console.error(error);
        reject(error);
      }
    });
    
  }
}
