import { serializeStatusMappings } from '../../slackbot';
import { UserSettings, StatusMapping } from '../../services/dynamo';

describe('serializeStatusMappings', () => {
  const baseUserSettings: UserSettings = {
    email: 'test@example.com',
    statusMappings: [],
  };

  describe('DND display functionality', () => {
    test('shows "and toggles DND" when dnd is true', () => {
      const userSettings: UserSettings = {
        ...baseUserSettings,
        statusMappings: [
          {
            calendarText: 'Squad Meeting',
            slackStatus: {
              text: 'In squad meeting',
              emoji: ':calendar:',
              dnd: true,
            },
          },
        ],
      };

      const result = serializeStatusMappings(userSettings);

      expect(result).toContain('and toggles DND');
      expect(result).toContain(':calendar: `Squad Meeting` uses status `In squad meeting` and toggles DND');
    });

    test('does not show DND text when dnd is false', () => {
      const userSettings: UserSettings = {
        ...baseUserSettings,
        statusMappings: [
          {
            calendarText: 'Regular Meeting',
            slackStatus: {
              text: 'In a meeting',
              emoji: ':calendar:',
              dnd: false,
            },
          },
        ],
      };

      const result = serializeStatusMappings(userSettings);

      expect(result).not.toContain('and toggles DND');
      expect(result).toContain(':calendar: `Regular Meeting` uses status `In a meeting`');
    });

    test('does not show DND text when dnd is undefined', () => {
      const userSettings: UserSettings = {
        ...baseUserSettings,
        statusMappings: [
          {
            calendarText: 'Regular Meeting',
            slackStatus: {
              text: 'In a meeting',
              emoji: ':calendar:',
            },
          },
        ],
      };

      const result = serializeStatusMappings(userSettings);

      expect(result).not.toContain('and toggles DND');
      expect(result).toContain(':calendar: `Regular Meeting` uses status `In a meeting`');
    });

    test('handles multiple mappings with mixed DND settings', () => {
      const userSettings: UserSettings = {
        ...baseUserSettings,
        statusMappings: [
          {
            calendarText: 'Squad Meeting',
            slackStatus: {
              text: 'In squad meeting',
              emoji: ':calendar:',
              dnd: true,
            },
          },
          {
            calendarText: 'Regular Meeting',
            slackStatus: {
              text: 'In a meeting',
              emoji: ':office:',
              dnd: false,
            },
          },
          {
            calendarText: 'Daily Standup',
            slackStatus: {
              text: 'Daily standup',
              emoji: ':speech_balloon:',
            },
          },
        ],
      };

      const result = serializeStatusMappings(userSettings);

      expect(result).toContain(':calendar: `Squad Meeting` uses status `In squad meeting` and toggles DND');
      expect(result).toContain(':office: `Regular Meeting` uses status `In a meeting`');
      expect(result).toContain(':speech_balloon: `Daily Standup` uses status `Daily standup`');

      // Count occurrences of "and toggles DND" - should only appear once
      const dndMatches = result.match(/and toggles DND/g);
      expect(dndMatches).toHaveLength(1);
    });

    test('handles mapping without status text but with DND', () => {
      const userSettings: UserSettings = {
        ...baseUserSettings,
        statusMappings: [
          {
            calendarText: 'Focus Time',
            slackStatus: {
              emoji: ':no_entry:',
              dnd: true,
            },
          },
        ],
      };

      const result = serializeStatusMappings(userSettings);

      expect(result).toContain(':no_entry: `Focus Time` and toggles DND');
      expect(result).not.toContain('uses status');
    });
  });

  describe('existing functionality', () => {
    test('displays default status when no status mappings exist', () => {
      const userSettings: UserSettings = {
        ...baseUserSettings,
        defaultStatus: {
          text: 'Available',
          emoji: ':white_check_mark:',
        },
      };

      const result = serializeStatusMappings(userSettings);

      expect(result).toContain('*Your default status is*: :white_check_mark: `Available`');
    });

    test('handles no default status and no mappings', () => {
      const result = serializeStatusMappings(baseUserSettings);

      expect(result).toContain('*Your default status is*: _Not set_');
    });
  });
});
