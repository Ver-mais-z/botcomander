import { Router } from "express";

import userRoutes from "./userRoutes";
import authRoutes from "./authRoutes";
import settingRoutes from "./settingRoutes";
import contactRoutes from "./contactRoutes";
import ticketRoutes from "./ticketRoutes";
import whatsappRoutes from "./whatsappRoutes";
import messageRoutes from "./messageRoutes";
import whatsappSessionRoutes from "./whatsappSessionRoutes";
import queueRoutes from "./queueRoutes";
import quickAnswerRoutes from "./quickAnswerRoutes";
import apiRoutes from "./apiRoutes";
import campaignRoutes from "./campaignRoutes";
import ContactListItem from "./contactListItemRoutes";
import CampaignSetting from "./campaignSettingRoutes";
import ContactList from "./contactListRoutes";
import Schedule from "./scheduleRoutes";
import CustomColumn from "./CustomColumnsRouters";


const routes = Router();

routes.use(userRoutes);
routes.use("/auth", authRoutes);
routes.use(settingRoutes);
routes.use(contactRoutes);
routes.use(ticketRoutes);
routes.use(whatsappRoutes);
routes.use(messageRoutes);
routes.use(whatsappSessionRoutes);
routes.use(queueRoutes);
routes.use(quickAnswerRoutes);
routes.use(campaignRoutes);
routes.use(ContactListItem);
routes.use(CampaignSetting);
routes.use(ContactList);
routes.use(Schedule);
routes.use(CustomColumn);
routes.use("/api/messages", apiRoutes);

export default routes;
