import { Sequelize, Op } from "sequelize";
import ContactListItem from "../../models/ContactListItem";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  contactListId: number | string;
}

interface Response {
  contacts: ContactListItem[];
  count: number;
  hasMore: boolean;
}

const ListService = async ({
  searchParam = "",
  pageNumber = "1",
  contactListId
}: Request): Promise<Response> => {
  const term = searchParam.toLowerCase().trim();

  const whereCondition: any = {
    contactListId,
    ...(term && {
      [Op.or]: [
        {
          name: Sequelize.where(
            Sequelize.fn("LOWER", Sequelize.col("name")),
            "LIKE",
            `%${term}%`
          )
        },
        { number: { [Op.like]: `%${term}%` } }
      ]
    })
  };

  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: contacts } = await ContactListItem.findAndCountAll({
    where: whereCondition,
    limit,
    offset,
    order: [["name", "ASC"]]
  });

  const hasMore = count > offset + contacts.length;

  return {
    contacts,
    count,
    hasMore
  };
};

export default ListService;
