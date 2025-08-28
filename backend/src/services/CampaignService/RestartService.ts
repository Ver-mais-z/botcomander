import Campaign from "../../models/Campaign";
import { campaignQueue } from "../../queues";
import AppError from "../../errors/AppError";

export async function RestartService(id: number) {
  const campaign = await Campaign.findByPk(id);
  if (!campaign) {
    throw new AppError("Campaign not found", 404);
  }

  await campaign.update({ status: "EM_ANDAMENTO" });

  await campaignQueue.add("ProcessCampaign", {
    id: campaign.id,
    delay: 3000
  });
}
