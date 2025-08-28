import CampaignSetting from "../../models/CampaignSetting";

const ListService = async (): Promise<CampaignSetting[]> => {
  const records = await CampaignSetting.findAll();
  return records;
};

export default ListService;
