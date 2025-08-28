import { proto } from "@whiskeysockets/baileys";
import * as Sentry from "@sentry/node";
import fs from "fs";
import { exec } from "child_process";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Ticket from "../../models/Ticket";
import mime from "mime-types";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
}

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

// Converte áudio para OGG/Opus (uso em PTT/voz)
const processAudioToOgg = async (audio: string): Promise<string> => {
  const outputAudio = path.join(publicFolder, `${Date.now()}.ogg`);
  return new Promise((resolve, reject) => {
    const cmd = `"${ffmpegPath.path}" -i "${audio}" -vn -ac 1 -ar 48000 -c:a libopus -b:a 64k "${outputAudio}" -y`;
    exec(cmd, (error) => {
      try { fs.unlinkSync(audio); } catch {}
      if (error) return reject(error);
      resolve(outputAudio);
    });
  });
};

// Converte áudio para MP3 (uso em áudio comum, não-PTT)
const processAudioFile = async (audio: string): Promise<string> => {
  const outputAudio = path.join(publicFolder, `${Date.now()}.mp3`);
  return new Promise((resolve, reject) => {
    const cmd = `"${ffmpegPath.path}" -i "${audio}" -vn -ar 44100 -ac 2 -b:a 192k "${outputAudio}" -y`;
    exec(cmd, (error) => {
      try { fs.unlinkSync(audio); } catch {}
      if (error) return reject(error);
      resolve(outputAudio);
    });
  });
};

// TIPAGEM COMPATÍVEL COM O SEU WBOT
type Wbot = Awaited<ReturnType<typeof GetTicketWbot>>;
type SendContent = Parameters<Wbot["sendMessage"]>[1]; // <- tipo que o seu sendMessage espera (MessageContent no seu wrapper)

export const getMessageOptions = async (
  fileName: string,
  pathMedia: string
): Promise<any> => {
  const mimeType = mime.lookup(pathMedia);
  if (!mimeType) throw new Error("Invalid mimetype");

  const typeMessage = mimeType.split("/")[0];

  try {
    // Montamos como objeto JS simples; só tipamos na HORA DE ENVIAR
    let options: any;

    if (typeMessage === "video") {
      options = {
        video: fs.readFileSync(pathMedia),
        fileName
      };
    } else if (typeMessage === "audio") {
      const isSiteRecord = fileName.includes("audio-record-site");

      if (isSiteRecord) {
        // PTT/voz → OGG/Opus
        const converted = await processAudioToOgg(pathMedia);
        options = {
          audio: fs.readFileSync(converted),
          mimetype: "audio/ogg; codecs=opus",
          ptt: true
        };
      } else {
        // Áudio comum → MP3
        const converted = await processAudioFile(pathMedia);
        options = {
          audio: fs.readFileSync(converted),
          mimetype: mimeType
        };
      }
    } else if (typeMessage === "document" || typeMessage === "application") {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: fileName,
        fileName,
        mimetype: mimeType
      };
    } else {
      // imagem
      options = {
        image: fs.readFileSync(pathMedia),
        caption: fileName
      };
    }

    return options;
  } catch (e) {
    Sentry.captureException(e);
    console.log(e);
    return null;
  }
};

const SendWhatsAppMedia = async ({
  media,
  ticket,
  body
}: Request): Promise<any> => {
  try {
    const wbot = await GetTicketWbot(ticket);

    const pathMedia = media.path;
    const typeMessage = media.mimetype.split("/")[0];

    // objeto solto; tipamos só na chamada
    let options: any;

    if (typeMessage === "video") {
      options = {
        video: fs.readFileSync(pathMedia),
        caption: body,
        fileName: media.originalname
      };
    } else if (typeMessage === "audio") {
      const isSiteRecord = media.originalname.includes("audio-record-site");

      if (isSiteRecord) {
        // PTT/voz
        const converted = await processAudioToOgg(media.path);
        options = {
          audio: fs.readFileSync(converted),
          mimetype: "audio/ogg; codecs=opus",
          ptt: true
        };
      } else {
        // Áudio comum
        const converted = await processAudioFile(media.path);
        options = {
          audio: fs.readFileSync(converted),
          mimetype: media.mimetype
        };
      }
    } else if (
      typeMessage === "document" ||
      typeMessage === "text" ||
      typeMessage === "application"
    ) {
      options = {
        document: fs.readFileSync(pathMedia),
        caption: body,
        fileName: media.originalname,
        mimetype: media.mimetype
      };
    } else {
      options = {
        image: fs.readFileSync(pathMedia),
        caption: body
      };
    }

    const jid = `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`;

    // Aqui fazemos o cast para o tipo que o SEU sendMessage espera
    const sentMessage = await wbot.sendMessage(jid, options as any);

    await ticket.update({ lastMessage: media.filename });

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;