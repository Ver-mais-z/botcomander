import * as Yup from "yup";
import AppError from "../../errors/AppError";
import ContactListItem from "../../models/ContactListItem";
import { logger } from "../../utils/logger";
import CheckContactNumber from "../WbotServices/CheckNumber";

interface Data {
  name: string;
  number: string;
  contactListId: number;
  email?: string;
}

const CreateService = async (data: Data): Promise<ContactListItem> => {
  const { name } = data;

  const contactListItemSchema = Yup.object().shape({
    name: Yup.string()
      .min(3, "ERR_CONTACTLISTITEM_INVALID_NAME")
      .required("ERR_CONTACTLISTITEM_REQUIRED")
  });

  try {
    await contactListItemSchema.validate({ name });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const [record] = await ContactListItem.findOrCreate({
    where: {
      number: data.number,
      contactListId: data.contactListId
    },
    defaults: data
  });

  try {
    // Opção B: CheckContactNumber retorna string | null
    const userOrNull = await CheckContactNumber(record.number); // string | null
    const exists = !!userOrNull;

    record.isWhatsappValid = exists;

    if (exists) {
      // monta um JID simples e normaliza apenas dígitos para salvar
      const jid = `${userOrNull}@c.us`;
      const number = jid.replace(/\D/g, "");
      record.number = number;
    }

    await record.save();
  } catch (e: any) {
    logger.error(`Número de contato inválido: ${record.number} - ${e?.message || e}`);
  }

  return record;
};

export default CreateService;
