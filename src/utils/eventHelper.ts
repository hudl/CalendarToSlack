import { CalendarEvent } from '../services/calendar/calendar';
import { UserSettings } from '../services/dynamo';

const allUrlRegex = /((\w+:\/\/)[-a-zA-Z0-9:@;?&=\/%\+\.\*!'\(\),\$_\{\}\^~\[\]`#|]+)/g;

export const getEventLocationUrl = (event: CalendarEvent | null, settings: UserSettings) => {
  if (settings.zoomLinksDisabled || !event) {
    return null;
  }

  const location = (event && event.location) || '';
  let urlMatches = location.match(allUrlRegex);

  if (!location || !urlMatches || urlMatches.length === 0) {
    const zoomUrlRegex = /https:\/\/\w*.zoom.us(\/[^\s"'<>]*)?/g;
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

export const getAdditionalEventLinks = (event: CalendarEvent | null) => {
  if (!event) {
    return [];
  }

  // It's obviously valid for URLs to include periods, but it's common for people to put a URL
  // right before a period, like https://google.com. In that case, we'll truncate the trailing period.
  const urlMatches = (event.body.match(allUrlRegex) || []).map((match) =>
    match.endsWith('.') ? match.slice(0, match.length - 1) : match,
  );

  return urlMatches && urlMatches.length ? [...new Set(urlMatches)] : [];
};

export const getUpcomingEventMessage = (event: CalendarEvent | null, settings: UserSettings) => {
  if (!event) return null;

  const locationUrl = getEventLocationUrl(event, settings);
  if (!locationUrl) return null;

  const additionalUrls = getAdditionalEventLinks(event);
  let message = `Join *${event.name}* at: ${locationUrl}`;

  if (additionalUrls.length) {
    message = message.concat(
      '. Helpful links:',
      ...additionalUrls.filter((url) => url.toLowerCase() !== locationUrl.toLowerCase()).map((url) => `\n* ${url}`),
    );
  }

  return message;
};
