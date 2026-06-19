import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  paymentsTable,
  testSeriesTable,
  purchasedTestsTable,
  globalConfigTable,
  flashSalesTable,
  userHistoryTable,
  adsTable,
} from "@workspace/db";
import { eq, and, count, gte, sql, desc, gt } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import { getApi } from "../bot/api-instance.js";
import { setConfig, getConfig } from "../bot/handlers/helpers.js";
import { logger } from "../lib/logger.js";
import { telemetryEmitter, getRecentEvents, emitTelemetry } from "../lib/telemetry.js";
import { createHmac, randomBytes } from "crypto";

const ADMIN_PASSWORD = "rsg@123";
const COOKIE_NAME = "tbadmin";
const COOKIE_SECRET = process.env["SESSION_SECRET"] ?? "fallback-secret-change-me";

function signValue(value: string): string {
  const hmac = createHmac("sha256", COOKIE_SECRET);
  hmac.update(value);
  return `${value}.${hmac.digest("hex")}`;
}

function verifyValue(signed: string): string | null {
  const parts = signed.split(".");
  if (parts.length < 2) return null;
  const sig = parts.pop()!;
  const value = parts.join(".");
  const expected = createHmac("sha256", COOKIE_SECRET).update(value).digest("hex");
  return sig === expected ? value : null;
}

function isAuthenticated(req: Request): boolean {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return false;
  return verifyValue(cookie) === "admin";
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: "Not authenticated" });
}

function generateTestId(): string {
  return randomBytes(3).toString("hex");
}

const router = Router();

