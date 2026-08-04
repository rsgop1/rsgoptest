import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminApiRouter from "./admin.js";
import learnerRouter from "./learner.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin", adminApiRouter);
router.use("/learner", learnerRouter);

export default router;
