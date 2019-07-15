import { Client, ClientOptions } from "@microsoft/microsoft-graph-client";
import { GraphApiAuthenticationProvider } from "./graphApiAuthenticationProvider";

export enum ShowAs {
  Free = 1,
  Busy,
  Tentative,
  OutOfOffice,
}

export type CalendarEvent = {
  name: string;
  start: {
    dateTime: Date;
  };
  end: {
    dateTime: Date;
  };
  location: {
    displayName: string;
  }
  showAs: ShowAs;
};

const userEvents: {
  [email: string]: CalendarEvent[];
} = {
  'jordan.degner@hudl.com': [
    {
      name: 'Quick Chat',
      start: { dateTime: new Date('7/14/2019') },
      end: { dateTime: new Date('7/15/2019') },
      location: { displayName: 'Zoom' },
      showAs: ShowAs.Busy,
    },
  ],
};

const getAuthenticatedClient = (): Client => {
  const options: ClientOptions = {
    authProvider: new GraphApiAuthenticationProvider(),
  };
  return Client.initWithMiddleware(options);
};

export const getEventsForUser = async (email: string): Promise<CalendarEvent[]> => {
  // TODO: Implement this function to retrieve a list of current calendar events for a given Outlook user
  let events = userEvents[email];
  try {
    
    events = await getAuthenticatedClient().api(`/users/${email}/events`).select('start,end,subject,showAs,location').get();
  } catch (error) {
    console.error(error);
  }
  return events || [];
};