router.post("/auth/login", (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (password === ADMIN_PASSWORD) {
    res.cookie(COOKIE_NAME, signValue("admin"), {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });
    res.json({ authenticated: true });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

router.get("/auth/me", (req: Request, res: Response) => {
  if (isAuthenticated(req)) {
    res.json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

router.post("/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true, message: "Logged out" });
});

router.get("/stats", requireAuth, async (_req: Request, res: Response) => {
  try {
    const [totalUsers] = await db.select({ cnt: count() }).from(usersTable);
    const [premiumUsers] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.tier, "Premium"));
    const yesterday = new Date(Date.now() - 86400000);
    const [newUsersToday] = await db.select({ cnt: count() }).from(usersTable).where(gte(usersTable.joinedAt, yesterday));
    const [totalTests] = await db.select({ cnt: count() }).from(testSeriesTable);
    const [pendingPayments] = await db.select({ cnt: count() }).from(paymentsTable).where(eq(paymentsTable.status, "Pending"));
    const [upiRow] = await db.select({ total: sql<number>`COALESCE(SUM(amount),0)` }).from(paymentsTable).where(and(eq(paymentsTable.method, "UPI"), eq(paymentsTable.status, "Approved")));
    const [starsRow] = await db.select({ total: sql<number>`COALESCE(SUM(amount),0)` }).from(paymentsTable).where(and(eq(paymentsTable.method, "TG_Stars"), eq(paymentsTable.status, "Approved")));
    const [totalAttempts] = await db.select({ cnt: count() }).from(userHistoryTable);

    res.json({
      totalUsers: totalUsers?.cnt ?? 0,
      premiumUsers: premiumUsers?.cnt ?? 0,
      newUsersToday: newUsersToday?.cnt ?? 0,
      totalTests: totalTests?.cnt ?? 0,
      pendingPayments: pendingPayments?.cnt ?? 0,
      upiEarnings: Number(upiRow?.total ?? 0),
      starsEarnings: Number(starsRow?.total ?? 0),
      totalTestAttempts: totalAttempts?.cnt ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "Admin stats error");
    res.status(500).json({ error: "Failed to load stats" });
  }
});

router.get("/payments", requireAuth, async (req: Request, res: Response) => {
  try {
    const status = req.query["status"] as string | undefined;
    let payments;
    if (status) {
      payments = await db.select().from(paymentsTable).where(eq(paymentsTable.status, status)).orderBy(desc(paymentsTable.submittedAt));
    } else {
      payments = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.submittedAt));
    }
    res.json(payments.map((p) => ({
      id: p.id,
      paymentId: p.paymentId,
      userId: p.userId,
      method: p.method,
      amount: p.amount,
      testId: p.testId,
      screenshotFileId: p.screenshotFileId,
      status: p.status,
      submittedAt: p.submittedAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "Admin list payments error");
    res.status(500).json({ error: "Failed to load payments" });
  }
});

router.post("/payments/:paymentId/approve", requireAuth, async (req: Request, res: Response) => {
  try {
    const { paymentId } = req.params as { paymentId: string };
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.paymentId, paymentId)).limit(1);
    if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

    await db.update(paymentsTable).set({ status: "Approved" }).where(eq(paymentsTable.paymentId, paymentId));

    const api = getApi();
    if (payment.testId && payment.testId !== "premium") {
      await db.insert(purchasedTestsTable).values({ userId: payment.userId, testId: payment.testId }).catch(() => {});
      await api.sendMessage(payment.userId, `✅ Payment Approved!\n\nYour UPI payment has been verified! Test unlocked.\n\nUse /test_series to access it.`).catch(() => {});
    } else {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      await db.update(usersTable).set({ tier: "Premium", premiumExpiry: expiry }).where(eq(usersTable.userId, payment.userId));
      await api.sendMessage(payment.userId, `💎 Premium Activated!\n\nYour payment has been verified. Series TestPro Premium is now active for 30 days!\n\nUse /test_series to access all tests.`).catch(() => {});
    }

    emitTelemetry(`User ${payment.userId} paid ₹${payment.amount} via ${payment.method} — Approved`);
    res.json({ success: true, message: "Payment approved" });
  } catch (err) {
    logger.error({ err }, "Error approving payment");
    res.status(500).json({ error: "Failed to approve payment" });
  }
});

router.post("/payments/:paymentId/reject", requireAuth, async (req: Request, res: Response) => {
  try {
    const { paymentId } = req.params as { paymentId: string };
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.paymentId, paymentId)).limit(1);
    if (payment) {
      await db.update(paymentsTable).set({ status: "Rejected" }).where(eq(paymentsTable.paymentId, paymentId));
      const api = getApi();
      await api.sendMessage(payment.userId, `❌ Payment Rejected\n\nYour payment screenshot could not be verified. Please send a valid screenshot or contact admin.`).catch(() => {});
    }
    res.json({ success: true, message: "Payment rejected" });
  } catch (err) {
    logger.error({ err }, "Error rejecting payment");
    res.status(500).json({ error: "Failed to reject payment" });
  }
});

router.get("/payment-image/:fileId", requireAuth, async (req: Request, res: Response) => {
  try {
    const api = getApi();
    const file = await api.getFile(String(req.params["fileId"]));
    const token = process.env["TELEGRAM_BOT_TOKEN"]!;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) { res.status(404).send("Image not found"); return; }
    const buffer = await response.arrayBuffer();
    res.set("Content-Type", "image/jpeg");
    res.send(Buffer.from(buffer));
  } catch (err) {
    logger.error({ err }, "Error fetching payment image");
    res.status(500).json({ error: "Failed to fetch image" });
  }
});

router.get("/tests", requireAuth, async (_req: Request, res: Response) => {
  try {
    const tests = await db.select().from(testSeriesTable).orderBy(desc(testSeriesTable.createdAt));
    res.json(tests.map((t) => ({
      id: t.id,
      testId: t.testId,
      testName: t.testName,
      mainCategory: t.mainCategory,
      subCategory: t.subCategory,
      positiveMarking: t.positiveMarking,
      negativeMarking: t.negativeMarking,
      priceInr: t.priceInr,
      priceInStars: t.priceInStars,
      isActive: t.isActive,
      timerSeconds: t.timerSeconds,
      createdAt: t.createdAt.toISOString(),
      questionCount: Array.isArray(t.questionsData) ? t.questionsData.length : 0,
    })));
  } catch (err) {
    logger.error({ err }, "Admin list tests error");
    res.status(500).json({ error: "Failed to load tests" });
  }
});

