export default {
  dynamoDb: {
    tableName: 'cal2slack-usersettings',
  },
  region: 'us-east-1',
  hosts: {
    dev: 'http://localhost:3000',
    prod: '',
  },
  slack: {
    secretName: '',
    clientId: '',
  },
  microsoftGraph: {
    clientId: '',
    tenantId: '',
    secretName: '',
  },
};
