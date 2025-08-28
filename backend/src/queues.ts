import * as Sentry from "@sentry/node";
import Queue from "bull";
import { MessageData, SendMessage } from "./helpers/SendMessage";
import Whatsapp from "./models/Whatsapp";
import { logger } from "./utils/logger";
import moment from "moment";
import Schedule from "./models/Schedule";
import Contact from "./models/Contact";
import { Op, QueryTypes } from "sequelize";
import GetDefaultWhatsApp from "./helpers/GetDefaultWhatsApp";
import Campaign from "./models/Campaign";
import CustomColumn from "./models/CustomColumn";
import ContactList from "./models/ContactList";
import ContactListItem from "./models/ContactListItem";
import { isEmpty, isNil, isArray } from "lodash";
import CampaignShipping from "./models/CampaignShipping";
import GetWhatsappWbot from "./helpers/GetWhatsappWbot";
import sequelize from "./database";
import { getMessageOptions } from "./services/WbotServices/SendWhatsAppMedia";
import { getIO } from "./libs/socket";
import path from "path";
import User from "./models/User";

// ===== AJUSTES DE CONEXÃO / LIMITER =====
const REDIS_URI = process.env.REDIS_URI || "redis://127.0.0.1:6379";
const limiterMax = Number(process.env.REDIS_OPT_LIMITER_MAX ?? 1);
const limiterDuration = Number(process.env.REDIS_OPT_LIMITER_DURATION ?? 3000);

logger.info(
`[Queues] REDIS_URI=${REDIS_URI} limiterMax=${limiterMax} limiterDuration=${limiterDuration}`
);

const queueOpts = {
redis: REDIS_URI,
limiter: {
  max: limiterMax,
  duration: limiterDuration
}
};

// ===== FILAS =====
export const userMonitor = new Queue("UserMonitor", REDIS_URI);
export const messageQueue = new Queue("MessageQueue", queueOpts as any);
export const scheduleMonitor = new Queue("ScheduleMonitor", REDIS_URI);
export const sendScheduledMessages = new Queue("SendSacheduledMessages", REDIS_URI);
export const campaignQueue = new Queue("CampaignQueue", REDIS_URI);

// Handlers de debug (úteis p/ entender se a fila está viva)
[ userMonitor, messageQueue, scheduleMonitor, sendScheduledMessages, campaignQueue ].forEach(q => {
q.on("ready", () => logger.info(`[Bull] Queue ready: ${q.name}`));
q.on("error", (err) => logger.error(`[Bull] Queue error (${q.name}):`, err));
q.on("stalled", (job) => logger.warn(`[Bull] Job stalled (${q.name}): ${job?.id}`));
q.on("failed", (job, err) => logger.error(
  `[Bull] Job failed (${q.name}): ${job?.id} -> ${err?.message}`
));
q.on("completed", (job) => logger.info(`[Bull] Job completed (${q.name}): ${job.id}`));
});

interface ProcessCampaignData {
id: number;
delay: number;
}

interface PrepareContactData {
contactId: number;
campaignId: number;
delay: number;
variables: any[];
}

interface DispatchCampaignData {
campaignId: number;
campaignShippingId: number;
contactListItemId: number;
}

async function handleSendMessage(job: any) {
try {
  const { data } = job;

  const whatsapp = await Whatsapp.findByPk(data.whatsappId);
  if (whatsapp == null) throw Error("Whatsapp não identificado");

  const messageData: MessageData = data.data;
  await SendMessage(whatsapp, messageData);
} catch (e: any) {
  Sentry.captureException(e);
  logger.error("MessageQueue -> SendMessage: error", e?.message);
  throw e;
}
}

