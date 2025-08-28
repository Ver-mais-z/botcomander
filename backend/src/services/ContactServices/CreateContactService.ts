import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";

type ExtraInfoInput = {
  id?: number;         // opcional (útil para updates no futuro)
  name: string;
  value: string;
};

interface Request {
  name: string;
  number: string;
  email?: string;
  profilePicUrl?: string;
  extraInfo?: ExtraInfoInput[];
}

const CreateContactService = async ({
  name,
  number,
  email = "",
  profilePicUrl,
  extraInfo = []
}: Request): Promise<Contact> => {
  const numberExists = await Contact.findOne({ where: { number } });

  if (numberExists) {
    throw new AppError("ERR_DUPLICATED_CONTACT");
  }

  const contact = await Contact.create(
    {
      name,
      number,
      email,
      profilePicUrl,
      // permite criação em cascata da associação "extraInfo"
      extraInfo
    },
    {
      // se preferir, pode usar o include com o model e alias:
      // include: [{ model: ContactCustomField, as: "extraInfo" }]
      include: ["extraInfo"]
    }
  );

  return contact;
};

export default CreateContactService;
