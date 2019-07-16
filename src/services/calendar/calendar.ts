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
  startTime: Date;
  endTime: Date;
  location: string;
  showAs: ShowAs;
};

const toShowAsStatus = (status: string): ShowAs => {
  switch(status.toLowerCase()) {
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

const userEvents: {
  [email: string]: CalendarEvent[];
} = {
  'jordan.degner@hudl.com': [
    {
      name: 'Quick Chat',
      startTime: new Date('7/14/2019'),
      endTime: new Date('7/15/2019'),
      location: 'Zoom',
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
  let events = userEvents[email];
  const startTime = new Date();
  startTime.setMinutes(0);

  const endTime = new Date(startTime);
  endTime.setHours(startTime.getHours() + 1);

  try {
    const outlookEvents = await getAuthenticatedClient()
      .api(`/users/${email}/events`)
      .filter(`sensitivity eq 'normal' and start/dateTime le '${startTime.toISOString()}' and end/dateTime ge '${endTime.toISOString()}'`)
      .select('start,end,subject,showAs,location')
      .get();
    console.log(outlookEvents);
    events = outlookEvents.map((e: any) => { 
      const event: CalendarEvent = {
        name: e.subject,
        startTime: e.start.dateTime,
        endTime: e.end.dateTime,
        location: e.location.displayName,
        showAs: toShowAsStatus(e.showAs),
      };
      return event;
    });
  } catch (error) {
    console.error(error);
  }

  // TODO: remove stubbed out return
  return events || [];
};
