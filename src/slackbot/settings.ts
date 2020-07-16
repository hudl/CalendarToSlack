import { UserSettings, setZoomLinksDisabled, setMeetingReminderTimingOverride } from '../services/dynamo';

type SettingsCommandArguments = {
  zoomLinksEnabled?: boolean;
  meetingReminderOverride?: number;
};

enum SettingsArguments {
  ZoomLinks = 'zoom-links',
  ReminderTiming = 'reminder-timing',
}

const constructSettingsCommandArgs = (argList: string[]): SettingsCommandArguments => {
  const args: { [key: string]: string } = {
    [SettingsArguments.ZoomLinks]: '',
    [SettingsArguments.ReminderTiming]: '',
  };

  for (let arg of argList) {
    const [key, value] = arg.split(/\s?=\s?/g);
    if (key in args) {
      args[key] = value.replace(/["”“]/g, '');
    }
  }

  const zoomLinksArg = args[SettingsArguments.ZoomLinks];
  const reminderTimingArg = args[SettingsArguments.ReminderTiming];

  return {
    zoomLinksEnabled: zoomLinksArg.length ? zoomLinksArg.toLowerCase() === 'true' : undefined,
    meetingReminderOverride: reminderTimingArg.length ? Number(reminderTimingArg) : undefined,
  };
};

export const handleUpdateSettings = async (userSettings: UserSettings, argList: string[]): Promise<string> => {
  if (!argList.length) {
    return 'You must provide at least one argument. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki';
  }

  const args = constructSettingsCommandArgs(argList);

  let settingsUpdated = false;
  if (args.zoomLinksEnabled !== undefined) {
    await setZoomLinksDisabled(userSettings.email, !args.zoomLinksEnabled);
    settingsUpdated = true;
  }
  if (args.meetingReminderOverride !== undefined) {
    await setMeetingReminderTimingOverride(userSettings.email, args.meetingReminderOverride);
    settingsUpdated = true;
  }

  // TODO: Once more settings are present, change this to echo their settings
  return settingsUpdated
    ? 'Your settings have been updated.'
    : 'No supported arguments given. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki';
};
