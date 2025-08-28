
// UpdateCustomColumnService.ts
import CustomColumn from "../../models/CustomColumn";
import AppError from "../../errors/AppError";
import { Op } from "sequelize";

interface Request {
  customColumnId: string;
  name: string;
  message: string;
}

const UpdateCustomColumnService = async ({
  customColumnId,
  name,
  message
}: Request): Promise<CustomColumn> => {
  const customColumn = await CustomColumn.findByPk(customColumnId);

  if (!customColumn) {
    throw new AppError("Coluna personalizada não encontrada", 404);
  }

  // Verificar se já existe uma coluna com o mesmo nome (exceto a atual)
  const existingColumn = await CustomColumn.findOne({
    where: {
      name,
      id: {
        [Op.ne]: customColumnId
      }
    }
  });

  if (existingColumn) {
    throw new AppError("Já existe uma coluna com este nome", 400);
  }

  await customColumn.update({
    name,
    message
  });

  await customColumn.reload();

  return customColumn;
};

export default UpdateCustomColumnService;