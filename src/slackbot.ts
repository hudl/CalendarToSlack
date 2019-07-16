import qs from "qs";
import crypto from "crypto";
import AWS from "aws-sdk";
import config from "../config";

const MILLIS_IN_SEC = 1000;
const FIVE_MIN_IN_SEC = 300;

type ApiGatewayEvent = {
  headers: {
    [header: string]: string;
  };
  body: string;
};

async function getSigningSecret(): Promise<string> {
  const client = new AWS.SecretsManager({
    region: config.region
  });

  try {
    const data = await client.getSecretValue({ SecretId: config.slack.secretName }).promise();
    if ("SecretString" in data && data.SecretString) {
      return data.SecretString;
    }
  } catch (err) {
    console.error(err);
    throw err;
  }

  throw new Error("Slack signing secret not configured properly");
}

function validateTimestamp(slackRequestTimestampInSec: number): boolean {
  const currentTimeInSec = Math.floor(new Date().getTime() / MILLIS_IN_SEC);
  return Math.abs(currentTimeInSec - slackRequestTimestampInSec) < FIVE_MIN_IN_SEC;
}

async function validateSlackRequest(event: ApiGatewayEvent): Promise<boolean> {
  console.log(JSON.stringify(event.headers, null, 2));

  const requestTimestamp: number = +event.headers["x-slack-request-timestamp"];
  if (!validateTimestamp(requestTimestamp)) {
    return false;
  }

  const signingSecret = await getSigningSecret();
  const hmac = crypto.createHmac("sha256", signingSecret);

  const requestSignature = event.headers["x-slack-signature"];
  const [version, slackHash] = requestSignature.split("=");

  const requestBody = qs.stringify(event.body, { format: "RFC1738" });
  const calculatedSignature = hmac.update(`${version}:${requestTimestamp}:${requestBody}`, "utf8").digest("hex");

  return crypto.timingSafeEqual(Buffer.from(calculatedSignature, "utf8"), Buffer.from(slackHash, "utf8"));
}

export const handler = async (event: ApiGatewayEvent) => {
  let body = JSON.parse(event.body);

  // verify request
  if (!validateSlackRequest(event)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Request was invalid" })
    };
  }

  // respond with challenge
  let response = {
    statusCode: 200,
    body: JSON.stringify({ challenge: body.challenge })
  };

  return response;
};
