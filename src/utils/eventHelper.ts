import { CalendarEvent } from '../services/calendar/calendar';
import { UserSettings } from '../services/dynamo';

export const getEventUrl = (event: CalendarEvent | null, settings: UserSettings) => {
  if (settings.zoomLinksDisabled || !event) {
    return null;
  }
  const allUrlRegex = /((\w+:\/\/)[-a-zA-Z0-9:@;?&=\/%\+\.\*!'\(\),\$_\{\}\^~\[\]`#|]+)/g;
  const location = (event && event.location) || '';
  let urlMatches = location.match(allUrlRegex);
  
  if (!location || !urlMatches || urlMatches.length === 0) {
    const zoomUrlRegex = /https:\/\/hudl.zoom.us(\/\S*)?/g;
    urlMatches = event.body.match(zoomUrlRegex);
  }

  if (!urlMatches || urlMatches.length === 0) {
    return null;
  }

  // In some cases, with multiple locations listed, the url could end up with a semicolon.
  // While semicolons are valid in URLs, location URLs we're dealing with likely weren't
  // intended to include it.
  const url = urlMatches[0];
  return url.endsWith(';') ? url.slice(0, url.length - 1) : url;
};
