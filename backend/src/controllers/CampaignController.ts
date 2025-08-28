import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import { head } from "lodash";
import fs from "fs";
import path from "path";

import ListService from "../services/CampaignService/ListService";
import CreateService from "../services/CampaignService/CreateService";
import ShowService from "../services/CampaignService/ShowService";
import UpdateService from "../services/CampaignService/UpdateService";
import DeleteService from "../services/CampaignService/DeleteService";
import FindService from "../services/CampaignService/FindService";

import Campaign from "../models/Campaign";

import AppError from "../errors/AppError";
import { CancelService } from "../services/CampaignService/CancelService";
import { RestartService } from "../services/CampaignService/RestartService";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

type StoreData = {
  name: string;
  status: string;
  confirmation: boolean;
  scheduledAt: string;
  contactListId: number;
};

type FindParams = Record<string, any>;

// Helper: garante Campaign existente ou lança 404
async function getCampaignOrThrow(id: string | number) {
  const campaign = await Campaign.findByPk(id);
  if (!campaign) {
    throw new AppError("Campaign not found", 404);
  }
  return campaign;
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;

  const { records, count, hasMore } = await ListService({
    searchParam,
    pageNumber
  });

  return res.json({ records, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const data = req.body as StoreData;

  const schema = Yup.object().shape({
    name: Yup.string().required()
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const record = await CreateService({
    ...data
  });

  const io = getIO();
  io.emit("campaign", {
    action: "create",
    record
  });

  return res.status(200).json(record);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const record = await ShowService(id);
  if (!record) {
    throw new AppError("Campaign not found", 404);
  }

  return res.status(200).json(record);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const data = req.body as StoreData;

  const schema = Yup.object().shape({
    name: Yup.string().required()
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const { id } = req.params;

  const record = await UpdateService({
    ...data,
    id
  });

  if (!record) {
    throw new AppError("Campaign not found", 404);
  }

  const io = getIO();
  io.emit("campaign", {
    action: "update",
    record
  });

  return res.status(200).json(record);
};

export const cancel = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  await CancelService(+id);

  // 200 com body (evita 204 + body)
  return res.status(200).json({ message: "Cancelamento realizado" });
};

export const restart = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  await RestartService(+id);

  // 200 com body (evita 204 + body)
  return res.status(200).json({ message: "Reinício dos disparos" });
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  await DeleteService(id);

  const io = getIO();
  io.emit("campaign", {
    action: "delete",
    id
  });

  return res.status(200).json({ message: "Campaign deleted" });
};

export const findList = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const _params = req.query as FindParams;
  const records: Campaign[] = await FindService();

  return res.status(200).json(records);
};

export const mediaUpload = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const files = (req.files as Express.Multer.File[]) || [];
  const file = head(files);

  if (!file) {
    throw new AppError("Nenhum arquivo enviado", 400);
  }

  try {
    const campaign = await getCampaignOrThrow(id);

    // Se o seu model tipa como string (não aceita null),
    // estas atribuições não quebram, pois são string:
    campaign.mediaPath = file.filename as any; // OK mesmo se o tipo for string | null
    campaign.mediaName = file.originalname as any;

    await campaign.save();
    return res.status(200).send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {
    throw new AppError(err.message);
  }
};

export const deleteMedia = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  try {
    const campaign = await getCampaignOrThrow(id);

    if (campaign.mediaPath) {
      const filePath = path.resolve("public", campaign.mediaPath);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Se falhar a exclusão do arquivo, seguimos limpando os campos
        }
      }
    }

    // Se o model ainda está tipado como `string` apenas,
    // usamos `as any` para permitir null até você ajustar para `string | null`.
    (campaign as any).mediaPath = null;
    (campaign as any).mediaName = null;

    await campaign.save();
    return res.status(200).send({ mensagem: "Arquivo excluído" });
  } catch (err: any) {
    throw new AppError(err.message);
  }
};
