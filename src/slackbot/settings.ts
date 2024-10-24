import {
  UserSettings,
  setZoomLinksDisabled,
  setMeetingReminderTimingOverride,
  setSnoozed
} from '../services/dynamo';

type SettingsCommandArguments = {
  zoomLinksEnabled?: boolean;
  meetingReminderTimingOverride?: number;
  snoozed?: boolean;
};

enum SettingsCommandArgumentKeys {
  Show = 'show',
  ZoomLinks = 'zoom-links',
  ReminderTiming = 'reminder-timing',
  Snoozed = 'snoozed',
}

const constructSettingsCommandArgs = (argList: string[]): SettingsCommandArguments => {
  const args: { [key: string]: string } = {
    [SettingsCommandArgumentKeys.ZoomLinks]: '',
    [SettingsCommandArgumentKeys.ReminderTiming]: '',
    [SettingsCommandArgumentKeys.Snoozed]: '',
  };

  for (let arg of argList) {
    const [key, value] = arg.split(/\s?=\s?/g);
    if (key in args) {
      args[key] = value.replace(/["”“]/g, '');
    }
  }

  const zoomLinksArg = args[SettingsCommandArgumentKeys.ZoomLinks];
  const reminderTimingArg = args[SettingsCommandArgumentKeys.ReminderTiming];
  const snoozedArg = args[SettingsCommandArgumentKeys.Snoozed];

  return {
    zoomLinksEnabled: zoomLinksArg.length ? zoomLinksArg.toLowerCase() === 'true' : undefined,
    meetingReminderTimingOverride: reminderTimingArg.length ? Number(reminderTimingArg) : undefined,
    snoozed: snoozedArg.length ? snoozedArg.toLowerCase() === 'true' : undefined,
  };
};

const stringifySettings = ({ zoomLinksDisabled, meetingReminderTimingOverride, snoozed }: UserSettings) => {
  const zoomLinksString = `• \`${SettingsCommandArgumentKeys.ZoomLinks}\`: \`${!zoomLinksDisabled}\``;
  const reminderTimingString = `• \`${SettingsCommandArgumentKeys.ReminderTiming}\`: \`${
    meetingReminderTimingOverride || 1
    }\``;
  const snoozedString = `• \`${SettingsCommandArgumentKeys.Snoozed}\`: \`${!!snoozed}\``;
  return `${zoomLinksString}\n${reminderTimingString}\n${snoozedString}`;
};

export const handleSettings = async (userSettings: UserSettings, argList: string[]): Promise<string> => {
  if (!argList.length) {
    return 'You must provide at least one argument. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki';
  }

  if (argList[0].toLowerCase() === SettingsCommandArgumentKeys.Show) {
    return `Here are your current settings:\n${stringifySettings(userSettings)}`;
  }

  const args = constructSettingsCommandArgs(argList);

  let newSettings;
  if (args.zoomLinksEnabled !== undefined) {
    newSettings = await setZoomLinksDisabled(userSettings.email, !args.zoomLinksEnabled);
  }
  if (args.meetingReminderTimingOverride !== undefined) {
    newSettings = await setMeetingReminderTimingOverride(userSettings.email, args.meetingReminderTimingOverride);
  }
  if (args.snoozed !== undefined) {
    newSettings = await setSnoozed(userSettings.email, args.snoozed);
  }

  return newSettings
    ? `Your settings have been updated:\n${stringifySettings(newSettings)}`
    : 'No supported arguments given. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki';
};
