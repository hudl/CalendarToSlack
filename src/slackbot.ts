import crypto from 'crypto';
import { getSecretWithKey } from './utils/secrets';

const MILLIS_IN_SEC = 1000;
const FIVE_MIN_IN_SEC = 300;

type ApiGatewayEvent = {
  headers: {
    [header: string]: string;
  };
  body: string;
};

interface SlackResponse {}

function validateTimestamp(slackRequestTimestampInSec: number): boolean {
  const currentTimeInSec = Math.floor(new Date().getTime() / MILLIS_IN_SEC);
  return Math.abs(currentTimeInSec - slackRequestTimestampInSec) < FIVE_MIN_IN_SEC;
}

async function validateSlackRequest(event: ApiGatewayEvent): Promise<boolean> {
  const requestTimestamp: number = +event.headers['X-Slack-Request-Timestamp'];
  if (!validateTimestamp(requestTimestamp)) {
    return false;
  }

  const signingSecret = await getSecretWithKey('signing-secret');
  const hmac = crypto.createHmac('sha256', signingSecret);

  const requestSignature = event.headers['X-Slack-Signature'];
  const [version, slackHash] = requestSignature.split('=');

  const calculatedSignature = hmac.update(`${version}:${requestTimestamp}:${event.body}`).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(calculatedSignature, 'utf8'), Buffer.from(slackHash, 'utf8'));
}

export const handler = async (event: ApiGatewayEvent) => {
  let body = JSON.parse(event.body);

  if (!(await validateSlackRequest(event))) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Request was invalid' }),
    };
  }

  let responseBody: SlackResponse;
  switch (body.type) {
    case 'url_verification':
      responseBody = { challenge: body.challenge };
      break;
    case 'event_callback':
      console.log(event.body);
      responseBody = {};
      break;
    default:
      console.log('Event type not recognized: ' + body.type);
      console.log(event.body);
      responseBody = {};
  }

  let response = {
    statusCode: 200,
    body: JSON.stringify(responseBody),
  };

  return response;
};
