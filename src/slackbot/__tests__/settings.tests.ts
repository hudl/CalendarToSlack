import { handleSettings } from '../settings';
import {
  setZoomLinksDisabled,
  setMeetingReminderTimingOverride,
  setSnoozed,
  UserSettings, ExportedSettings
} from '../../services/dynamo';

jest.mock('../../services/dynamo');

const setZoomLinksMock = <jest.Mock>setZoomLinksDisabled;
setZoomLinksMock.mockResolvedValue({});

const meetingReminderMock = <jest.Mock>setMeetingReminderTimingOverride;
meetingReminderMock.mockResolvedValue({});

const setSnoozedMock = <jest.Mock>setSnoozed;
setSnoozedMock.mockResolvedValue({});

const userSettings = {
  email: 'blah@blah.com',
  statusMappings: [
    {
      calendarText: 'busy',
      slackStatus: {
        text: 'busy',
        emoji: ':calendar:',
      },
    },
  ],
};

describe('handleSettings', () => {
  describe('With no arguments provided', () => {
    test('Returns a message requesting at least one argument', async () => {
      const message = await handleSettings(userSettings, []);

      expect(message).toBe(
        'You must provide at least one argument. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki',
      );
    });
  });
  describe('With unsupported arguments', () => {
    test('Returns a message requesting a supported argument', async () => {
      const message = await handleSettings(userSettings, ['my-command = hello']);

      expect(message).toBe(
        'No supported arguments given. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki',
      );
    });
    test('Does not update any settings in DynamoDB', async () => {
      await handleSettings(userSettings, ['my-command = hello']);

      expect(meetingReminderMock).not.toBeCalled();
      expect(setZoomLinksMock).not.toBeCalled();
    });
  });
  describe('With show argument for user with no settings set', () => {
    test('Returns message displaying defaults for all settings', async () => {
      const message = await handleSettings(userSettings, ['show']);

      expect(message).toBe(`Here are your current settings:
• \`zoom-links\`: \`true\`
• \`reminder-timing\`: \`1\`
• \`snoozed\`: \`false\``);
    });
  });
  describe('With show argument for user with zoom-links set', () => {
    test('Returns message displaying current value for zoom-links', async () => {
      const message = await handleSettings({ ...userSettings, zoomLinksDisabled: true }, ['show']);

      expect(message).toBe(
        `Here are your current settings:
• \`zoom-links\`: \`false\`
• \`reminder-timing\`: \`1\`
• \`snoozed\`: \`false\``,
      );
    });
  });
  describe('With show argument for user with reminder-timing set', () => {
    test('Returns message displaying current value for reminder-timing', async () => {
      const message = await handleSettings({ ...userSettings, meetingReminderTimingOverride: 15 }, ['show']);

      expect(message).toBe(
        `Here are your current settings:
• \`zoom-links\`: \`true\`
• \`reminder-timing\`: \`15\`
• \`snoozed\`: \`false\``,
      );
    });
  });
  describe('With show argument for user with all settings set', () => {
    test('Returns message displaying current value for all settings', async () => {
      const message = await handleSettings(
        { ...userSettings, zoomLinksDisabled: true, meetingReminderTimingOverride: 15, snoozed: true },
        ['show'],
      );

      expect(message).toBe(
        `Here are your current settings:
• \`zoom-links\`: \`false\`
• \`reminder-timing\`: \`15\`
• \`snoozed\`: \`true\``,
      );
    });
  });
  describe('With zoom-links argument', () => {
    beforeEach(() => {
      setZoomLinksMock.mockResolvedValueOnce({ ...userSettings, zoomLinksDisabled: true });
    });
    test('Returns settings updated message', async () => {
      const message = await handleSettings(userSettings, ['zoom-links=false']);

      expect(message).toBe(
        `Your settings have been updated:
• \`zoom-links\`: \`false\`
• \`reminder-timing\`: \`1\`
• \`snoozed\`: \`false\``,
      );
    });
    test('Updates the zoom-links setting in DynamoDB', async () => {
      await handleSettings(userSettings, ['zoom-links=true']);

      expect(setZoomLinksMock).toBeCalledWith(userSettings.email, false);
    });
  });
  describe('With snoozed argument', () => {
    beforeEach(() => {
      setSnoozedMock.mockResolvedValueOnce({ ...userSettings, snoozed: true });
    });
    test('Returns settings updated message', async () => {
      const message = await handleSettings(userSettings, ['snoozed=true']);

      expect(message).toBe(
        `Your settings have been updated:
• \`zoom-links\`: \`true\`
• \`reminder-timing\`: \`1\`
• \`snoozed\`: \`true\``,
      );
    });
    test('Updates the snoozed setting in DynamoDB', async () => {
      await handleSettings(userSettings, ['snoozed=true']);

      expect(setSnoozedMock).toBeCalledWith(userSettings.email, true);
    });
  });
  describe('With reminder-timing argument', () => {
    beforeEach(() => {
      meetingReminderMock.mockResolvedValueOnce({ ...userSettings, meetingReminderTimingOverride: 15 });
    });
    test('Returns settings updated message', async () => {
      const message = await handleSettings(userSettings, ['reminder-timing=15']);

      expect(message).toBe(
        `Your settings have been updated:
• \`zoom-links\`: \`true\`
• \`reminder-timing\`: \`15\`
• \`snoozed\`: \`false\``,
      );
    });
    test('Updates the reminder-timing setting in DynamoDB', async () => {
      await handleSettings(userSettings, ['reminder-timing=15']);

      expect(meetingReminderMock).toBeCalledWith(userSettings.email, 15);
    });
  });
  describe('With multiple arguments', () => {
    beforeEach(() => {
      setZoomLinksMock.mockResolvedValueOnce({ ...userSettings, zoomLinksDisabled: true });
      meetingReminderMock.mockResolvedValueOnce({
        ...userSettings,
        zoomLinksDisabled: true,
        meetingReminderTimingOverride: 15,
      });
      setSnoozedMock.mockResolvedValueOnce({
        ...userSettings,
        zoomLinksDisabled: true,
        meetingReminderTimingOverride: 15,
        snoozed: true,
      });
    });
    test('Returns settings updated message', async () => {
      const message = await handleSettings(userSettings, ['zoom-links=false', 'reminder-timing=15', 'snoozed=true']);

      expect(message).toBe(
        `Your settings have been updated:
• \`zoom-links\`: \`false\`
• \`reminder-timing\`: \`15\`
• \`snoozed\`: \`true\``,
      );
    });
    test('Updates the zoom-links setting in DynamoDB', async () => {
      await handleSettings(userSettings, ['zoom-links=false', 'reminder-timing=15', 'snoozed=true']);

      expect(setZoomLinksMock).toBeCalledWith(userSettings.email, true);
    });
    test('Updates the reminder-timing setting in DynamoDB', async () => {
      await handleSettings(userSettings, ['zoom-links=false', 'reminder-timing=15', 'snoozed=true']);

      expect(meetingReminderMock).toBeCalledWith(userSettings.email, 15);
    });
    test('Updates the snoozed setting in DynamoDB', async () => {
      await handleSettings(userSettings, ['zoom-links=false', 'reminder-timing=15', 'snoozed=true']);

      expect(setSnoozedMock).toBeCalledWith(userSettings.email, true);
    });
  });
});
