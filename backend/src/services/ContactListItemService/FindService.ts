import ContactListItem from "../../models/ContactListItem";

type Params = {
  contactListId?: number;
};

const FindService = async ({ contactListId }: Params): Promise<ContactListItem[]> => {
  const where: any = {};

  if (contactListId) {
    where.contactListId = contactListId;
  }

  const notes: ContactListItem[] = await ContactListItem.findAll({
    where,
    order: [["name", "ASC"]]
  });

  return notes;
};

export default FindService;
