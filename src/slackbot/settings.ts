import { UserSettings, setZoomLinksDisabled, setMeetingReminderTimingOverride, setSnoozed } from '../services/dynamo';
import {exportSettings} from "../services/dynamo/exportedSettings";

type SettingsCommandArguments = {
  zoomLinksEnabled?: boolean;
  meetingReminderTimingOverride?: number;
  snoozed?: boolean;
  settingsId?: string;
};

enum SettingsCommandArgumentKeys {
  Show = 'show',
  ZoomLinks = 'zoom-links',
  ReminderTiming = 'reminder-timing',
  Snoozed = 'snoozed',
  Export = 'export',
  Import = 'import',
}

const constructSettingsCommandArgs = (argList: string[]): SettingsCommandArguments => {
  const args: { [key: string]: string } = {
    [SettingsCommandArgumentKeys.ZoomLinks]: '',
    [SettingsCommandArgumentKeys.ReminderTiming]: '',
    [SettingsCommandArgumentKeys.Snoozed]: '',
    [SettingsCommandArgumentKeys.Import]: '',
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
  const settingsIdArg = args[SettingsCommandArgumentKeys.Import];

  return {
    zoomLinksEnabled: zoomLinksArg.length ? zoomLinksArg.toLowerCase() === 'true' : undefined,
    meetingReminderTimingOverride: reminderTimingArg.length ? Number(reminderTimingArg) : undefined,
    snoozed: snoozedArg.length ? snoozedArg.toLowerCase() === 'true' : undefined,
    settingsId: settingsIdArg.length ? settingsIdArg : undefined,
  };
};

const stringifySettings = ({ zoomLinksDisabled, meetingReminderTimingOverride, snoozed }: UserSettings) => {
  const zoomLinksString = `• \`${SettingsCommandArgumentKeys.ZoomLinks}\`: \`${!zoomLinksDisabled}\``;
  const reminderTimingString = `• \`${SettingsCommandArgumentKeys.ReminderTiming}\`: \`${
    meetingReminderTimingOverride || 1
    }\``;
  const snoozedString = `• \`${SettingsCommandArgumentKeys.Snoozed}\`: \`${!!snoozed}\``;
  //TODO list export settings ids
  
  return `${zoomLinksString}\n${reminderTimingString}\n${snoozedString}`;
};

export const handleSettings = async (userSettings: UserSettings, argList: string[]): Promise<string> => {
  if (!argList.length) {
    return 'You must provide at least one argument. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki';
  }

  if (argList[0].toLowerCase() === SettingsCommandArgumentKeys.Show) {
    return `Here are your current settings:\n${stringifySettings(userSettings)}`;
  }
  if (argList[0].toLowerCase() === SettingsCommandArgumentKeys.Export) {
    if (!userSettings.statusMappings) {
      return `You have no status mappings to export.`;
    }
    const exportedSettings = await exportSettings(userSettings.email, userSettings.statusMappings);
    return `Your settings have been exported with the ID: ${exportedSettings.settings_id}`;
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
  if (args.settingsId) {
    //TODO import
  }

  return newSettings
    ? `Your settings have been updated:\n${stringifySettings(newSettings)}`
    : 'No supported arguments given. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki';
};
