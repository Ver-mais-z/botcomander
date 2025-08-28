import { Op } from "sequelize";
import Campaign from "../../models/Campaign";
import CampaignShipping from "../../models/CampaignShipping";
import { campaignQueue } from "../../queues";
import AppError from "../../errors/AppError";

export async function CancelService(id: number) {
  const campaign = await Campaign.findByPk(id);
  if (!campaign) {
    throw new AppError("Campaign not found", 404);
  }

  await campaign.update({ status: "CANCELADA" });

  const recordsToCancel = await CampaignShipping.findAll({
    where: {
      campaignId: campaign.id,
      // TS não aceita null em WhereOperators (bug/limitação de tipos do Sequelize).
      // Cast local para contornar e gerar "jobId IS NOT NULL".
      jobId: { [Op.ne]: null } as any,
      deliveredAt: null
    }
  });

  const promises: Array<Promise<unknown>> = [];

  for (const record of recordsToCancel) {
    if (record.jobId != null) {
      const job = await campaignQueue.getJob(Number(record.jobId));
      if (job) {
        promises.push(job.remove());
      }
    }
  }

  await Promise.all(promises);
}
