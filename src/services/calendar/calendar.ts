import { Client, ClientOptions } from '@microsoft/microsoft-graph-client';
import { GraphApiAuthenticationProvider } from './graphApiAuthenticationProvider';
import { Token } from 'simple-oauth2';
import { clearUserTokens } from '../../services/dynamo';

export enum ShowAs {
  Free = 1,
  Tentative,
  Busy,
  OutOfOffice,
}

export type CalendarEvent = {
  id: string;
  name: string;
  startTime: Date;
  endTime: Date;
  location: string;
  showAs: ShowAs;
};

const toShowAsStatus = (status: string): ShowAs => {
  switch (status.toLowerCase()) {
    case 'oof':
    case 'workingElsewhere': {
      return ShowAs.OutOfOffice;
    }
    case 'busy': {
      return ShowAs.Busy;
    }
    case 'tentative': {
      return ShowAs.Tentative;
    }
    case 'free':
    default: {
      return ShowAs.Free;
    }
  }
};

const getAuthenticatedClient = (email: string, token: Token): Client => {
  const options: ClientOptions = {
    authProvider: new GraphApiAuthenticationProvider(email, token),
  };
  return Client.initWithMiddleware(options);
};

export const getEventsForUser = async (email: string, storedToken: Token): Promise<CalendarEvent[] | null> => {
  if (!storedToken) return null;

  const now = new Date();

  const startTime = new Date(now);
  startTime.setMinutes(now.getMinutes() - 1);

  const endTime = new Date(now);
  endTime.setMinutes(now.getMinutes() + 1);

  try {
    const outlookEvents = await getAuthenticatedClient(email, storedToken)
      .api(`/users/${email}/calendarView?startDateTime=${startTime.toISOString()}&endDateTime=${endTime.toISOString()}`)
      .orderby('start/dateTime')
      .select('start,end,subject,showAs,location,sensitivity')
      .get();

    return outlookEvents.value.map((e: any) => {
      const event: CalendarEvent = {
        id: e.id,
        startTime: new Date(e.start.dateTime),
        endTime: new Date(e.end.dateTime),
        location: e.location.displayName,
        showAs: toShowAsStatus(e.showAs),
        name: e.sensitivity === 'normal' ? e.subject : 'Private event',
      };
      return event;
    });
  } catch (error) {
    console.error(error);

    const { statusCode } = error;
    if (statusCode === 401 || statusCode === 403) {
      console.error(`No authorization for Graph API for user ${email}`);
      try {
        await clearUserTokens(email);
      } finally {
        return null;
      }
    }
  }

  return [];
};
