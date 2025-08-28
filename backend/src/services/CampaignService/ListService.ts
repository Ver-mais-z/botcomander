import { Op, fn, col, where } from "sequelize";
import Campaign from "../../models/Campaign";
import { isEmpty } from "lodash";
import ContactList from "../../models/ContactList";
import Whatsapp from "../../models/Whatsapp";

interface Request {
  searchParam?: string;
  pageNumber?: string;
}

interface Response {
  records: Campaign[];
  count: number;
  hasMore: boolean;
}

const ListService = async ({
  searchParam = "",
  pageNumber = "1",
}: Request): Promise<Response> => {
  let whereCondition: any = {};

  if (!isEmpty(searchParam)) {
    whereCondition = {
      ...whereCondition,
      [Op.or]: [
        {
          name: where(
            fn("LOWER", col("Campaign.name")),
            "LIKE",
            `%${searchParam.toLowerCase().trim()}%`
          ),
        },
      ],
    };
  }

  const limit = 20;
  const page = Number(pageNumber) || 1;
  const offset = limit * (page - 1);

  const { count, rows: records } = await Campaign.findAndCountAll({
    where: whereCondition,
    limit,
    offset,
    order: [["name", "ASC"]],
    include: [
      { model: ContactList },
      { model: Whatsapp, attributes: ["id", "name"] },
    ],
    distinct: true,
  });

  const hasMore = count > offset + records.length;

  return {
    records,
    count,
    hasMore,
  };
};

export default ListService;
