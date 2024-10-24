export default {
  dynamoDb: {
    tableName: '',
  },
  region: 'us-east-1',
  hosts: {
    devLambda: 'http://localhost:3002',
    dev: 'http://localhost:3000',
    prod: '',
  },
  slack: {
    secretName: 'hudl/internal/cal2slack/slackbot-secrets',
    clientId: 'hudl/internal/cal2slack/slackbot-client-id',
  },
  microsoftGraph: {
    ids: 'hudl/internal/cal2slack/microsoftGraph-ids',
    secretName: 'hudl/internal/cal2slack/microsoft-graph',
  },
};