async function handleVerifySchedules(_job: any) {
try {
  // Heartbeat para ver no log que o cron está rodando
  logger.info(`[ScheduleMonitor] Rodando verificação ${new Date().toISOString()}`);

  const { count, rows: schedules } = await Schedule.findAndCountAll({
    where: {
      status: "PENDENTE",
      sentAt: null,
      sendAt: {
        [Op.gte]: moment().format("YYYY-MM-DD HH:mm:ss"),
        [Op.lte]: moment().add(30, "seconds").format("YYYY-MM-DD HH:mm:ss")
      }
    },
    include: [{ model: Contact, as: "contact" }]
  });

  logger.info(`[ScheduleMonitor] Encontrados ${count} agendamentos para ~30s`);

  if (count > 0) {
    schedules.map(async schedule => {
      await schedule.update({ status: "AGENDADA" });
      await sendScheduledMessages.add("SendMessage", { schedule }, { delay: 40000 });
      logger.info(`Agendado envio para: ${schedule.contact?.name || schedule.contactId}`);
    });
  }
} catch (e: any) {
  Sentry.captureException(e);
  logger.error("SendScheduledMessage -> Verify: error", e);
  if (e?.stack) logger.error(e.stack);
  throw e;
}
}

// Função para processar variáveis nos agendamentos (igual campanhas)
async function getProcessedScheduleMessage(msg: string, contact: any, variables: any[] = []) {
  let finalMessage = msg;
  
  // Variáveis padrão do contato
  if (finalMessage.includes("{nome}")) {
    finalMessage = finalMessage.replace(/{nome}/g, contact.name || "");
  }
  if (finalMessage.includes("{numero}")) {
    finalMessage = finalMessage.replace(/{numero}/g, contact.number || "");
  }
  if (finalMessage.includes("{email}")) {
    finalMessage = finalMessage.replace(/{email}/g, contact.email || "");
  }

  // Variáveis personalizadas (se houver)
  variables.forEach(variable => {
    if (finalMessage.includes(`{${variable.key}}`)) {
      const regex = new RegExp(`{${variable.key}}`, "g");
      finalMessage = finalMessage.replace(regex, variable.value);
    }
  });

  // Buscar colunas personalizadas
  try {
    const customColumns = await CustomColumn.findAll();
    
    for (const column of customColumns) {
      if (finalMessage.includes(`{${column.name}}`)) {
        const regex = new RegExp(`{${column.name}}`, "g");
        finalMessage = finalMessage.replace(regex, column.message);
      }
    }
  } catch (error) {
    console.error("Erro ao buscar colunas personalizadas:", error);
  }
  
  return finalMessage;
}

async function handleSendScheduledMessage(job: any) {
  const { data: { schedule } } = job;
  let scheduleRecord: Schedule | null = null;

  try {
    scheduleRecord = await Schedule.findByPk(schedule.id, {
      include: [{ model: Contact, as: "contact" }]
    });
    
    if (!scheduleRecord) {
      throw new Error(`Schedule não encontrado: ${schedule.id}`);
    }
  } catch (e) {
    Sentry.captureException(e);
    logger.info(`Erro ao tentar consultar agendamento: ${schedule.id}`);
    return;
  }

  try {
    const whatsapp = await GetDefaultWhatsApp();
    const wbot = await GetWhatsappWbot(whatsapp);
    
    if (!wbot) {
      throw new Error(`WBOT não foi obtido para whatsapp: ${whatsapp.id}`);
    }

    const chatId = `${scheduleRecord.contact.number}@c.us`;
    
    // Processar variáveis na mensagem (igual nas campanhas) - CORREÇÃO: Adicionado await
    const processedMessage = await getProcessedScheduleMessage(
      scheduleRecord.body, 
      scheduleRecord.contact, 
      [] // aqui você pode passar variáveis personalizadas se precisar
    );
    
    // Enviar mensagem processada
    await wbot.sendMessage(chatId, processedMessage);

    await scheduleRecord.update({
      sentAt: moment().format("YYYY-MM-DD HH:mm"),
      status: "ENVIADA"
    });

    logger.info(`Mensagem agendada enviada para: ${scheduleRecord.contact.name}`);
    sendScheduledMessages.clean(15000, "completed");
  } catch (e: any) {
    Sentry.captureException(e);
    await scheduleRecord?.update({ status: "ERRO" });
    logger.error("SendScheduledMessage -> SendMessage: error", e?.message);
    throw e;
  }
}

