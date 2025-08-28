// CreateCustomColumnService.ts
import CustomColumn from "../../models/CustomColumn";
import AppError from "../../errors/AppError";

interface Request {
  name: string;
  message: string;
}

const CreateCustomColumnService = async ({
  name,
  message
}: Request): Promise<CustomColumn> => {
  // Verificar se já existe uma coluna com o mesmo nome
  const existingColumn = await CustomColumn.findOne({
    where: {
      name
    }
  });

  if (existingColumn) {
    throw new AppError("Já existe uma coluna com este nome", 400);
  }

  const customColumn = await CustomColumn.create({
    name,
    message
  });

  return customColumn;
};

export default CreateCustomColumnService;