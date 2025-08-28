import Campaign from "../../models/Campaign";

const FindService = async (): Promise<Campaign[]> => {
  const campaigns: Campaign[] = await Campaign.findAll({
    order: [["name", "ASC"]],
  });

  return campaigns;
};

export default FindService;
