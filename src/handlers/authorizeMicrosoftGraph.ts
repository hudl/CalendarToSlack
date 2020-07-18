import { Handler } from 'aws-lambda';
import { GraphApiAuthenticationProvider } from '../services/calendar/graphApiAuthenticationProvider';

const authorizeMicrosoftGraph: Handler = async (event: any) => {
  const {
    queryStringParameters: { code, state },
  } = event;
  const authProvider = new GraphApiAuthenticationProvider(state);
  await authProvider.getTokenWithAuthCode(code);

  return {
    statusCode: 301,
    headers: {
      Location: 'https://github.com/hudl/CalendarToSlack/wiki',
    },
  };
};

export default authorizeMicrosoftGraph;
