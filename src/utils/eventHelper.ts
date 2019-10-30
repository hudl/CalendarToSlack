import { CalendarEvent } from '../services/calendar/calendar';
import { UserSettings } from '../services/dynamo';

export const getEventLocationUrl = (event: CalendarEvent | null, settings: UserSettings) => {
  const urlRegex = /((\w+:\/\/)[-a-zA-Z0-9:@;?&=\/%\+\.\*!'\(\),\$_\{\}\^~\[\]`#|]+)/g;
  const location = (event && event.location) || '';
  const urlMatches = location.match(urlRegex);

  if (settings.zoomLinksDisabled || !event || !location || !urlMatches || urlMatches.length === 0) {
    return null;
  }

  // In some cases, with multiple locations listed, the url could end up with a semicolon.
  // While semicolons are valid in URLs, location URLs we're dealing with likely weren't
  // intended to include it.
  const url = urlMatches[0];
  return url.endsWith(';') ? url.slice(0, url.length - 1) : url;
};
