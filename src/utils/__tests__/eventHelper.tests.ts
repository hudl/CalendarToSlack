import { getEventUrl } from '../eventHelper';
import { ShowAs, CalendarEvent } from '../../services/calendar/calendar';
import { UserSettings } from '../../services/dynamo';

const baseUserSettings: UserSettings = { email: 'test@email.com', slackToken: 'abc' };
const baseEvent: CalendarEvent = {
  id: '1',
  name: 'Quick Chat',
  body: '',
  startTime: new Date(),
  endTime: new Date(),
  location: '',
  showAs: ShowAs.Free,
};

describe('getEventLocationUrl', () => {
  describe('Given a null event', () => {
    test('Returns null', () => {
      const url = getEventUrl(null, baseUserSettings);

      expect(url).toBeNull();
    });
  });

  describe('Url-only locations', () => {
    const testUrl = 'https://my.test.url';

    test('Url-only returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}`,
      };
      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Front-padded url returns just the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `   ${testUrl}`,
      };
      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Back-padded url returns just the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}     `,
      };
      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
  });

  describe('Non-url locations', () => {
    test('Gibberish returns null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'asdfqweoriu-123-wequio',
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Names returns null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Jane Smith',
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Meeting room names return null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Michael Jordan',
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Semicolon-separated names return null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Michael Jordan; Candace Parker; Bob Smith',
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
  });

  describe('Mixed locations', () => {
    const testUrl = 'https://my.test.url/stuff?123';
    test('Url-first returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl} Michael Jordan`,
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Semicolon-separated returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}; Michael Jordan`,
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url last returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl}`,
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url last with semicolon returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl};`,
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url middle returns the url', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl}; Scrum Masters;`,
      };

      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
  });
  describe('Bodies with zoom links', () => {
    const testUrl = 'https://my.test.url/stuff?123';
    const testZoomUrl = 'https://hudl.zoom.us/j/1234?param=5678';

    test('Non-zoom url in body returns null', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Test Location',
        body: `Check out my link ${testUrl}`,
      };
      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Zoom url in body returns zoom link', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Test Location',
        body: `Check out my link ${testZoomUrl}`,
      };
      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testZoomUrl);
    });
    test('Url in location overrides body', () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Test Location; ${testUrl}`,
        body: `Check out my link ${testZoomUrl}`,
      };
      const url = getEventUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
  });
});
