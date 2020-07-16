# CalendarToSlack

CalendarToSlack is a Slack integration that updates your status and presence in Slack whenever you're in an event according to Outlook. In a nutshell, it can:

- Set custom status messages and emoji based on your event names, once configured
- Use a default status and emoji for any OOO or Busy event you don't have configured
- Send you reminders in Slack for upcoming events with Zoom URLs and additional links from the event body

Check out the [Wiki](https://github.com/hudl/CalendarToSlack/wiki) for more information on how to use this with your Slack account and for complete documentation.

## Local Development

### Initial setup

The Lambda functions in this project use the Node 10.x runtime. Ensure you're running Node 10.x on the command line using a tool like [nvm](https://github.com/nvm-sh/nvm) or [nodist](https://github.com/nullivex/nodist). Then, clone the repository and install dependencies with [Yarn](https://yarnpkg.com/):

```bash
~$ git clone https://github.com/hudl/CalendarToSlack.git
~$ cd CalendarToSlack
CalendarToSlack$ yarn
```

Next, you'll need to create a `config.ts` file with the following structure in the project root directory (Hudl users can DM an existing user for the correct config file for our environment):

```typescript
// config.ts

export default {
  dynamoDb: {
    tableName: 'my-table-name',
  },
  region: 'us-east-1',
  hosts: {
    dev: 'http://localhost:3000',
    prod: 'https://some-id.execute-api.us-east-1.amazonaws.com/prod',
  },
  slack: {
    secretName: 'my/slack/AWS/secret/name',
    clientId: 'slack client ID',
  },
  microsoftGraph: {
    clientId: 'graph client ID',
    tenantId: 'graph tenant ID',
    secretName: 'my/graph/AWS/secret/name',
  },
};
```

Once you've done this, you can validate your installation by running `yarn test` in the project root directory:

```bash
CalendarToSlack$ yarn test
yarn run v1.12.3
$ jest
 PASS  src/slackbot/__tests__/settings.tests.ts
 PASS  src/utils/__tests__/eventHelper.tests.ts
 PASS  src/utils/__tests__/mapEventStatus.tests.ts
 PASS  src/__tests__/updateOne.tests.ts

Test Suites: 4 passed, 4 total
Tests:       88 passed, 88 total
Snapshots:   0 total
Time:        2.939s, estimated 7s
Ran all test suites.
✨  Done in 3.95s.
```

### Writing and debugging Lambda code

You can refer to [serverless.yml](./serverless.yml)—specifically the `functions` block—to see how the Lambda functions in AWS map to code entrypoints within the repository. All entrypoints other than the Slackbot handler currently live in [index.ts](./src/index.ts).

**Before running locally, please note**: The offline application still makes requests to production DynamoDB in the app's current state and can negatively affect the production environment, so please run locally with caution. It will also make requests to whatever Slack and Microsoft Graph clients you have configured in `config.ts`.

In order to run the Serverless application locally, you'll need a `serverless-config.yml` file in the project root directory (Hudl users can DM an existing user for the correct config file for our environment):

```yml
# serverless-config.yml

lambda:
  update:
    roleName: my-lambda-update-role
    policyName: my-lambda-update-policy
  slackbot:
    roleName: my-lambda-slackbot-role
    policyName: my-lambda-slackbot-policy
    secretsPrefix: my/lambda/slackbot/secret/prefix

deployment:
  bucketName: my-serverless-deployment-bucket
```

Once this config file is created, you can run the Serverless app offline with `yarn start`:

```bash
CalendarToSlack$ yarn start
yarn run v1.12.3
$ serverless offline
Serverless: Compiling with Typescript...
Serverless: Using local tsconfig.json
Serverless: Typescript compiled.
Serverless: Watching typescript files...
Serverless: Starting Offline: prod/us-east-1.

Serverless: Routes for slack-install:
Serverless: GET /slack/install
Serverless: POST /{apiVersion}/functions/calendar2slack-prod-slack-install/invocations

Serverless: Routes for create-user:
Serverless: GET /create-user
Serverless: POST /{apiVersion}/functions/calendar2slack-prod-create-user/invocations

Serverless: Routes for update:
Serverless: POST /update
Serverless: POST /{apiVersion}/functions/calendar2slack-prod-update/invocations

Serverless: Routes for update-batch:
Serverless: POST /{apiVersion}/functions/calendar2slack-prod-update-batch/invocations

Serverless: Routes for authorize-microsoft-graph:
Serverless: GET /authorize-microsoft-graph
Serverless: POST /{apiVersion}/functions/calendar2slack-prod-authorize-microsoft-graph/invocations

Serverless: Routes for slackbot:
Serverless: POST /bot
Serverless: POST /{apiVersion}/functions/calendar2slack-prod-slackbot/invocations

Serverless: Offline [HTTP] listening on http://localhost:3000
Serverless: Enter "rp" to replay the last request
```

If you need to debug the app locally with breakpoints, you can use `yarn debug` rather than `yarn start`. For those developing using VS Code, the "Debug Serverless" launch configuration can be used.

### Writing and debugging unit tests

When possible, unit tests should be written alongside code changes as the first line of defense against regressions. All unit tests live in a `__tests__` directory alongside their source code and follow the naming convention `filename.tests.ts`. Tests are written with [Jest](https://jestjs.io/). As shown in the setup guide, tests can be run using `yarn test`.

**Please note** that Jest automocking is disabled in [jest.config.js](./jest.config.js). If the code you're testing makes downstream calls to a third-party service (AWS DynamoDB, AWS Secrets Manager, Slack, Microsoft Graph), the services should be mocked like so:

```typescript
// myFunction.tests.ts

import { getEventsForUser, CalendarEvent, ShowAs } from '../services/calendar';
import { myFunction } from '../myFunction';

jest.mock('../services/calendar');

const getEventsForUserMock = <jest.Mock>getEventsForUser;

describe('myFunction', () => {
  test('gets events for a user', async () => {
    await myFunction();

    expect(getEventsForUserMock).toBeCalled();
  });
});
```

If you need to step through unit tests with breakpoints, you can use `yarn debug-tests` rather than `yarn test`. For those developing using VS Code, the "Debug Tests" launch configuration can be used.

## Deployment

CalendarToSlack doesn't currently have a staging environment, so local testing should be performed before submitting a pull request. Once the pull request is reviewed and merged, the code will be deployed to the Hudl instance of CalendarToSlack automatically using the [deploy.yml](./.github/workflows/deploy.yml) GitHub Action.

## Submitting Requests

The CalendarToSlack project board for Hudl has moved to Jira. If you are a non-Hudl employee looking to submit a request, please file a GitHub issue or pull request.
