import { Client, ClientOptions } from '@microsoft/microsoft-graph-client';
import { GraphApiAuthenticationProvider } from './graphApiAuthenticationProvider';
import { Token } from 'simple-oauth2';
import { clearUserTokens } from '../../services/dynamo';
import { sendAuthErrorMessage } from '../slack';

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
    case 'oof': {
      return ShowAs.OutOfOffice;
    }
    case 'workingElsewhere':
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

// This method is needed because the Microsoft Graph API returns date strings with unspecified timezone (but prefers UTC without a header)
// Documentation: https://docs.microsoft.com/en-us/graph/api/user-list-events?view=graph-rest-1.0&tabs=http#support-various-time-zones
const withUTCSuffix = (date: string) => (!date || date.endsWith('Z') ? date : `${date}Z`);

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
      .select('start,end,subject,showAs,location,sensitivity')
      .get();

    return outlookEvents.value.map((e: any) => {
      const event: CalendarEvent = {
        id: e.id,
        startTime: new Date(withUTCSuffix(e.start.dateTime)),
        endTime: new Date(withUTCSuffix(e.end.dateTime)),
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
        await sendAuthErrorMessage(email);
        await clearUserTokens(email);
      } finally {
        return null;
      }
    }
  }

  return [];
};