async function handleVerifyCampaigns(_job: any) {
console.log("=== [DEBUG] INICIANDO VERIFY CAMPAIGNS ===");

const campaigns: { id: number; scheduledAt: string }[] = await sequelize.query(
  `SELECT id, scheduledAt FROM Campaigns WHERE scheduledAt BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 1 HOUR) AND status = 'PROGRAMADA'`,
  { type: QueryTypes.SELECT }
);

logger.info(`Campanhas encontradas: ${campaigns.length}`);
console.log(`[DEBUG] Campanhas encontradas:`, campaigns);

for (let campaign of campaigns) {
  try {
    const now = moment();
    const scheduledAt = moment(campaign.scheduledAt);
    let delay = scheduledAt.diff(now, "milliseconds");
    
    // Correção do delay negativo
    delay = Math.max(0, delay);

    console.log(`[DEBUG] Processando campanha ${campaign.id}, delay original: ${scheduledAt.diff(now, "milliseconds")}, delay corrigido: ${delay}`);

    logger.info(
      `Campanha enviada para a fila: Campanha=${campaign.id}, DelayInicial=${delay}`
    );

    await campaignQueue.add(
      "ProcessCampaign",
      { id: campaign.id, delay },
      { removeOnComplete: true }
    );
    
    console.log(`[DEBUG] Job ProcessCampaign adicionado para campanha: ${campaign.id}`);
  } catch (err: any) {
    Sentry.captureException(err);
    console.log(`[DEBUG ERROR] Erro ao processar campanha ${campaign.id}:`, err.message);
  }
}

console.log("=== [DEBUG] VERIFY CAMPAIGNS FINALIZADO ===");
}

async function getCampaign(id: any) {
return await Campaign.findByPk(id, {
  include: [
    {
      model: ContactList,
      as: "contactList",
      attributes: ["id", "name"],
      include: [
        {
          model: ContactListItem,
          as: "contacts",
          attributes: ["id", "name", "number", "email", "isWhatsappValid"],
          where: { isWhatsappValid: true }
        }
      ]
    },
    { model: Whatsapp, as: "whatsapp", attributes: ["id", "name"] },
    { model: CampaignShipping, as: "shipping", include: [{ model: ContactListItem, as: "contact" }] }
  ]
});
}

async function getContact(id: any) {
return await ContactListItem.findByPk(id, {
  attributes: ["id", "name", "number", "email"]
});
}

async function getSettings() {
let messageInterval = 20;
let longerIntervalAfter = 20;
let greaterInterval = 60;
let variables: any[] = [];

return { messageInterval, longerIntervalAfter, greaterInterval, variables };
}

export function parseToMilliseconds(seconds: any) {
return seconds * 1000;
}

async function sleep(seconds: any) {
logger.info(`Sleep de ${seconds} segundos iniciado: ${moment().format("HH:mm:ss")}`);
return new Promise(resolve => {
  setTimeout(() => {
    logger.info(`Sleep de ${seconds} segundos finalizado: ${moment().format("HH:mm:ss")}`);
    resolve(true);
  }, parseToMilliseconds(seconds));
});
}

function getCampaignValidMessages(campaign: any) {
const messages: string[] = [];
if (!isEmpty(campaign.message1) && !isNil(campaign.message1)) messages.push(campaign.message1);
if (!isEmpty(campaign.message2) && !isNil(campaign.message2)) messages.push(campaign.message2);
if (!isEmpty(campaign.message3) && !isNil(campaign.message3)) messages.push(campaign.message3);
if (!isEmpty(campaign.message4) && !isNil(campaign.message4)) messages.push(campaign.message4);
if (!isEmpty(campaign.message5) && !isNil(campaign.message5)) messages.push(campaign.message5);
return messages;
}

function getCampaignValidConfirmationMessages(campaign: any) {
const messages: string[] = [];
if (!isEmpty(campaign.confirmationMessage1) && !isNil(campaign.confirmationMessage1)) messages.push(campaign.confirmationMessage1);
if (!isEmpty(campaign.confirmationMessage2) && !isNil(campaign.confirmationMessage2)) messages.push(campaign.confirmationMessage2);
if (!isEmpty(campaign.confirmationMessage3) && !isNil(campaign.confirmationMessage3)) messages.push(campaign.confirmationMessage3);
if (!isEmpty(campaign.confirmationMessage4) && !isNil(campaign.confirmationMessage4)) messages.push(campaign.confirmationMessage4);
if (!isEmpty(campaign.confirmationMessage5) && !isNil(campaign.confirmationMessage5)) messages.push(campaign.confirmationMessage5);
return messages;
}

