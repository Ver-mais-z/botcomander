import { Request, Response } from "express";
import { getIO } from "../libs/socket";

import ListService from "../services/CampaignSettingServices/ListService";
import CreateService from "../services/CampaignSettingServices/CreateService";

interface StoreData {
  settings: any;
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  // Sem companyId: liste tudo ou deixe o service aplicar o filtro padrão interno
  const records = await ListService(); // ou ListService({})
  return res.json(records);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const data = req.body as StoreData;

  // Sem companyId: ajuste o service para não exigir o segundo argumento
  const record = await CreateService(data);

  const io = getIO();
  // Canal genérico, sem o prefixo company-<id>-
  io.emit("campaignSettings", {
    action: "create",
    record,
  });

  return res.status(200).json(record);
};
