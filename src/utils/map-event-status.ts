import { UserSettings } from '../services/dynamo';
import { CalendarEvent, ShowAs } from '../services/calendar/calendar';
import { SlackStatus } from '../services/slack';

const getOOODateString = (endDateTime: Date | null, timeZone: string) => {
  if (!endDateTime) return '';

  const today = new Date();

  // TODO: We have no good way of knowing an intl locale at the moment—is this something we need to supply via Office365 or store in user settings?
  return endDateTime.getDate() === today.getDate()
    ? endDateTime.toLocaleTimeString('en-us', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone })
    : endDateTime.toLocaleDateString('en-us', { weekday: 'long', day: 'numeric', month: 'long', timeZone });
};

export const getStatusForUserEvent = (
  settings: UserSettings,
  event: CalendarEvent | null,
  userTimeZone: string = 'UTC',
): SlackStatus => {
  const defaultStatusByVisibility = {
    [ShowAs.Free]: settings.defaultStatus || { text: '', emoji: '' },
    [ShowAs.Busy]: { text: 'Away', emoji: ':spiral_calendar_pad:' },
    [ShowAs.Tentative]: { text: 'Away', emoji: ':spiral_calendar_pad:' },
    [ShowAs.OutOfOffice]: {
      text: `OOO until ${getOOODateString(event && event.endTime, userTimeZone)}`,
      emoji: ':ooo:',
    },
  };

  if (!event) return defaultStatusByVisibility[ShowAs.Free];
  if (!settings.statusMappings) return defaultStatusByVisibility[event.showAs];

  // TODO: Consider a less naive approach than finding the first event that contains the mapping's text
  const relevantStatus =
    settings.statusMappings &&
    settings.statusMappings.find(
      sm => sm.calendarText && event.name.toLowerCase().includes(sm.calendarText.toLowerCase()),
    );

  return relevantStatus ? relevantStatus.slackStatus : defaultStatusByVisibility[event.showAs];
};
