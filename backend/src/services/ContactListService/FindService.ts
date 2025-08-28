import ContactList from "../../models/ContactList";

const FindService = async (): Promise<ContactList[]> => {
  const notes: ContactList[] = await ContactList.findAll({
    order: [["name", "ASC"]]
  });

  return notes;
};

export default FindService;
