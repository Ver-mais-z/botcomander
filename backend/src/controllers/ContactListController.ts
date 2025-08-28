import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";

import ListService from "../services/ContactListService/ListService";
import CreateService from "../services/ContactListService/CreateService";
import ShowService from "../services/ContactListService/ShowService";
import UpdateService from "../services/ContactListService/UpdateService";
import DeleteService from "../services/ContactListService/DeleteService";
import FindService from "../services/ContactListService/FindService";
import { head } from "lodash";

import ContactList from "../models/ContactList";

import AppError from "../errors/AppError";
import { ImportContacts } from "../services/ContactListService/ImportContacts";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

type StoreData = {
  name: string;
};

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

  const record = await CreateService(data);

  const io = getIO();
  io.emit("contactlist", {
    action: "create",
    record
  });

  return res.status(200).json(record);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const record = await ShowService(id);

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

  const io = getIO();
  io.emit("contactlist", {
    action: "update",
    record
  });

  return res.status(200).json(record);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  await DeleteService(id);

  const io = getIO();
  io.emit("contactlist", {
    action: "delete",
    id
  });

  return res.status(200).json({ message: "Contact list deleted" });
};

export const findList = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const records: ContactList[] = await FindService();

  return res.status(200).json(records);
};

export const upload = async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const file: Express.Multer.File = head(files) as Express.Multer.File;
  const { id } = req.params;

  const response = await ImportContacts(+id, file);

  const io = getIO();
  io.emit(`contactlistitem-${+id}`, {
    action: "reload",
    records: response
  });

  return res.status(200).json(response);
};