router.post("/tests", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string | number>;
    const { testName, mainCategory, subCategory, positiveMarking, negativeMarking, priceInr, priceInStars, questionsJson, timerSeconds, language } = body as Record<string, string>;

    let questions: unknown[];
    try {
      questions = JSON.parse(questionsJson ?? "[]");
      if (!Array.isArray(questions)) throw new Error("Not an array");
    } catch {
      res.status(400).json({ error: "Invalid questions JSON" });
      return;
    }

    const autoTestId = generateTestId();
    const lang = (language ?? "en") as "en" | "hi";
    const timerSec = Math.max(10, parseInt(String(timerSeconds ?? "30")) || 30);

    const questionsWithIds = (questions as QuestionData[]).map((q, i) => ({
      id: `${autoTestId}_q${i}`,
      question: q.question ?? "",
      options: q.options ?? [],
      correctOptionIndex: q.correctOptionIndex ?? 0,
      explanation: q.explanation ?? "",
      language: q.language ?? lang,
    }));

    const [inserted] = await db.insert(testSeriesTable).values({
      testId: autoTestId,
      testName,
      mainCategory,
      subCategory,
      positiveMarking: parseFloat(String(positiveMarking ?? "1")),
      negativeMarking: parseFloat(String(negativeMarking ?? "0.25")),
      priceInr: parseInt(String(priceInr ?? "0")),
      priceInStars: parseInt(String(priceInStars ?? "0")),
      questionsData: questionsWithIds,
      timerSeconds: timerSec,
    }).returning();

    emitTelemetry(`New test imported: "${testName}" (ID: ${autoTestId}) — ${questionsWithIds.length} questions`);
    res.status(201).json({
      id: inserted!.id,
      testId: inserted!.testId,
      testName: inserted!.testName,
      mainCategory: inserted!.mainCategory,
      subCategory: inserted!.subCategory,
      positiveMarking: inserted!.positiveMarking,
      negativeMarking: inserted!.negativeMarking,
      priceInr: inserted!.priceInr,
      priceInStars: inserted!.priceInStars,
      isActive: inserted!.isActive,
      timerSeconds: inserted!.timerSeconds,
      createdAt: inserted!.createdAt.toISOString(),
      questionCount: questionsWithIds.length,
    });
  } catch (err) {
    logger.error({ err }, "Error importing test");
    res.status(500).json({ error: "Failed to import test" });
  }
});

router.put("/tests/:testId", requireAuth, async (req: Request, res: Response) => {
  try {
    const testId = String(req.params["testId"]);
    const body = req.body as Record<string, string | number>;
    const { testName, mainCategory, subCategory, positiveMarking, negativeMarking, priceInr, priceInStars, timerSeconds, language, questionsJson } = body as Record<string, string>;

    const updateData: Record<string, unknown> = {};
    if (testName !== undefined) updateData["testName"] = testName;
    if (mainCategory !== undefined) updateData["mainCategory"] = mainCategory;
    if (subCategory !== undefined) updateData["subCategory"] = subCategory;
    if (positiveMarking !== undefined) updateData["positiveMarking"] = parseFloat(String(positiveMarking));
    if (negativeMarking !== undefined) updateData["negativeMarking"] = parseFloat(String(negativeMarking));
    if (priceInr !== undefined) updateData["priceInr"] = parseInt(String(priceInr));
    if (priceInStars !== undefined) updateData["priceInStars"] = parseInt(String(priceInStars));
    if (timerSeconds !== undefined) updateData["timerSeconds"] = Math.max(10, parseInt(String(timerSeconds)) || 30);

    if (questionsJson) {
      let questions: unknown[];
      try {
        questions = JSON.parse(questionsJson);
        if (!Array.isArray(questions)) throw new Error("Not an array");
      } catch {
        res.status(400).json({ error: "Invalid questions JSON" });
        return;
      }
      const lang = (language ?? "en") as "en" | "hi";
      updateData["questionsData"] = (questions as QuestionData[]).map((q, i) => ({
        id: `${testId}_q${i}`,
        question: q.question ?? "",
        options: q.options ?? [],
        correctOptionIndex: q.correctOptionIndex ?? 0,
        explanation: q.explanation ?? "",
        language: q.language ?? lang,
      }));
    }

    await db.update(testSeriesTable).set(updateData as any).where(eq(testSeriesTable.testId, testId));
    const [updated] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!updated) { res.status(404).json({ error: "Test not found" }); return; }

    emitTelemetry(`Test updated: "${updated.testName}" (ID: ${testId})`);
    res.json({
      testId: updated.testId,
      testName: updated.testName,
      mainCategory: updated.mainCategory,
      subCategory: updated.subCategory,
      positiveMarking: updated.positiveMarking,
      negativeMarking: updated.negativeMarking,
      priceInr: updated.priceInr,
      priceInStars: updated.priceInStars,
      isActive: updated.isActive,
      timerSeconds: updated.timerSeconds,
      questionCount: Array.isArray(updated.questionsData) ? updated.questionsData.length : 0,
    });
  } catch (err) {
    logger.error({ err }, "Error editing test");
    res.status(500).json({ error: "Failed to edit test" });
  }
});

