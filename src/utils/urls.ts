import config from '../../config';

export const createUserUrl = () => `${process.env.IS_OFFLINE ? config.hosts.dev : config.hosts.prod}/create-user`;
export const slackInstallUrl = () => `${process.env.IS_OFFLINE ? config.hosts.dev : config.hosts.prod}/slack/install`;
export const authorizeMicrosoftGraphUrl = () =>
  `${process.env.IS_OFFLINE ? config.hosts.dev : config.hosts.prod}/authorize-microsoft-graph`;
