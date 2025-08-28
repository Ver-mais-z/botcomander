// DeleteCustomColumnService.ts
import CustomColumn from "../../models/CustomColumn";
import AppError from "../../errors/AppError";

const DeleteCustomColumnService = async (
  customColumnId: string
): Promise<void> => {
  const customColumn = await CustomColumn.findByPk(customColumnId);

  if (!customColumn) {
    throw new AppError("Coluna personalizada não encontrada", 404);
  }

  await customColumn.destroy();
};

export default DeleteCustomColumnService;