async function getProcessedMessage(msg: string, variables: any[], contact: any) {
  let finalMessage = msg;
  
  // Variáveis padrão
  if (finalMessage.includes("{nome}")) finalMessage = finalMessage.replace(/{nome}/g, contact.name || "");
  if (finalMessage.includes("{email}")) finalMessage = finalMessage.replace(/{email}/g, contact.email || "");
  if (finalMessage.includes("{numero}")) finalMessage = finalMessage.replace(/{numero}/g, contact.number || "");

  // Variáveis personalizadas do sistema antigo
  variables.forEach(variable => {
    if (finalMessage.includes(`{${variable.key}}`)) {
      const regex = new RegExp(`{${variable.key}}`, "g");
      finalMessage = finalMessage.replace(regex, variable.value);
    }
  });

  // Buscar colunas personalizadas
  try {
    const customColumns = await CustomColumn.findAll();
    
    for (const column of customColumns) {
      if (finalMessage.includes(`{${column.name}}`)) {
        const regex = new RegExp(`{${column.name}}`, "g");
        finalMessage = finalMessage.replace(regex, column.message);
      }
    }
  } catch (error) {
    console.error("Erro ao buscar colunas personalizadas:", error);
  }
  
  return finalMessage;
}

export function randomValue(min: any, max: any) {
return Math.floor(Math.random() * max) + min;
}

async function verifyAndFinalizeCampaign(campaign: any) {
const { contacts } = campaign.contactList;

const count1 = contacts.length;
const count2 = await CampaignShipping.count({
  where: {
    campaignId: campaign.id,
    deliveredAt: { [Op.not as any]: null }
  }
});

if (count1 === count2) {
  await campaign.update({ status: "FINALIZADA", completedAt: moment() });
}

const io = getIO();
io.emit(`campaign`, { action: "update", record: campaign });
}

async function handleProcessCampaign(job: any) {
try {
  console.log("=== [DEBUG] INICIANDO PROCESS CAMPAIGN ===");
  console.log(`[DEBUG] Job ID: ${job.id}, Data:`, job.data);
  
  const { id }: ProcessCampaignData = job.data;
  let { delay }: ProcessCampaignData = job.data;
  
  console.log(`[DEBUG] Buscando campanha ID: ${id}`);
  const campaign = await getCampaign(id);
  
  if (!campaign) {
    console.log(`[DEBUG] Campaign NOT found for ID: ${id}`);
    logger.error(`Campaign not found: ${id}`);
    return;
  }
  
  console.log(`[DEBUG] Campaign found: ${campaign.id}, Status: ${campaign.status}`);
  console.log(`[DEBUG] Campaign details:`, {
    name: campaign.name,
    whatsappId: campaign.whatsapp?.id,
    contactListId: campaign.contactList?.id,
    contactsCount: campaign.contactList?.contacts?.length || 0
  });
  
  const settings = await getSettings();
  console.log(`[DEBUG] Settings:`, settings);
  
  const { contacts } = campaign.contactList;
  if (isArray(contacts) && contacts.length > 0) {
    console.log(`[DEBUG] Processing ${contacts.length} contacts`);
    let index = 0;
    for (let contact of contacts) {
      console.log(`[DEBUG] Adding PrepareContact job for contact ${index + 1}/${contacts.length}: ${contact.name} (${contact.id})`);
      
      await campaignQueue.add(
        "PrepareContact",
        { contactId: contact.id, campaignId: campaign.id, variables: settings.variables, delay: delay || 0 },
        { removeOnComplete: true }
      );

      logger.info(
        `Registro enviado pra fila de disparo: Campanha=${campaign.id};Contato=${contact.name};delay=${delay}`
      );

      index++;
      if (index % settings.longerIntervalAfter === 0) {
        delay += parseToMilliseconds(settings.greaterInterval);
        console.log(`[DEBUG] Applied greater interval: ${settings.greaterInterval}s`);
      } else {
        const randomDelay = randomValue(0, settings.messageInterval);
        delay += parseToMilliseconds(randomDelay);
        console.log(`[DEBUG] Applied random interval: ${randomDelay}s`);
      }
    }
    await campaign.update({ status: "EM_ANDAMENTO" });
    console.log(`[DEBUG] Campaign updated to EM_ANDAMENTO`);
  } else {
    console.log(`[DEBUG] No contacts found or contacts is not an array`);
  }
  
  console.log("=== [DEBUG] PROCESS CAMPAIGN FINALIZADO COM SUCESSO ===");
} catch (err: any) {
  Sentry.captureException(err);
  console.log(`[DEBUG ERROR] ProcessCampaign:`, err.message);
  console.log(`[DEBUG ERROR] Stack:`, err.stack);
  logger.error(`ProcessCampaign error: ${err.message}`);
}
}