router.delete("/tests/:testId", requireAuth, async (req: Request, res: Response) => {
  try {
    const testId = String(req.params["testId"]);
    await db.delete(testSeriesTable).where(eq(testSeriesTable.testId, testId));
    res.json({ success: true, message: "Test deleted" });
  } catch (err) {
    logger.error({ err }, "Error deleting test");
    res.status(500).json({ error: "Failed to delete test" });
  }
});

router.post("/tests/:testId/toggle", requireAuth, async (req: Request, res: Response) => {
  try {
    const testId = String(req.params["testId"]);
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { res.status(404).json({ error: "Test not found" }); return; }
    await db.update(testSeriesTable).set({ isActive: !test.isActive }).where(eq(testSeriesTable.testId, testId));
    res.json({ success: true, message: `Test ${test.isActive ? "deactivated" : "activated"}` });
  } catch (err) {
    logger.error({ err }, "Error toggling test");
    res.status(500).json({ error: "Failed to toggle test" });
  }
});

router.get("/tests/:testId/analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    const testId = String(req.params["testId"]);
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { res.status(404).json({ error: "Test not found" }); return; }

    const history = await db.select().from(userHistoryTable).where(eq(userHistoryTable.testId, testId));
    const totalAttempts = history.length;
    const avgScore = totalAttempts > 0 ? history.reduce((s, h) => s + h.score, 0) / totalAttempts : 0;
    const avgAccuracy = totalAttempts > 0 ? history.reduce((s, h) => s + h.accuracy, 0) / totalAttempts : 0;
    const bestScore = totalAttempts > 0 ? Math.max(...history.map(h => h.score)) : 0;

    const userMap = new Map<number, { score: number }>();
    for (const h of history) {
      const existing = userMap.get(h.userId);
      if (!existing || h.score > existing.score) userMap.set(h.userId, { score: h.score });
    }
    const topUserIds = [...userMap.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 5);
    const topScorers: Array<{ userId: number; score: number; name: string }> = [];
    for (const [uid, data] of topUserIds) {
      const [user] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.userId, uid)).limit(1);
      topScorers.push({ userId: uid, score: data.score, name: user?.fullName ?? String(uid) });
    }

    const qCount = Array.isArray(test.questionsData) ? test.questionsData.length : 0;
    const maxPossible = qCount * test.positiveMarking;
    const buckets = [0, 0, 0, 0, 0];
    for (const h of history) {
      const pct = maxPossible > 0 ? (h.score / maxPossible) * 100 : 0;
      const bucket = Math.min(4, Math.max(0, Math.floor(pct / 20)));
      buckets[bucket]++;
    }

    res.json({
      testId: test.testId,
      testName: test.testName,
      totalAttempts,
      avgScore: parseFloat(avgScore.toFixed(2)),
      avgAccuracy: parseFloat(avgAccuracy.toFixed(1)),
      bestScore,
      topScorers,
      scoreDistribution: [
        { range: "0–20%", count: buckets[0] },
        { range: "20–40%", count: buckets[1] },
        { range: "40–60%", count: buckets[2] },
        { range: "60–80%", count: buckets[3] },
        { range: "80–100%", count: buckets[4] },
      ],
    });
  } catch (err) {
    logger.error({ err }, "Analytics error");
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

router.get("/categories", requireAuth, async (_req: Request, res: Response) => {
  try {
    const raw = await getConfig("categories");
    const cats = raw ? JSON.parse(raw) as Record<string, string[]> : {
      SSC: ["CGL", "CHSL", "Stenographer", "MTS", "GD Constable", "Selection Post"],
      Railway: ["RRB NTPC", "RRC Group D", "RRB ALP", "RPF SI"],
      Banking: ["IBPS PO", "IBPS Clerk", "SBI PO", "SBI Clerk"],
      Bihar: ["BPSC Pre", "BSSC Inter Level", "Bihar Police SI", "BTSC"],
    };
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: "Failed to load categories" });
  }
});

