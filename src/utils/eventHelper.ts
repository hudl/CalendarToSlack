import { CalendarEvent } from '../services/calendar/calendar';
import { UserSettings } from '../services/dynamo';
import { getUrlForRoom } from '../services/rooms';

const urlRegex = /((\w+:\/\/)[-a-zA-Z0-9:@;?&=\/%\+\.\*!'\(\),\$_\{\}\^~\[\]`#|]+)/g;

export const getEventLocationUrl = async (
  event: CalendarEvent | null,
  settings: UserSettings,
): Promise<string | null> => {
  const location = (event && event.location) || '';
  if (settings.zoomLinksDisabled || !event || !location) {
    return null;
  }

  const urlMatches = location.match(urlRegex) || (await getRoomLocationUrl(event));

  if (!urlMatches || urlMatches.length === 0) {
    return null;
  }

  // In some cases, with multiple locations listed, the url could end up with a semicolon.
  // While semicolons are valid in URLs, location URLs we're dealing with likely weren't
  // intended to include it.
  const url = urlMatches[0];
  return url.endsWith(';') ? url.slice(0, url.length - 1) : url;
};

export const getRoomLocationUrl = async (event: CalendarEvent | null): Promise<string[]> => {
  const location = (event && event.location) || '';
  const locations = location.split(';');

  const roomUrls: string[] = [];
  locations.forEach(async l => {
    const url = await getUrlForRoom(location);
    if (url) {
      roomUrls.push(...url);
    }
  });

  return roomUrls;
};
