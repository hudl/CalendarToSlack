import {
  UserSettings,
  upsertStatusMappings,
  exportSettings,
  getExportedSettingsBySettingsId,
  getSettingsForUsers
} from '../services/dynamo';
import {serializeStatusMappings} from "../slackbot";

type StatusMappingsCommandArguments = {
  zoomLinksEnabled?: boolean;
  meetingReminderTimingOverride?: number;
  snoozed?: boolean;
  settingsId?: string;
};

enum StatusMappingsCommandArgumentsKeys {
  Export = 'export',
  Import = 'import',
  List = 'list',
}

const constructMappingsCommandArgs = (argList: string[]): StatusMappingsCommandArguments => {
  const args: { [key: string]: string } = {
    [StatusMappingsCommandArgumentsKeys.Import]: '',
  };

  for (let arg of argList) {
    const [key, value] = arg.split(/\s?=\s?/g);
    if (key in args) {
      args[key] = value.replace(/["”“]/g, '');
    }
  }

  const settingsIdArg = args[StatusMappingsCommandArgumentsKeys.Import];

  return {
    settingsId: settingsIdArg.length ? settingsIdArg : undefined,
  };
};

export const handleMappings = async (userSettings: UserSettings, argList: string[]): Promise<string> => {
  if (!argList.length) {
    return 'You must provide at least one argument. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki';
  }

  if (argList[0].toLowerCase() === StatusMappingsCommandArgumentsKeys.Export) {
    if (!userSettings.statusMappings) {
      return `You have no status mappings to export.`;
    }
    const exportedSettingsId = await exportSettings(userSettings.email, userSettings.statusMappings);
    return `Your status mappings have been exported with the ID: ${exportedSettingsId}`;
  }
  if (argList[0].toLowerCase() === StatusMappingsCommandArgumentsKeys.List) {
    const settings = await getSettingsForUsers([userSettings.email]);
    const exportedSettings = settings.flatMap((s) => s.exportedSettings || []);
    const exportedSettingsIds = exportedSettings.map((es) => es.settingsId);
    return exportedSettingsIds.length > 0
      ? 'Status mapping IDs for user: ' + exportedSettingsIds.join('\n')
      : 'No exported status mappings found for user';
  }

  const args = constructMappingsCommandArgs(argList);
  
  if (args.settingsId) {
    const exportedSettings = await getExportedSettingsBySettingsId(args.settingsId);
    if (!exportedSettings.statusMappings) {
      return `No status mappings found for ${args.settingsId}`;
    }

    const updatedSettings = await upsertStatusMappings(userSettings.email, exportedSettings.statusMappings);
    return `Your status mappings have been updated:\n${serializeStatusMappings(updatedSettings)}`;
  }

  return 'No supported arguments given. See the wiki for more information: https://github.com/hudl/CalendarToSlack/wiki';
};
