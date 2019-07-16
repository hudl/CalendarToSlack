export enum ShowAs {
  Free = 1,
  Busy,
  Tentative,
  OutOfOffice,
}

export type CalendarEvent = {
  name: string;
  startDate: Date;
  endDate: Date;
  location: string;
  showAs: ShowAs;
};

const userEvents: {
  [email: string]: CalendarEvent[];
} = {
  'jordan.degner@hudl.com': [
    {
      name: 'Skunkworks',
      startDate: new Date('7/15/2019'),
      endDate: new Date('7/17/2019'),
      location: 'HQ',
      showAs: ShowAs.Busy,
    },
  ],
};

export const getEventsForUser = async (email: string): Promise<CalendarEvent[]> => {
  // TODO: Implement this function to retrieve a list of current calendar events for a given Outlook user
  return userEvents[email] || [];
};
