import { getStatusForUserEvent } from '../map-event-status';
import { ShowAs } from '../../services/calendar/calendar';

const baseUserSettings = { email: 'test@email.com', slackToken: 'abc' };

describe('getStatusForUserEvent', () => {
  describe('Given a null event', () => {
    test('Returns an empty status by default', () => {
      const status = getStatusForUserEvent(baseUserSettings, null);

      expect(status).toEqual({ text: '', emoji: '' });
    });

    test(`Returns the user's default status if present`, () => {
      const defaultStatus = { text: 'Hi', emoji: ':wave:' };
      const status = getStatusForUserEvent({ ...baseUserSettings, defaultStatus }, null);

      expect(status).toEqual(defaultStatus);
    });
  });

  test('Given any event, matches to a status regardless of casing', () => {
    const status = getStatusForUserEvent(
      {
        ...baseUserSettings,
        statusMappings: [
          {
            calendarText: 'quick chat',
            slackStatus: {
              text: 'Be right back',
              emoji: ':brb:',
            },
          },
        ],
      },
      {
        id: '1',
        name: 'Quick Chat',
        body: '',
        startTime: new Date(),
        endTime: new Date(),
        location: 'Zoom',
        showAs: ShowAs.Busy,
      },
    );

    expect(status).toEqual({
      text: 'Be right back',
      emoji: ':brb:',
    });
  });

  describe('Given a Free event', () => {
    test(`Returns the status mapping matching the event name if present`, () => {
      const defaultStatus = { text: 'Hi', emoji: ':wave:' };
      const status = getStatusForUserEvent(
        {
          ...baseUserSettings,
          defaultStatus,
          statusMappings: [
            {
              calendarText: 'Quick Chat',
              slackStatus: {
                text: 'Be right back',
                emoji: ':brb:',
              },
            },
          ],
        },
        {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: new Date(),
          location: 'Zoom',
          showAs: ShowAs.Free,
        },
      );

      expect(status).toEqual({
        text: 'Be right back',
        emoji: ':brb:',
      });
    });

    test(`Returns the user's default status if no status mappings match the event`, () => {
      const defaultStatus = { text: 'Hi', emoji: ':wave:' };
      const status = getStatusForUserEvent(
        {
          ...baseUserSettings,
          defaultStatus,
          statusMappings: [
            {
              calendarText: 'Some Event',
              slackStatus: {
                text: 'At some event',
                emoji: ':emoji:',
              },
            },
          ],
        },
        {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: new Date(),
          location: 'Zoom',
          showAs: ShowAs.Free,
        },
      );

      expect(status).toEqual(defaultStatus);
    });

    test(`Returns the user's default status if the user has no status mappings`, () => {
      const defaultStatus = { text: 'Hi', emoji: ':wave:' };
      const status = getStatusForUserEvent(
        { ...baseUserSettings, defaultStatus },
        {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: new Date(),
          location: 'Zoom',
          showAs: ShowAs.Free,
        },
      );

      expect(status).toEqual(defaultStatus);
    });

    test('Returns an empty status without a status mapping or default status', () => {
      const status = getStatusForUserEvent(baseUserSettings, {
        id: '1',
        name: 'Quick Chat',
        body: '',
        startTime: new Date(),
        endTime: new Date(),
        location: 'Zoom',
        showAs: ShowAs.Free,
      });

      expect(status).toEqual({ text: '', emoji: '' });
    });
  });

  describe('Given a Busy event', () => {
    test(`Returns the status mapping matching the event name if present`, () => {
      const defaultStatus = { text: 'Hi', emoji: ':wave:' };
      const status = getStatusForUserEvent(
        {
          ...baseUserSettings,
          defaultStatus,
          statusMappings: [
            {
              calendarText: 'Quick Chat',
              slackStatus: {
                text: 'Be right back',
                emoji: ':brb:',
              },
            },
          ],
        },
        {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: new Date(),
          location: 'Zoom',
          showAs: ShowAs.Busy,
        },
      );

      expect(status).toEqual({
        text: 'Be right back',
        emoji: ':brb:',
      });
    });

    test(`Returns "Away" and :spiral_calendar_pad: when the user has no relevant status mappings`, () => {
      const defaultStatus = { text: 'Hi', emoji: ':wave:' };
      const status = getStatusForUserEvent(
        {
          ...baseUserSettings,
          defaultStatus,
          statusMappings: [
            {
              calendarText: 'Some Event',
              slackStatus: {
                text: 'At some event',
                emoji: ':emoji:',
              },
            },
          ],
        },
        {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: new Date(),
          location: 'Zoom',
          showAs: ShowAs.Busy,
        },
      );

      expect(status).toEqual({ text: 'Away', emoji: ':spiral_calendar_pad:' });
    });

    test(`Returns "Away" and :spiral_calendar_pad: when the user has no status mappings`, () => {
      const status = getStatusForUserEvent(baseUserSettings, {
        id: '1',
        name: 'Quick Chat',
        body: '',
        startTime: new Date(),
        endTime: new Date(),
        location: 'Zoom',
        showAs: ShowAs.Busy,
      });

      expect(status).toEqual({ text: 'Away', emoji: ':spiral_calendar_pad:' });
    });
  });

  describe('Given a Tentative event', () => {
    test(`Returns the status mapping matching the event name if present`, () => {
      const defaultStatus = { text: 'Hi', emoji: ':wave:' };
      const status = getStatusForUserEvent(
        {
          ...baseUserSettings,
          defaultStatus,
          statusMappings: [
            {
              calendarText: 'Quick Chat',
              slackStatus: {
                text: 'Be right back',
                emoji: ':brb:',
              },
            },
          ],
        },
        {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: new Date(),
          location: 'Zoom',
          showAs: ShowAs.Tentative,
        },
      );

      expect(status).toEqual({
        text: 'Be right back',
        emoji: ':brb:',
      });
    });

    test(`Returns "Away" and :spiral_calendar_pad: when the user has no relevant status mappings`, () => {
      const status = getStatusForUserEvent(
        {
          ...baseUserSettings,
          statusMappings: [
            {
              calendarText: 'Some Event',
              slackStatus: {
                text: 'At some event',
                emoji: ':emoji:',
              },
            },
          ],
        },
        {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: new Date(),
          location: 'Zoom',
          showAs: ShowAs.Tentative,
        },
      );

      expect(status).toEqual({ text: 'Away', emoji: ':spiral_calendar_pad:' });
    });

    test(`Returns "Away" and :spiral_calendar_pad: when the user has no status mappings`, () => {
      const status = getStatusForUserEvent(baseUserSettings, {
        id: '1',
        name: 'Quick Chat',
        body: '',
        startTime: new Date(),
        endTime: new Date(),
        location: 'Zoom',
        showAs: ShowAs.Tentative,
      });

      expect(status).toEqual({ text: 'Away', emoji: ':spiral_calendar_pad:' });
    });
  });

  describe('Given an OutOfOffice event', () => {
    test(`Returns the status mapping matching the event name if present`, () => {
      const defaultStatus = { text: 'Hi', emoji: ':wave:' };
      const status = getStatusForUserEvent(
        {
          ...baseUserSettings,
          defaultStatus,
          statusMappings: [
            {
              calendarText: 'Quick Chat',
              slackStatus: {
                text: 'Be right back',
                emoji: ':brb:',
              },
            },
          ],
        },
        {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: new Date(),
          location: 'Zoom',
          showAs: ShowAs.OutOfOffice,
        },
      );

      expect(status).toEqual({
        text: 'Be right back',
        emoji: ':brb:',
      });
    });

    describe('Given no status mappings', () => {
      test(`Returns "OOO until {date}" and :ooo: when the OOO event lasts beyond the current day`, () => {
        const today = new Date();
        const status = getStatusForUserEvent(baseUserSettings, {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: {
            ...today,
            getDate: jest.fn(() => today.getDate() + 1),
            toLocaleDateString: jest.fn(() => 'tomorrow'),
            toLocaleTimeString: jest.fn(() => '2pm'),
          },
          location: 'Zoom',
          showAs: ShowAs.OutOfOffice,
        });

        expect(status).toEqual({ text: 'OOO until tomorrow', emoji: ':ooo:' });
      });

      test(`Returns "OOO until {time}" in the user's timezone and :ooo: when the OOO event ends on the current day`, () => {
        const today = new Date();
        const status = getStatusForUserEvent(baseUserSettings, {
          id: '1',
          name: 'Quick Chat',
          body: '',
          startTime: new Date(),
          endTime: {
            ...today,
            getDate: jest.fn(() => today.getDate()),
            toLocaleDateString: jest.fn(() => 'tomorrow'),
            toLocaleTimeString: jest.fn(() => '2pm'),
          },
          location: 'Zoom',
          showAs: ShowAs.OutOfOffice,
        });

        expect(status).toEqual({ text: 'OOO until 2pm', emoji: ':ooo:' });
      });
    });

    describe('Given no relevant status mappings', () => {
      test(`Returns "OOO until {date}" and :ooo: when the OOO event lasts beyond the current day`, () => {
        const today = new Date();
        const status = getStatusForUserEvent(
          {
            ...baseUserSettings,
            statusMappings: [
              {
                calendarText: 'Some Event',
                slackStatus: {
                  text: 'At some event',
                  emoji: ':emoji:',
                },
              },
            ],
          },
          {
            id: '1',
            name: 'Quick Chat',
            body: '',
            startTime: new Date(),
            endTime: {
              ...today,
              getDate: jest.fn(() => today.getDate() + 1),
              toLocaleDateString: jest.fn(() => 'tomorrow'),
              toLocaleTimeString: jest.fn(() => '2pm'),
            },
            location: 'Zoom',
            showAs: ShowAs.OutOfOffice,
          },
        );

        expect(status).toEqual({ text: 'OOO until tomorrow', emoji: ':ooo:' });
      });

      test(`Returns "OOO until {time}" and :ooo: when the OOO event ends on the current day`, () => {
        const today = new Date();
        const status = getStatusForUserEvent(
          {
            ...baseUserSettings,
            statusMappings: [
              {
                calendarText: 'Some Event',
                slackStatus: {
                  text: 'At some event',
                  emoji: ':emoji:',
                },
              },
            ],
          },
          {
            id: '1',
            name: 'Quick Chat',
            body: '',
            startTime: new Date(),
            endTime: {
              ...today,
              getDate: jest.fn(() => today.getDate()),
              toLocaleDateString: jest.fn(() => 'tomorrow'),
              toLocaleTimeString: jest.fn(() => '2pm'),
            },
            location: 'Zoom',
            showAs: ShowAs.OutOfOffice,
          },
        );

        expect(status).toEqual({ text: 'OOO until 2pm', emoji: ':ooo:' });
      });
    });
  });
});
