import CampaignSetting from "../../models/CampaignSetting";
import { isArray, isObject } from "lodash";

interface Data {
  settings: any;
}

const CreateService = async (data: Data): Promise<CampaignSetting[]> => {
  const settings: CampaignSetting[] = [];

  for (const settingKey of Object.keys(data.settings)) {
    const raw = data.settings[settingKey];
    const value =
      isArray(raw) || isObject(raw) ? JSON.stringify(raw) : raw;

    const [record, created] = await CampaignSetting.findOrCreate({
      where: { key: settingKey },                  // <- sem companyId
      defaults: { key: settingKey, value },        // <- sem companyId
    });

    if (!created) {
      await record.update({ value });
    }

    settings.push(record);
  }

  return settings;
};

export default CreateService;
