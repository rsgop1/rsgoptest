import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminApiRouter from "./admin.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin", adminApiRouter);

export default router;
