import { UserSettings } from '../services/dynamo';
import { CalendarEvent, ShowAs } from '../services/calendar';
import { SlackStatus } from '../services/slack';

const getOOODateString = (endDateTime: Date | null, timeZone: string) => {
  if (!endDateTime) return '';

  const today = new Date();

  const endDateString = endDateTime.toLocaleDateString('en-us', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone });
  const todayDateString = today.toLocaleDateString('en-us', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone });

  // TODO: We have no good way of knowing an intl locale at the moment—is this something we need to supply via Office365 or store in user settings?
  return endDateString === todayDateString
    ? endDateTime.toLocaleTimeString('en-us', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone })
    : endDateTime.toLocaleDateString('en-us', { weekday: 'long', day: 'numeric', month: 'long', timeZone });
};

export const getStatusForUserEvent = (
  settings: UserSettings,
  event: CalendarEvent | null,
  userTimeZone: string = 'UTC',
): SlackStatus => {
  const expiration = event?.endTime.valueOf() || 0;

  const defaultStatusByVisibility = {
    [ShowAs.Free]: settings.defaultStatus || { text: '', emoji: '' },
    [ShowAs.Busy]: { text: 'Away', emoji: ':spiral_calendar_pad:', expiration },
    [ShowAs.Tentative]: { text: 'Away', emoji: ':spiral_calendar_pad:', expiration },
    [ShowAs.OutOfOffice]: {
      text: `OOO until ${getOOODateString(event && event.endTime, userTimeZone)}`,
      emoji: ':ooo:',
      expiration,
    },
  };

  if (!event) return defaultStatusByVisibility[ShowAs.Free];
  if (!settings.statusMappings) return defaultStatusByVisibility[event.showAs];

  // TODO: Consider a less naive approach than finding the first event that contains the mapping's text
  const relevantStatus =
    settings.statusMappings &&
    settings.statusMappings.find(
      (sm) => sm.calendarText && event.name.toLowerCase().includes(sm.calendarText.toLowerCase()),
    );

  // If there is a relevant status for this event set its expiration since that isn't stored in the mappings
  if (relevantStatus) {
    relevantStatus.slackStatus.expiration = expiration;
  }

  return relevantStatus ? relevantStatus.slackStatus : defaultStatusByVisibility[event.showAs];
};
