// ListCustomColumnsService.ts
import { Sequelize, Op } from "sequelize";
import CustomColumn from "../../models/CustomColumn";

interface Request {
  searchParam?: string;
  pageNumber?: string;
}

interface Response {
  customColumns: CustomColumn[];
  count: number;
  hasMore: boolean;
}

const ListCustomColumnsService = async ({
  searchParam = "",
  pageNumber = "1"
}: Request): Promise<Response> => {
  const whereCondition = {
    [Op.or]: [
      {
        name: Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("name")),
          "LIKE",
          `%${searchParam.toLowerCase()}%`
        )
      },
      {
        message: Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("message")),
          "LIKE",
          `%${searchParam.toLowerCase()}%`
        )
      }
    ]
  };

  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: customColumns } = await CustomColumn.findAndCountAll({
    where: whereCondition,
    limit,
    offset,
    order: [["createdAt", "DESC"]]
  });

  const hasMore = count > offset + customColumns.length;

  return {
    customColumns,
    count,
    hasMore
  };
};

export default ListCustomColumnsService;