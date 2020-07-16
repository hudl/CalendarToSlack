import { handleUpdateSettings } from '../settings';
import { setZoomLinksDisabled, setMeetingReminderTimingOverride } from '../../services/dynamo';

jest.mock('../../services/dynamo');

const setZoomLinksMock = <jest.Mock>setZoomLinksDisabled;
setZoomLinksMock.mockResolvedValue({});

const meetingReminderMock = <jest.Mock>setMeetingReminderTimingOverride;
meetingReminderMock.mockResolvedValue({});

const userSettings = {
  email: 'blah@blah.com',
};

describe('handleUpdateSettings', () => {
  describe('With no arguments provided', () => {
    test('Returns a message requesting at least one argument', async () => {
      const message = await handleUpdateSettings(userSettings, []);

      expect(message).toBe(
        'You must provide at least one argument. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki',
      );
    });
  });
  describe('With unsupported arguments', () => {
    test('Returns a message requesting a supported argument', async () => {
      const message = await handleUpdateSettings(userSettings, ['my-command = hello']);

      expect(message).toBe(
        'No supported arguments given. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki',
      );
    });
    test('Does not update any settings in DynamoDB', async () => {
      await handleUpdateSettings(userSettings, ['my-command = hello']);

      expect(meetingReminderMock).not.toBeCalled();
      expect(setZoomLinksMock).not.toBeCalled();
    });
  });
  describe('With zoom-links argument', () => {
    test('Returns settings updated message', async () => {
      const message = await handleUpdateSettings(userSettings, ['zoom-links=true']);

      expect(message).toBe('Your settings have been updated.');
    });
    test('Updates the zoom-links setting in DynamoDB', async () => {
      await handleUpdateSettings(userSettings, ['zoom-links=true']);

      expect(setZoomLinksMock).toBeCalledWith(userSettings.email, false);
    });
  });
  describe('With reminder-timing argument', () => {
    test('Returns settings updated message', async () => {
      const message = await handleUpdateSettings(userSettings, ['reminder-timing=15']);

      expect(message).toBe('Your settings have been updated.');
    });
    test('Updates the reminder-timing setting in DynamoDB', async () => {
      await handleUpdateSettings(userSettings, ['reminder-timing=15']);

      expect(meetingReminderMock).toBeCalledWith(userSettings.email, 15);
    });
  });
  describe('With multiple arguments', () => {
    test('Returns settings updated message', async () => {
      const message = await handleUpdateSettings(userSettings, ['zoom-links=true', 'reminder-timing=15']);

      expect(message).toBe('Your settings have been updated.');
    });
    test('Updates the zoom-links setting in DynamoDB', async () => {
      await handleUpdateSettings(userSettings, ['zoom-links=true', 'reminder-timing=15']);

      expect(setZoomLinksMock).toBeCalledWith(userSettings.email, false);
    });
    test('Updates the reminder-timing setting in DynamoDB', async () => {
      await handleUpdateSettings(userSettings, ['zoom-links=true', 'reminder-timing=15']);

      expect(meetingReminderMock).toBeCalledWith(userSettings.email, 15);
    });
  });
});
