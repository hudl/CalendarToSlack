import {
  upsertStatusMappings,
  getExportedSettingsBySettingsId,
  getSettingsForUsers,
  exportSettings,
  UserSettings, ExportedSettings
} from '../../services/dynamo';
import {handleMappings} from "../mappings";

jest.mock('../../services/dynamo');

const exportSettingsMock = <jest.Mock>exportSettings;
const getSettingsForUsersMock = <jest.Mock>getSettingsForUsers;
const upsertStatusMappingsMock = <jest.Mock>upsertStatusMappings;
const getExportedSettingsBySettingsIdMock = <jest.Mock>getExportedSettingsBySettingsId;

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

describe('handleMappings', () => {
  describe('With no arguments provided', () => {
    test('Returns a message requesting at least one argument', async () => {
      const message = await handleMappings(userSettings, []);

      expect(message).toBe(
        'You must provide at least one argument. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki',
      );
    });
  });
  describe('With unsupported arguments', () => {
    test('Returns a message requesting a supported argument', async () => {
      const message = await handleMappings(userSettings, ['my-command = hello']);

      expect(message).toBe(
        'No supported arguments given. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki',
      );
    });
    test('Does not update any settings in DynamoDB', async () => {
      await handleMappings(userSettings, ['my-command = hello']);

      expect(exportSettingsMock).not.toBeCalled();
      expect(upsertStatusMappingsMock).not.toBeCalled();
    });
  });
  
  describe('With export argument', () => {
    beforeEach(() => {
      exportSettingsMock.mockResolvedValueOnce("123");
    });
    test('Returns exported message', async () => {
      const message = await handleMappings(userSettings, ['export']);

      expect(message).toBe(
        'Your status mappings have been exported with the ID: 123'
      );
    });
    test('Exports settings in DynamoDB', async () => {
      await handleMappings(userSettings, ['export']);

      expect(exportSettingsMock).toBeCalledWith(userSettings.email, userSettings.statusMappings);
    });
  });

  describe('With list argument', () => {
    test('With exported settings Returns list of exported settings', async () => {
      const statusMappings = [
        {
          exportedSettings: [
            {settingsId: '123'},
            {settingsId: '456'},
          ]
        }
      ];
      getSettingsForUsersMock.mockResolvedValueOnce(statusMappings);
      
      const message = await handleMappings(userSettings, ['list']);

      expect(message).toBe(
        'Status mapping IDs for user: 123\n456'
      );
    });

    test('With no exported settings Returns no exported settings message', async () => {
      const statusMappings: UserSettings[] = [];
      getSettingsForUsersMock.mockResolvedValueOnce(statusMappings);

      const message = await handleMappings(userSettings, ['list']);

      expect(message).toBe(
        'No exported status mappings found for user'
      );
    });
  });

  describe('With import argument', () => {
    beforeEach(() => {
      upsertStatusMappingsMock.mockResolvedValueOnce(userSettings);
    });
    
    test('With imported settings Id matching a valid settingsId, imports settings', async () => {
      const exportedSettings: ExportedSettings = {settingsId: '123', statusMappings: []};
      getExportedSettingsBySettingsIdMock.mockResolvedValueOnce(exportedSettings);

      const message = await handleMappings(userSettings, ['import=123']);

      expect(message).toBe(`Your status mappings have been updated`);
    });

    test('With invalid settingsId, reports error', async () => {
      const exportedSettings: ExportedSettings = {} as ExportedSettings;
      getExportedSettingsBySettingsIdMock.mockResolvedValueOnce(exportedSettings);

      const message = await handleMappings(userSettings, ['import=123']);

      expect(message).toBe(`No status mappings found for 123`);
    });  
  });
});
