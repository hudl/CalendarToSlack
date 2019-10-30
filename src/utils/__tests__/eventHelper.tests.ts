import { getEventLocationUrl } from '../eventHelper';
import { ShowAs, CalendarEvent } from '../../services/calendar/calendar';
import { UserSettings } from '../../services/dynamo';

const baseUserSettings: UserSettings = { email: 'test@email.com', slackToken: 'abc' };
const baseEvent: CalendarEvent = {
  id: '1',
  name: 'Quick Chat',
  startTime: new Date(),
  endTime: new Date(),
  location: '',
  showAs: ShowAs.Free,
};

describe('getEventLocationUrl', () => {
  describe('Given a null event', () => {
    test('Returns null', async () => {
      const url = await getEventLocationUrl(null, baseUserSettings);

      expect(url).toBeNull();
    });
  });

  describe('Url-only locations', () => {
    const testUrl = 'https://my.test.url';

    test('Url-only returns the url', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}`,
      };
      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Front-padded url returns just the url', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `   ${testUrl}`,
      };
      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Back-padded url returns just the url', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}     `,
      };
      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
  });

  describe('Non-url locations', () => {
    test('Gibberish returns null', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'asdfqweoriu-123-wequio',
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Names returns null', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Jane Smith',
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Meeting room names return null', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Michael Jordan',
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
    test('Semicolon-separated names return null', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: 'Michael Jordan; Candace Parker; Bob Smith',
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBeNull();
    });
  });

  describe('Mixed locations', () => {
    const testUrl = 'https://my.test.url/stuff?123';
    test('Url-first returns the url', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl} Michael Jordan`,
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Semicolon-separated returns the url', async() => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `${testUrl}; Michael Jordan`,
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url last returns the url', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl}`,
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url last with semicolon returns the url', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl};`,
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
    test('Url middle returns the url', async () => {
      const event: CalendarEvent = {
        ...baseEvent,
        location: `Michael Jordan; ${testUrl}; Scrum Masters;`,
      };

      const url = await getEventLocationUrl(event, baseUserSettings);

      expect(url).toBe(testUrl);
    });
  });
});
