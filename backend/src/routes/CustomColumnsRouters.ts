import express from "express";
import isAuth from "../middleware/isAuth";

import * as CustomColumnController from "../controllers/CustomColumnController";

const customColumnRoutes = express.Router();

customColumnRoutes.get("/custom-columns", isAuth, CustomColumnController.index);

customColumnRoutes.get("/custom-columns/:customColumnId", isAuth, CustomColumnController.show);

customColumnRoutes.post("/custom-columns", isAuth, CustomColumnController.store);

customColumnRoutes.put("/custom-columns/:customColumnId", isAuth, CustomColumnController.update);

customColumnRoutes.delete("/custom-columns/:customColumnId", isAuth, CustomColumnController.remove);

export default customColumnRoutes;