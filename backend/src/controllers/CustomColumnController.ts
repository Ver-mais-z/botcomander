import { Request, Response } from "express";
import * as Yup from "yup";

import CustomColumn from "../models/CustomColumn";
import AppError from "../errors/AppError";

import CreateCustomColumnService from "../services/CustomColumnService/CreateCustomColumnService";
import ListCustomColumnsService from "../services/CustomColumnService/ListCustomColumnsService";
import ShowCustomColumnService from "../services/CustomColumnService/ShowCustomColumnService";
import UpdateCustomColumnService from "../services/CustomColumnService/UpdateCustomColumnService";
import DeleteCustomColumnService from "../services/CustomColumnService/DeleteCustomColumnService";

interface IndexQuery {
  searchParam?: string;
  pageNumber?: string;
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;

  const { customColumns, count, hasMore } = await ListCustomColumnsService({
    searchParam,
    pageNumber
  });

  return res.json({ customColumns, count, hasMore });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { customColumnId } = req.params;

  const customColumn = await ShowCustomColumnService(customColumnId);

  return res.status(200).json(customColumn);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const schema = Yup.object().shape({
    name: Yup.string()
      .min(2, "Nome muito curto")
      .max(50, "Nome muito longo")
      .required("Nome da coluna é obrigatório"),
    message: Yup.string()
      .min(5, "Mensagem muito curta")
      .max(1000, "Mensagem muito longa")
      .required("Mensagem é obrigatória"),
  });

  try {
    await schema.validate(req.body);
  } catch (err) {
    throw new AppError(err.message);
  }

  const { name, message } = req.body;

  const customColumn = await CreateCustomColumnService({
    name,
    message
  });

  return res.status(201).json(customColumn);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { customColumnId } = req.params;

  const schema = Yup.object().shape({
    name: Yup.string()
      .min(2, "Nome muito curto")
      .max(50, "Nome muito longo")
      .required("Nome da coluna é obrigatório"),
    message: Yup.string()
      .min(5, "Mensagem muito curta")
      .max(1000, "Mensagem muito longa")
      .required("Mensagem é obrigatória"),
  });

  try {
    await schema.validate(req.body);
  } catch (err) {
    throw new AppError(err.message);
  }

  const { name, message } = req.body;

  const customColumn = await UpdateCustomColumnService({
    customColumnId,
    name,
    message
  });

  return res.status(200).json(customColumn);
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { customColumnId } = req.params;

  await DeleteCustomColumnService(customColumnId);

  return res.status(200).json({ message: "Coluna personalizada deletada" });
};