router.post("/categories", requireAuth, async (req: Request, res: Response) => {
  try {
    const { main, sub } = req.body as { main: string; sub?: string };
    const raw = await getConfig("categories");
    const cats = raw ? JSON.parse(raw) as Record<string, string[]> : {};

    if (!cats[main]) cats[main] = [];
    if (sub && !cats[main]!.includes(sub)) cats[main]!.push(sub);

    await setConfig("categories", JSON.stringify(cats));
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: "Failed to update categories" });
  }
});

router.delete("/categories/:main/:sub", requireAuth, async (req: Request, res: Response) => {
  try {
    const main = String(req.params["main"] ?? "");
    const sub = String(req.params["sub"] ?? "");
    const raw = await getConfig("categories");
    const cats = raw ? JSON.parse(raw) as Record<string, string[]> : {};
    if (cats[main]) cats[main] = cats[main]!.filter(s => s !== sub);
    await setConfig("categories", JSON.stringify(cats));
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete subcategory" });
  }
});

router.get("/ads", requireAuth, async (_req: Request, res: Response) => {
  try {
    const ads = await db.select().from(adsTable).orderBy(desc(adsTable.createdAt));
    res.json(ads);
  } catch (err) {
    res.status(500).json({ error: "Failed to load ads" });
  }
});

router.post("/ads", requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, mediaType, telegramFileId, adText, buttonText, buttonUrl, frequencyEvery } = req.body as Record<string, string>;
    const [ad] = await db.insert(adsTable).values({
      title,
      mediaType: mediaType ?? "image",
      telegramFileId: telegramFileId || null,
      adText: adText || null,
      buttonText: buttonText || null,
      buttonUrl: buttonUrl || null,
      frequencyEvery: parseInt(String(frequencyEvery ?? "1")) || 1,
    }).returning();
    emitTelemetry(`New ad created: "${title}"`);
    res.status(201).json(ad);
  } catch (err) {
    res.status(500).json({ error: "Failed to create ad" });
  }
});

router.patch("/ads/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? "0"));
    const { isActive } = req.body as { isActive?: boolean };
    if (isActive !== undefined) {
      await db.update(adsTable).set({ isActive }).where(eq(adsTable.id, id));
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update ad" });
  }
});

router.delete("/ads/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.delete(adsTable).where(eq(adsTable.id, parseInt(String(req.params["id"] ?? "0"))));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete ad" });
  }
});

