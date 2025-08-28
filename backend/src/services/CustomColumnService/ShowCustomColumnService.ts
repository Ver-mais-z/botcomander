// ShowCustomColumnService.ts
import CustomColumn from "../../models/CustomColumn";
import AppError from "../../errors/AppError";

const ShowCustomColumnService = async (
  customColumnId: string
): Promise<CustomColumn> => {
  const customColumn = await CustomColumn.findByPk(customColumnId);

  if (!customColumn) {
    throw new AppError("Coluna personalizada não encontrada", 404);
  }

  return customColumn;
};

export default ShowCustomColumnService;