async function handlePrepareContact(job: any) {
try {
  console.log("=== [DEBUG] INICIANDO PREPARE CONTACT ===");
  console.log(`[DEBUG] Job ID: ${job.id}, Data:`, job.data);
  
  const { contactId, campaignId, delay, variables }: PrepareContactData = job.data;
  
  console.log(`[DEBUG] Buscando campanha ID: ${campaignId}`);
  const campaign = await getCampaign(campaignId);
  
  if (!campaign) {
    console.log(`[DEBUG] Campaign NOT found: ${campaignId}`);
    logger.error(`Campaign not found: campaignId=${campaignId}`);
    return;
  }
  
  console.log(`[DEBUG] Buscando contato ID: ${contactId}`);
  const contact = await getContact(contactId);

  if (!contact) {
    console.log(`[DEBUG] Contact NOT found: ${contactId}`);
    logger.error(`Contact not found: contactId=${contactId}`);
    return;
  }

  console.log(`[DEBUG] Contact found:`, {
    id: contact.id,
    name: contact.name,
    number: contact.number
  });

  const campaignShipping: any = {
    number: contact.number,
    contactId,
    campaignId
  };

  const messages = getCampaignValidMessages(campaign);
  console.log(`[DEBUG] Valid messages found: ${messages.length}`);
  
  if (messages.length) {
    const radomIndex = randomValue(0, messages.length);
    // CORREÇÃO: Adicionado await
    const message = await getProcessedMessage(messages[radomIndex], variables, contact);
    campaignShipping.message = `\u200c${message}`;
    console.log(`[DEBUG] Message processed (index ${radomIndex}): ${message.substring(0, 50)}...`);
  } else {
    console.log(`[DEBUG] No valid messages found for campaign`);
    return;
  }

  if (campaign && campaign.confirmation) {
    const confirmationMessages = getCampaignValidConfirmationMessages(campaign);
    console.log(`[DEBUG] Valid confirmation messages found: ${confirmationMessages.length}`);
    
    if (confirmationMessages.length) {
      const radomIndex = randomValue(0, confirmationMessages.length);
      // CORREÇÃO: Adicionado await
      const message = await getProcessedMessage(confirmationMessages[radomIndex], variables, contact);
      campaignShipping.confirmationMessage = `\u200c${message}`;
      console.log(`[DEBUG] Confirmation message processed`);
    }
  }

  console.log(`[DEBUG] Creating/finding CampaignShipping record...`);
  const [record, created] = await CampaignShipping.findOrCreate({
    where: { campaignId: campaignShipping.campaignId, contactId: campaignShipping.contactId },
    defaults: campaignShipping
  });

  console.log(`[DEBUG] CampaignShipping result: ID=${record.id}, created=${created}`);

  if (!created && record.deliveredAt === null && record.confirmationRequestedAt === null) {
    console.log(`[DEBUG] Updating existing record...`);
    record.set(campaignShipping);
    await record.save();
  }

  if (!record.deliveredAt && !record.confirmationRequestedAt) {
    console.log(`[DEBUG] Adding DispatchCampaign job with delay: ${delay}ms`);
    
    const nextJob = await campaignQueue.add(
      "DispatchCampaign",
      { campaignId: campaign?.id, campaignShippingId: record.id, contactListItemId: contactId },
      { delay }
    );

    console.log(`[DEBUG] DispatchCampaign job created: ${nextJob.id}`);
    await record.update({ jobId: nextJob.id });
  } else {
    console.log(`[DEBUG] Job not created - already processed:`, {
      deliveredAt: record.deliveredAt,
      confirmationRequestedAt: record.confirmationRequestedAt
    });
  }

  await verifyAndFinalizeCampaign(campaign);
  console.log("=== [DEBUG] PREPARE CONTACT FINALIZADO COM SUCESSO ===");
} catch (err: any) {
  Sentry.captureException(err);
  console.log(`[DEBUG ERROR] PrepareContact:`, err.message);
  console.log(`[DEBUG ERROR] Stack:`, err.stack);
  logger.error(`campaignQueue -> PrepareContact -> error: ${err.message}`);
}
}