router.get("/telemetry/stream", requireAuth, (req: Request, res: Response) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const recent = getRecentEvents(150);
  for (const line of recent) {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  }

  const onEvent = (line: string) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(line)}\n\n`);
  };

  telemetryEmitter.on("event", onEvent);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(`: ping\n\n`);
    else clearInterval(heartbeat);
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    telemetryEmitter.off("event", onEvent);
  });
});

router.get("/flash-sales", requireAuth, async (_req: Request, res: Response) => {
  try {
    const sales = await db.select().from(flashSalesTable).orderBy(desc(flashSalesTable.createdAt));
    res.json(sales.map((s) => ({
      id: s.id,
      testId: s.testId,
      discountInr: s.discountInr,
      discountStars: s.discountStars,
      endsAt: s.endsAt.toISOString(),
      isActive: s.isActive,
      createdAt: s.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "Admin list flash sales error");
    res.status(500).json({ error: "Failed to load flash sales" });
  }
});

router.post("/flash-sales", requireAuth, async (req: Request, res: Response) => {
  try {
    const { testId, discountInr, discountStars, endsAt } = req.body as { testId: string; discountInr: number; discountStars: number; endsAt: string };
    const [inserted] = await db.insert(flashSalesTable).values({
      testId, discountInr: Number(discountInr), discountStars: Number(discountStars), endsAt: new Date(endsAt),
    }).returning();

    res.status(201).json({
      id: inserted!.id,
      testId: inserted!.testId,
      discountInr: inserted!.discountInr,
      discountStars: inserted!.discountStars,
      endsAt: inserted!.endsAt.toISOString(),
      isActive: inserted!.isActive,
      createdAt: inserted!.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Error creating flash sale");
    res.status(500).json({ error: "Failed to create flash sale" });
  }
});

router.delete("/flash-sales/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.delete(flashSalesTable).where(eq(flashSalesTable.id, Number(req.params["id"])));
    res.json({ success: true, message: "Flash sale deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete flash sale" });
  }
});

router.get("/settings", requireAuth, async (_req: Request, res: Response) => {
  try {
    const configs = await db.select().from(globalConfigTable);
    const cfg = Object.fromEntries(configs.map((c) => [c.key, c.value]));
    res.json({
      admin_upi_vpa: cfg["admin_upi_vpa"] ?? "",
      force_sub_enabled: cfg["force_sub_enabled"] ?? "false",
      force_sub_channel: cfg["force_sub_channel"] ?? "",
      leaderboard_channel: cfg["leaderboard_channel"] ?? "",
    });
  } catch (err) {
    logger.error({ err }, "Admin settings error");
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.post("/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string>;
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) await setConfig(key, String(value));
    }
    res.json({ success: true, message: "Settings saved" });
  } catch (err) {
    logger.error({ err }, "Error saving settings");
    res.status(500).json({ error: "Failed to save settings" });
  }
});

router.post("/broadcast", requireAuth, async (req: Request, res: Response) => {
  try {
    const { target, message } = req.body as { target: string; message: string };
    if (!message?.trim()) { res.status(400).json({ error: "Message required" }); return; }

    let users: { userId: number }[];
    if (target === "free") {
      users = await db.select({ userId: usersTable.userId }).from(usersTable).where(eq(usersTable.tier, "Free"));
    } else if (target === "premium") {
      users = await db.select({ userId: usersTable.userId }).from(usersTable).where(eq(usersTable.tier, "Premium"));
    } else {
      users = await db.select({ userId: usersTable.userId }).from(usersTable);
    }

    const api = getApi();
    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        await api.sendMessage(u.userId, `📢 Series TestPro Update\n\n${message}`);
        sent++;
        await new Promise((r) => setTimeout(r, 50));
      } catch { failed++; }
    }
    emitTelemetry(`Broadcast sent to ${sent} users (${failed} failed)`);
    res.json({ sent, failed });
  } catch (err) {
    logger.error({ err }, "Broadcast error");
    res.status(500).json({ error: "Failed to broadcast" });
  }
});

router.get("/users", requireAuth, async (_req: Request, res: Response) => {
  try {
    const users = await db.select().from(usersTable).orderBy(desc(usersTable.joinedAt)).limit(100);
    const historyCounts = await db
      .select({ userId: userHistoryTable.userId, cnt: count() })
      .from(userHistoryTable)
      .groupBy(userHistoryTable.userId);
    const historyMap = new Map(historyCounts.map((h) => [h.userId, h.cnt]));

    res.json(users.map((u) => ({
      id: u.id,
      userId: u.userId,
      fullName: u.fullName,
      username: u.username,
      tier: u.tier,
      targetExamSub: u.targetExamSub,
      totalTestsTaken: historyMap.get(u.userId) ?? 0,
      referralCount: u.referralCount,
      joinedAt: u.joinedAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "Admin list users error");
    res.status(500).json({ error: "Failed to load users" });
  }
});

export default router;
