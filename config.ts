export default {
  dynamoDb: {
    tableName: 'cal2slack-usersettings',
    exportedSettingsTableName: 'cal2slack-exportedsettings',
  },
  region: 'us-east-1',
  hosts: {
    dev: 'http://localhost:3000',
    prod: 'https://c242y9d8ki.execute-api.us-east-1.amazonaws.com/prod',
  },
  slack: {
    secretName: 'hudl/internal/cal2slack/slackbot-secrets',
    clientId: '',
  },
  microsoftGraph: {
    clientId: '',
    tenantId: '',
    secretName: 'hudl/internal/cal2slack/microsoft-graph',
  },
};