async function handleDispatchCampaign(job: any) {
  let campaignShipping = null;
  try {
    console.log(`[DEBUG] PROCESSOR DispatchCampaign chamado com job:`, job.id);
    console.log("=== [DEBUG] INICIANDO DISPATCH CAMPAIGN ===");
    const { data } = job;
    const { campaignShippingId, campaignId }: DispatchCampaignData = data;
    
    console.log(`[DEBUG] Job Data:`, {
      campaignShippingId,
      campaignId,
      jobId: job.id
    });

    const campaign = await getCampaign(campaignId);
    console.log(`[DEBUG] Campaign found:`, campaign ? {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      whatsappId: campaign.whatsapp?.id,
      confirmation: campaign.confirmation
    } : 'NULL');

    if (!campaign || !campaign.whatsapp) {
      console.log(`[DEBUG] Campaign or whatsapp not found: campaignId=${campaignId}`);
      logger.error(`[DEBUG] Campaign or whatsapp not found: campaignId=${campaignId}`);
      return;
    }

    console.log(`[DEBUG] Tentando obter WBOT para whatsapp:`, campaign.whatsapp.id);
    const wbot = await GetWhatsappWbot(campaign.whatsapp);
    console.log(`[DEBUG] WBOT obtido:`, wbot ? 'SUCCESS' : 'FAILED');
    
    if (!wbot) {
      console.log(`[DEBUG] WBOT não foi obtido para whatsapp: ${campaign.whatsapp.id}`);
      logger.error(`[DEBUG] WBOT não foi obtido para whatsapp: ${campaign.whatsapp.id}`);
      return;
    }

    logger.info(`[DEBUG] Disparo de campanha solicitado: Campanha=${campaignId};Registro=${campaignShippingId}`);

    campaignShipping = await CampaignShipping.findByPk(campaignShippingId, {
      include: [{ model: ContactListItem, as: "contact" }]
    });

    console.log(`[DEBUG] CampaignShipping found:`, campaignShipping ? {
      id: campaignShipping.id,
      number: campaignShipping.number,
      contactName: campaignShipping.contact?.name,
      message: campaignShipping.message?.substring(0, 100) + "...",
      confirmation: campaignShipping.confirmation,
      deliveredAt: campaignShipping.deliveredAt,
      confirmationRequestedAt: campaignShipping.confirmationRequestedAt
    } : 'NULL');

    if (!campaignShipping) {
      console.log(`[DEBUG] CampaignShipping not found: campaignShippingId=${campaignShippingId}`);
      logger.error(`[DEBUG] CampaignShipping not found: campaignShippingId=${campaignShippingId}`);
      return;
    }

    const chatId = `${campaignShipping.number}@c.us`;
    console.log(`[DEBUG] ChatId gerado:`, chatId);

    console.log(`[DEBUG] Verificando condições de envio:`, {
      campaignConfirmation: campaign.confirmation,
      shippingConfirmation: campaignShipping.confirmation,
      needsConfirmation: campaign.confirmation && campaignShipping.confirmation === null
    });

    if (campaign.confirmation && campaignShipping.confirmation === null) {
      console.log(`[DEBUG] Enviando mensagem de confirmação...`);
      console.log(`[DEBUG] Mensagem de confirmação:`, campaignShipping.confirmationMessage);
      
      const confirmResult = await wbot.sendMessage(chatId, campaignShipping.confirmationMessage);
      
      console.log(`[DEBUG] Resultado envio confirmação:`, confirmResult);
      
      await campaignShipping.update({ confirmationRequestedAt: moment() });
      console.log(`[DEBUG] CampaignShipping atualizado com confirmationRequestedAt`);
      
    } else {
      console.log(`[DEBUG] Enviando mensagem principal...`);
      console.log(`[DEBUG] Mensagem principal:`, campaignShipping.message);
      
      const messageResult = await wbot.sendMessage(chatId, campaignShipping.message);
      
      console.log(`[DEBUG] Resultado envio mensagem:`, messageResult);
      
      if (campaign.mediaPath) {
        console.log(`[DEBUG] Enviando mídia:`, campaign.mediaPath);
        const filePath = path.resolve("public", campaign.mediaPath);
        const options = await getMessageOptions(campaign.mediaName, filePath);
        if (options && Object.keys(options).length) {
          const mediaResult = await wbot.sendMessage(chatId, options);
          console.log(`[DEBUG] Resultado envio mídia:`, mediaResult);
        }
      }
      
      await campaignShipping.update({ deliveredAt: moment() });
      console.log(`[DEBUG] CampaignShipping atualizado com deliveredAt`);
    }

    await verifyAndFinalizeCampaign(campaign);

    const io = getIO();
    io.emit(`campaign`, { action: "update", record: campaign });

    logger.info(`[DEBUG] Campanha enviada para: Campanha=${campaignId};Contato=${campaignShipping.contact.name}`);
    console.log("=== [DEBUG] DISPATCH CAMPAIGN FINALIZADO COM SUCESSO ===");
    console.log(`[DEBUG] PROCESSOR DispatchCampaign finalizado para job:`, job.id);
    
  } catch (err: any) {
    Sentry.captureException(err);
    logger.error(`[DEBUG ERROR] handleDispatchCampaign:`, err.message);
    logger.error(`[DEBUG ERROR] Stack:`, err.stack);
    console.log("=== [DEBUG] DISPATCH CAMPAIGN FINALIZADO COM ERRO ===");
    
    // Tentar marcar como erro
    if (campaignShipping) {
      try {
        await campaignShipping.update({ 
          errorAt: moment(),
          errorMessage: err.message 
        });
      } catch (updateErr) {
        logger.error(`[DEBUG] Erro ao atualizar campaignShipping com erro:`, updateErr);
      }
    }
    
    throw err;
  }
}

