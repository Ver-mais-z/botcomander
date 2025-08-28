import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { getWbot } from "../../libs/wbot";

const CheckContactNumber = async (number: string) => {
  const defaultWhatsapp = await GetDefaultWhatsApp();
  const wbot = getWbot(defaultWhatsapp.id);

  // Baileys usa domínio @s.whatsapp.net (NÃO @c.us)
  const result = await wbot.getNumberId(`${number}@c.us`);

  // Baileys retorna { exists: boolean, jid: string } ou null
  if (!result) return { exists: false, jid: null };
  if (typeof result === "string") return { exists: true, jid: result };

  // cobre estruturas diferentes
  return {
    exists: Boolean((result as any).exists ?? true),
    jid: (result as any).jid ?? (result as any)._serialized ?? String(result)
  };
};

export default CheckContactNumber;