async function handleLoginStatus(_job: any) {
const users: { id: number }[] = await sequelize.query(
  `SELECT id FROM Users WHERE updatedAt < DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND online = 1`,
  { type: QueryTypes.SELECT }
);
for (let item of users) {
  try {
    const user = await User.findByPk(item.id);
    if (!user) {
      logger.warn(`User not found: userId=${item.id}`);
      continue;
    }
    await user.update({ online: false });
    logger.info(`Usuário passado para offline: ${item.id}`);
  } catch (e) {
    Sentry.captureException(e);
  }
}
}

export async function startQueueProcess() {
logger.info("Iniciando processamento de filas");

// registrando processors
messageQueue.process("SendMessage", handleSendMessage);
scheduleMonitor.process("Verify", handleVerifySchedules);
sendScheduledMessages.process("SendMessage", handleSendScheduledMessage);
campaignQueue.process("VerifyCampaigns", handleVerifyCampaigns);
campaignQueue.process("ProcessCampaign", handleProcessCampaign);
campaignQueue.process("PrepareContact", handlePrepareContact);
campaignQueue.process("DispatchCampaign", handleDispatchCampaign);
userMonitor.process("VerifyLoginStatus", handleLoginStatus);

// adicionando jobs recorrentes (use await para garantir o agendamento)
await scheduleMonitor.add("Verify", {}, { repeat: { cron: "*/5 * * * * *" }, removeOnComplete: true });
await campaignQueue.add("VerifyCampaigns", {}, { repeat: { cron: "*/20 * * * * *" }, removeOnComplete: true });
await userMonitor.add("VerifyLoginStatus", {}, { repeat: { cron: "* * * * *" }, removeOnComplete: true });

logger.info("Filas registradas e jobs recorrentes adicionados.");
}