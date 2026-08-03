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
  reportsTable,
  liveTestsTable,
  achievementsTable,
  couponCodesTable,
  userCustomSetsTable,
  supportTicketsTable,
} from "@workspace/db";
import { eq, and, count, gte, sql, desc, gt, lt, inArray } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import { getApi } from "../bot/api-instance.js";
import { setConfig, getConfig } from "../bot/handlers/helpers.js";
import { logger } from "../lib/logger.js";
import { telemetryEmitter, getRecentEvents, emitTelemetry } from "../lib/telemetry.js";
import { createHmac, randomBytes } from "crypto";
import { getVipConfig, grantVipAccess, removeVipAccess, rotateVipAccessCode, syncVipAccess } from "../bot/handlers/vip.js";
import { getAgenticAnalysisStatus, runAgenticAnalysis } from "../bot/agentic.js";

const ADMIN_PASSWORD = "rsg@123";
const COOKIE_NAME = "tbadmin";
const COOKIE_SECRET = process.env["SESSION_SECRET"] ?? "fallback-secret-change-me";

function signValue(value: string): string {
  const hmac = createHmac("sha256", COOKIE_SECRET);
  hmac.update(value);
  return `${value}.${hmac.digest("hex")}`;
}

type QuestionAnalyticsRow = {
  index: number;
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  attempts: number;
  answered: number;
  skipped: number;
  correct: number;
  wrong: number;
  accuracy: number;
  skipRate: number;
  optionDistribution: Array<{ optionIndex: number; option: string; count: number; percentage: number; isCorrect: boolean }>;
  difficulty: "Easy" | "Moderate" | "Hard" | "Very hard";
  discrimination: number;
};

function buildQuestionAnalytics(
  questions: QuestionData[],
  history: Array<{ userAnswers: unknown }>,
): QuestionAnalyticsRow[] {
  return questions.map((question, index) => {
    const counts = question.options.map(() => 0);
    let attempts = 0;
    let answered = 0;
    let correct = 0;
    for (const row of history) {
      attempts++;
      const answers = Array.isArray(row.userAnswers) ? row.userAnswers : [];
      const answer = answers[index];
      if (typeof answer !== "number" || answer < 0) continue;
      answered++;
      if (counts[answer] !== undefined) counts[answer]++;
      if (answer === question.correctOptionIndex) correct++;
    }
    const wrong = answered - correct;
    const skipped = attempts - answered;
    const accuracy = answered ? (correct / answered) * 100 : 0;
    const skipRate = attempts ? (skipped / attempts) * 100 : 0;
    const optionDistribution = question.options.map((option, optionIndex) => ({
      optionIndex,
      option,
      count: counts[optionIndex] ?? 0,
      percentage: answered ? ((counts[optionIndex] ?? 0) / answered) * 100 : 0,
      isCorrect: optionIndex === question.correctOptionIndex,
    }));
    const difficulty = accuracy >= 75 ? "Easy" : accuracy >= 50 ? "Moderate" : accuracy >= 25 ? "Hard" : "Very hard";
    return {
      index,
      id: question.id ?? `q${index + 1}`,
      question: question.question,
      options: question.options,
      correctOptionIndex: question.correctOptionIndex,
      explanation: question.explanation ?? "",
      attempts,
      answered,
      skipped,
      correct,
      wrong,
      accuracy: Number(accuracy.toFixed(1)),
      skipRate: Number(skipRate.toFixed(1)),
      optionDistribution,
      difficulty,
      discrimination: 0,
    };
  });
}

function addQuestionDiscrimination(
  rows: QuestionAnalyticsRow[],
  history: Array<{ score: number; userAnswers: unknown }>,
): QuestionAnalyticsRow[] {
  if (history.length < 4) return rows;
  const sorted = [...history].sort((a, b) => b.score - a.score);
  const bandSize = Math.max(1, Math.ceil(sorted.length * 0.27));
  const top = sorted.slice(0, bandSize);
  const bottom = sorted.slice(-bandSize);
  return rows.map((row) => {
    const accuracyFor = (band: typeof top) => {
      let answered = 0;
      let correct = 0;
      for (const attempt of band) {
        const answers = Array.isArray(attempt.userAnswers) ? attempt.userAnswers : [];
        const answer = answers[row.index];
        if (typeof answer === "number" && answer >= 0) {
          answered++;
          if (answer === row.correctOptionIndex) correct++;
        }
      }
      return answered ? correct / answered : 0;
    };
    const discrimination = (accuracyFor(top) - accuracyFor(bottom)) * 100;
    return { ...row, discrimination: Number(discrimination.toFixed(1)) };
  });
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
    // The Replit preview can reach the API through an internal HTTP hop even
    // when the public page is HTTPS. Only mark the cookie Secure when the
    // request actually arrived over HTTPS, otherwise the browser drops it
    // and every authenticated API call becomes 401.
    const isHttps = req.secure || req.get("x-forwarded-proto") === "https";
    res.cookie(COOKIE_NAME, signValue("admin"), {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: isHttps ? "none" : "lax",
      secure: isHttps,
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
      questionsData: t.questionsData,
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

router.get("/tests/:testId/question-analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    const testId = String(req.params["testId"]);
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { res.status(404).json({ error: "Test not found" }); return; }
    const history = await db.select({
      score: userHistoryTable.score,
      userAnswers: userHistoryTable.userAnswers,
    }).from(userHistoryTable).where(eq(userHistoryTable.testId, testId));
    const questions = Array.isArray(test.questionsData) ? test.questionsData as QuestionData[] : [];
    const rows = addQuestionDiscrimination(buildQuestionAnalytics(questions, history), history);
    const hardest = [...rows].sort((a, b) => a.accuracy - b.accuracy).slice(0, 5).map((q) => q.index);
    const easiest = [...rows].sort((a, b) => b.accuracy - a.accuracy).slice(0, 5).map((q) => q.index);
    res.json({
      testId, testName: test.testName, totalAttempts: history.length,
      questions: rows, hardest, easiest,
      insights: {
        questionsTracked: rows.filter((q) => q.answered > 0).length,
        averageQuestionAccuracy: rows.length ? Number((rows.reduce((sum, q) => sum + q.accuracy, 0) / rows.length).toFixed(1)) : 0,
        highSkipQuestions: rows.filter((q) => q.skipRate >= 25).length,
        hardQuestions: rows.filter((q) => q.difficulty === "Hard" || q.difficulty === "Very hard").length,
      },
    });
  } catch (err) {
    logger.error({ err }, "Question analytics error");
    res.status(500).json({ error: "Failed to load question analytics" });
  }
});

router.get("/agentic-analysis/status", requireAuth, async (_req: Request, res: Response) => {
  res.json(getAgenticAnalysisStatus());
});

router.post("/agentic-analysis/run", requireAuth, async (_req: Request, res: Response) => {
  try {
    await runAgenticAnalysis();
    res.json(getAgenticAnalysisStatus());
  } catch (err) {
    logger.error({ err }, "Agentic analysis manual run failed");
    res.status(500).json({ error: "Agentic analysis run failed" });
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
      bot_groups: cfg["bot_groups"] ?? "[]",
      anon_doubt_group: cfg["anon_doubt_group"] ?? "",
      vip_group_id: cfg["vip_group_id"] ?? "-1004496413344",
      vip_enabled: cfg["vip_enabled"] ?? "true",
      vip_access_code: cfg["vip_access_code"] ?? "VIP-2026",
      vip_welcome_message: cfg["vip_welcome_message"] ?? "Welcome to the VIP study group. Your premium access is active.",
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

router.get("/vip/status", requireAuth, async (_req: Request, res: Response) => {
  try {
    const config = await getVipConfig();
    const groupId = Number(config.groupId);
    const api = getApi();
    const chat = await api.getChat(groupId);
    const me = await api.getMe();
    const botMember = await api.getChatMember(groupId, me.id);
    res.json({ ...config, groupTitle: "title" in chat ? chat.title : "VIP Group", botStatus: botMember.status });
  } catch (err) {
    logger.warn({ err }, "VIP status check failed");
    res.status(400).json({ error: "Unable to access VIP group. Check the group ID and ensure the bot is an administrator." });
  }
});

router.post("/vip/sync", requireAuth, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await syncVipAccess()) });
  } catch (err) {
    logger.error({ err }, "VIP sync failed");
    res.status(500).json({ error: "VIP sync failed" });
  }
});

router.post("/vip/rotate-code", requireAuth, async (_req: Request, res: Response) => {
  try {
    const accessCode = await rotateVipAccessCode();
    res.json({ success: true, accessCode });
  } catch (err) {
    res.status(500).json({ error: "Could not rotate VIP access code" });
  }
});

router.post("/vip/message", requireAuth, async (req: Request, res: Response) => {
  try {
    const message = String((req.body as { message?: string }).message ?? "").trim();
    if (!message) { res.status(400).json({ error: "Message required" }); return; }
    const config = await getVipConfig();
    const groupId = Number(config.groupId);
    const posted = await getApi().sendMessage(groupId, `💎 VIP UPDATE\n\n${message}`);
    res.json({ success: true, messageId: posted.message_id });
  } catch (err) {
    logger.error({ err }, "VIP group message failed");
    res.status(400).json({ error: "Could not send message to VIP group" });
  }
});

router.post("/vip/test-message", requireAuth, async (_req: Request, res: Response) => {
  try {
    const config = await getVipConfig();
    const posted = await getApi().sendMessage(Number(config.groupId), "✅ VIP group connection is working. This is a test message from the Admin Panel.");
    res.json({ success: true, messageId: posted.message_id });
  } catch (err) {
    res.status(400).json({ error: "Could not send test message. Check bot admin permissions." });
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
      premiumExpiry: u.premiumExpiry ? u.premiumExpiry.toISOString() : null,
      targetExamSub: u.targetExamSub,
      targetExamMain: u.targetExamMain,
      accuracyRate: u.accuracyRate,
      totalTestsTaken: historyMap.get(u.userId) ?? 0,
      referralCount: u.referralCount,
      aiDoubtCount: u.aiDoubtCount,
      aiDoubtDate: u.aiDoubtDate,
      anonDoubtsUsed: u.anonDoubtsUsed,
      anonDoubtDate: u.anonDoubtDate,
      joinedAt: u.joinedAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "Admin list users error");
    res.status(500).json({ error: "Failed to load users" });
  }
});

router.post("/users/:userId/premium", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params["userId"]);
    const days = Number((req.body as { days?: number }).days);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
      res.status(400).json({ error: "Days must be a whole number between 1 and 3650" });
      return;
    }

    const [user] = await db.select({
      userId: usersTable.userId,
      fullName: usersTable.fullName,
      premiumExpiry: usersTable.premiumExpiry,
    }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const base = user.premiumExpiry && user.premiumExpiry > new Date()
      ? new Date(user.premiumExpiry)
      : new Date();
    base.setDate(base.getDate() + days);
    await db.update(usersTable)
      .set({ tier: "Premium", premiumExpiry: base })
      .where(eq(usersTable.userId, userId));

    await getApi().sendMessage(userId, `💎 Premium access updated!\n\nYou now have Premium access until ${base.toLocaleDateString("en-IN")}.\n\nEnjoy unlimited premium features!`).catch(() => {});
    await grantVipAccess(userId, "Admin premium grant");
    emitTelemetry(`Admin granted ${days} premium days to user ${userId}`);
    res.json({ success: true, message: `Premium granted until ${base.toISOString()}`, premiumExpiry: base.toISOString() });
  } catch (err) {
    logger.error({ err }, "Admin grant premium error");
    res.status(500).json({ error: "Failed to grant premium access" });
  }
});

router.delete("/users/:userId/premium", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params["userId"]);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }
    const [user] = await db.select({ userId: usersTable.userId }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await db.update(usersTable).set({ tier: "Free", premiumExpiry: null }).where(eq(usersTable.userId, userId));
    await removeVipAccess(userId);
    await getApi().sendMessage(userId, "Your Premium access has been ended by admin. Contact support if you have questions.").catch(() => {});
    emitTelemetry(`Admin revoked premium for user ${userId}`);
    res.json({ success: true, message: "Premium access revoked" });
  } catch (err) {
    logger.error({ err }, "Admin revoke premium error");
    res.status(500).json({ error: "Failed to revoke premium access" });
  }
});

router.post("/users/:userId/message", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params["userId"]);
    const message = String((req.body as { message?: string }).message ?? "").trim();
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }
    if (!message || message.length > 4000) {
      res.status(400).json({ error: "Message must be between 1 and 4000 characters" });
      return;
    }
    const [user] = await db.select({ userId: usersTable.userId }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await getApi().sendMessage(userId, `📩 Message from Series TestPro Admin\n\n${message}`);
    emitTelemetry(`Admin sent a direct message to user ${userId}`);
    res.json({ success: true, message: "Message sent" });
  } catch (err) {
    logger.error({ err }, "Admin direct user message error");
    res.status(500).json({ error: "Failed to send message. The user may have blocked the bot." });
  }
});

router.post("/users/:userId/reset-usage", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params["userId"]);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }
    const [user] = await db.select({ userId: usersTable.userId }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await db.update(usersTable).set({
      aiDoubtCount: 0,
      aiDoubtDate: null,
      anonDoubtsUsed: 0,
      anonDoubtDate: null,
    }).where(eq(usersTable.userId, userId));
    emitTelemetry(`Admin reset daily AI usage for user ${userId}`);
    res.json({ success: true, message: "Daily AI usage reset" });
  } catch (err) {
    logger.error({ err }, "Admin reset user usage error");
    res.status(500).json({ error: "Failed to reset user usage" });
  }
});

// ── REPORTS ─────────────────────────────────────────────────────────────────
router.get("/reports", requireAuth, async (req: Request, res: Response) => {
  try {
    const status = (req.query["status"] as string) ?? "open";
    const rows = await db.select().from(reportsTable)
      .where(status === "all" ? undefined : eq(reportsTable.status, status))
      .orderBy(desc(reportsTable.createdAt))
      .limit(100);
    res.json(rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    })));
  } catch (err) {
    logger.error({ err }, "Admin reports error");
    res.status(500).json({ error: "Failed to load reports" });
  }
});

// ── SUPPORT TICKETS ─────────────────────────────────────────────────────────
router.get("/support-tickets", requireAuth, async (req: Request, res: Response) => {
  try {
    const status = String(req.query["status"] ?? "all");
    const category = String(req.query["category"] ?? "all");
    const priority = String(req.query["priority"] ?? "all");
    const search = String(req.query["search"] ?? "").trim();
    const filters = [];
    if (status !== "all") filters.push(eq(supportTicketsTable.status, status));
    if (category !== "all") filters.push(eq(supportTicketsTable.category, category));
    if (priority !== "all") filters.push(eq(supportTicketsTable.priority, priority));
    if (search) {
      const numericUser = Number(search);
      filters.push(Number.isFinite(numericUser) && search === String(numericUser)
        ? sql`(${supportTicketsTable.message} ILIKE ${`%${search}%`} OR ${supportTicketsTable.userId} = ${numericUser} OR CAST(${supportTicketsTable.id} AS TEXT) = ${search})`
        : sql`(${supportTicketsTable.message} ILIKE ${`%${search}%`} OR CAST(${supportTicketsTable.id} AS TEXT) = ${search})`);
    }
    const rows = await db
      .select({
        id: supportTicketsTable.id,
        userId: supportTicketsTable.userId,
        category: supportTicketsTable.category,
        message: supportTicketsTable.message,
        status: supportTicketsTable.status,
        priority: supportTicketsTable.priority,
        adminNote: supportTicketsTable.adminNote,
        resolvedBy: supportTicketsTable.resolvedBy,
        createdAt: supportTicketsTable.createdAt,
        updatedAt: supportTicketsTable.updatedAt,
        fullName: usersTable.fullName,
        username: usersTable.username,
        tier: usersTable.tier,
      })
      .from(supportTicketsTable)
      .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.userId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(supportTicketsTable.updatedAt), desc(supportTicketsTable.createdAt))
      .limit(250);
    res.json(rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "Admin support tickets error");
    res.status(500).json({ error: "Failed to load support tickets" });
  }
});

router.patch("/support-tickets/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const body = req.body as { status?: string; priority?: string; adminNote?: string | null };
    const [before] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: "Ticket not found" }); return; }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status && ["open", "in_progress", "resolved", "closed"].includes(body.status)) updates.status = body.status;
    if (body.priority && ["low", "normal", "high", "urgent"].includes(body.priority)) updates.priority = body.priority;
    if (body.adminNote !== undefined) updates.adminNote = body.adminNote?.trim() || null;
    if (updates.status === "resolved" || updates.status === "closed") updates.resolvedBy = 0;
    await db.update(supportTicketsTable).set(updates).where(eq(supportTicketsTable.id, id));
    const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id)).limit(1);
    if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }
    const noteChanged = body.adminNote !== undefined && (body.adminNote?.trim() || null) !== (before.adminNote?.trim() || null);
    if (body.status === "resolved" || body.status === "closed" || noteChanged) {
      try {
        const statusLine = body.status && body.status !== before.status
          ? `\nStatus: ${body.status}`
          : "";
        const noteLine = body.adminNote?.trim()
          ? `\n\nAdmin reply:\n${body.adminNote.trim()}`
          : "";
        await getApi().sendMessage(ticket.userId,
          `🎫 Support ticket #${ticket.id} update${statusLine}${noteLine}\n\nUse /support → My Tickets to view the full ticket history.`);
      } catch (notifyErr) {
        logger.warn({ err: notifyErr, ticketId: id }, "Could not notify ticket user");
      }
    }
    res.json({ success: true, ticket: { ...ticket, createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString() } });
  } catch (err) {
    logger.error({ err }, "Admin update support ticket error");
    res.status(500).json({ error: "Failed to update support ticket" });
  }
});

router.patch("/reports/:id/resolve", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const { adminNote } = req.body as { adminNote?: string };
    await db.update(reportsTable).set({
      status: "resolved",
      adminNote: adminNote ?? null,
      resolvedAt: new Date(),
    }).where(eq(reportsTable.id, id));

    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id)).limit(1);
    if (report) {
      try {
        const api = getApi();
        await api.sendMessage(
          report.userId,
          `✅ *Your report has been reviewed\\!*\n\nQ${report.questionIndex + 1}: _"${report.questionText.slice(0, 80)}…"_\n\n${adminNote ? `*Admin Note:* ${adminNote}` : "The issue has been noted and will be corrected\\."}\n\nThank you for helping improve Series TestPro\\! 🙏`,
          { parse_mode: "MarkdownV2" }
        );
      } catch { }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to resolve report" });
  }
});

router.delete("/reports/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.delete(reportsTable).where(eq(reportsTable.id, Number(req.params["id"])));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete report" });
  }
});

// ── LIVE TESTS ───────────────────────────────────────────────────────────────
router.get("/live-tests", requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(liveTestsTable).orderBy(desc(liveTestsTable.scheduledAt)).limit(50);
    res.json(rows.map((r) => ({
      ...r,
      scheduledAt: r.scheduledAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      participantCount: Array.isArray(r.participants) ? r.participants.length : 0,
      mode: r.groupChatId ? "group_poll" : "group_required",
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to load live tests" });
  }
});

router.post("/live-tests", requireAuth, async (req: Request, res: Response) => {
  try {
    const { testId, title, scheduledAt, groupChatId, timerSeconds } = req.body as {
      testId: string; title: string; scheduledAt: string; groupChatId?: string; timerSeconds?: number;
    };
    if (!testId || !title || !scheduledAt) {
      res.status(400).json({ error: "testId, title, scheduledAt required" });
      return;
    }
    const timer = Number(timerSeconds ?? 30);
    if (![15, 30].includes(timer)) {
      res.status(400).json({ error: "timerSeconds must be 15 or 30" });
      return;
    }
    const [inserted] = await db.insert(liveTestsTable).values({
      testId,
      title,
      scheduledAt: new Date(scheduledAt),
      groupChatId: groupChatId ? Number(groupChatId) : null,
      status: "scheduled",
      timerSeconds: timer,
    }).returning();

    emitTelemetry(`Live test scheduled: "${title}" at ${scheduledAt}`);

    const { announceLiveTest } = await import("../bot/handlers/live-test.js");
    announceLiveTest(inserted!.id).catch(err => logger.warn({ err }, "Could not auto-announce live test"));

    res.status(201).json({
      ...inserted,
      scheduledAt: inserted!.scheduledAt.toISOString(),
      createdAt: inserted!.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Error creating live test");
    res.status(500).json({ error: "Failed to create live test" });
  }
});

router.delete("/live-tests/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.update(liveTestsTable).set({ status: "completed" }).where(eq(liveTestsTable.id, Number(req.params["id"])));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to cancel live test" });
  }
});

router.get("/live-tests/:id/participants", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const [lt] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, id)).limit(1);
    if (!lt) { res.status(404).json({ error: "Live test not found" }); return; }
    const participantIds: number[] = Array.isArray(lt.participants) ? lt.participants as number[] : [];
    if (participantIds.length === 0) { res.json([]); return; }
    const users = await db
      .select({ userId: usersTable.userId, fullName: usersTable.fullName, tier: usersTable.tier, username: usersTable.username })
      .from(usersTable)
      .where(inArray(usersTable.userId, participantIds));
    res.json(users);
  } catch (err) {
    logger.error({ err }, "Error getting participants");
    res.status(500).json({ error: "Failed to get participants" });
  }
});

router.post("/live-tests/:id/announce", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const [lt] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, id)).limit(1);
    if (!lt) { res.status(404).json({ error: "Not found" }); return; }
    // Force to scheduled so announceLiveTest runs
    await db.update(liveTestsTable).set({ status: "scheduled" }).where(eq(liveTestsTable.id, id));
    const { announceLiveTest } = await import("../bot/handlers/live-test.js");
    announceLiveTest(id).catch(err => logger.error({ err }, "Announce error"));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Announce live test error");
    res.status(500).json({ error: "Failed to announce" });
  }
});

router.post("/live-tests/:id/notify", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const [lt] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, id)).limit(1);
    if (!lt) { res.status(404).json({ error: "Not found" }); return; }
    // Force to announced so sendLiveTestReminder runs
    await db.update(liveTestsTable).set({ status: "announced" }).where(eq(liveTestsTable.id, id));
    const { sendLiveTestReminder } = await import("../bot/handlers/live-test.js");
    sendLiveTestReminder(id).catch(err => logger.error({ err }, "Reminder error"));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Notify live test error");
    res.status(500).json({ error: "Failed to notify" });
  }
});

router.post("/live-tests/:id/start", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const [lt] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, id)).limit(1);
    if (!lt) { res.status(404).json({ error: "Not found" }); return; }
    if (lt.status === "completed") { res.status(400).json({ error: "Already completed" }); return; }
    if (lt.status === "live") { res.status(400).json({ error: "Already live" }); return; }
    // Force to announced so startLiveTest proceeds
    await db.update(liveTestsTable).set({ status: "announced" }).where(eq(liveTestsTable.id, id));
    const { startLiveTest } = await import("../bot/handlers/live-test.js");
    startLiveTest(id).catch(err => logger.error({ err }, "Start error"));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Start live test error");
    res.status(500).json({ error: "Failed to start" });
  }
});

router.post("/live-tests/:id/stop", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const [lt] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, id)).limit(1);
    if (!lt) { res.status(404).json({ error: "Not found" }); return; }
    const { stopLiveTestSession } = await import("../bot/handlers/live-test.js");
    const stoppedSession = stopLiveTestSession(id);
    await db.update(liveTestsTable).set({ status: "completed", currentPollId: null }).where(eq(liveTestsTable.id, id));
    const participantIds: number[] = Array.isArray(lt.participants) ? lt.participants as number[] : [];
    const api = getApi();
    let notified = 0;
    for (const userId of participantIds) {
      try {
        await api.sendMessage(userId,
          `🏁 *Live Test Ended*\n\n_${lt.title}_ has been stopped by admin\\. Thank you for participating\\!`,
          { parse_mode: "MarkdownV2" }
        );
        notified++;
        await new Promise(r => setTimeout(r, 50));
      } catch { }
    }
    res.json({ ok: true, notified, pollStopped: stoppedSession });
  } catch (err) {
    logger.error({ err }, "Stop live test error");
    res.status(500).json({ error: "Failed to stop" });
  }
});

router.post("/live-tests/:id/message", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const { message } = req.body as { message: string };
    if (!message?.trim()) { res.status(400).json({ error: "Message required" }); return; }
    const [lt] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, id)).limit(1);
    if (!lt) { res.status(404).json({ error: "Not found" }); return; }
    const participantIds: number[] = Array.isArray(lt.participants) ? lt.participants as number[] : [];
    const api = getApi();
    let sent = 0;
    for (const userId of participantIds) {
      try {
        await api.sendMessage(userId, `📢 *${lt.title}*\n\n${message}`, { parse_mode: "Markdown" });
        sent++;
        await new Promise(r => setTimeout(r, 50));
      } catch { }
    }
    res.json({ ok: true, sent });
  } catch (err) {
    logger.error({ err }, "Message participants error");
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ── AI SETTINGS ───────────────────────────────────────────────────────────────
router.get("/ai-settings", requireAuth, async (_req: Request, res: Response) => {
  try {
    const aiEnabled = await getConfig("ai_enabled");
    const doubtPrompt = await getConfig("doubt_prompt");
    const aiInfoPrompt = await getConfig("ai_info_prompt");
    res.json({
      aiEnabled: aiEnabled !== "false",
      doubtPrompt: doubtPrompt ?? "",
      aiInfoPrompt: aiInfoPrompt ?? "",
    });
  } catch (err) {
    logger.error({ err }, "AI settings GET error");
    res.status(500).json({ error: "Failed to load AI settings" });
  }
});

router.post("/ai-settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const { aiEnabled, doubtPrompt, aiInfoPrompt } = req.body as {
      aiEnabled: boolean; doubtPrompt: string; aiInfoPrompt: string;
    };
    await setConfig("ai_enabled", String(aiEnabled));
    if (doubtPrompt !== undefined) await setConfig("doubt_prompt", doubtPrompt);
    if (aiInfoPrompt !== undefined) await setConfig("ai_info_prompt", aiInfoPrompt);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "AI settings POST error");
    res.status(500).json({ error: "Failed to save AI settings" });
  }
});

// ── COUPON CODES ─────────────────────────────────────────────────────────────
router.get("/coupons", requireAuth, async (_req: Request, res: Response) => {
  try {
    const coupons = await db.select().from(couponCodesTable).orderBy(couponCodesTable.id);
    res.json(coupons);
  } catch (err) {
    logger.error({ err }, "Coupons GET error");
    res.status(500).json({ error: "Failed to load coupons" });
  }
});

router.post("/coupons", requireAuth, async (req: Request, res: Response) => {
  try {
    const { code, discountInr, discountStars, discountPct, usageLimit, expiresAt } = req.body as {
      code: string; discountInr: number; discountStars: number;
      discountPct: number; usageLimit: number; expiresAt?: string;
    };
    if (!code?.trim()) { res.status(400).json({ error: "Coupon code is required" }); return; }
    const [coupon] = await db.insert(couponCodesTable).values({
      code: code.toUpperCase().trim(),
      discountInr: discountInr ?? 0,
      discountStars: discountStars ?? 0,
      discountPct: discountPct ?? 0,
      usageLimit: usageLimit ?? 100,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    }).returning();
    res.json(coupon);
  } catch (err: any) {
    logger.error({ err }, "Coupon create error");
    if (err.code === "23505") {
      res.status(409).json({ error: "Coupon code already exists" });
    } else {
      res.status(500).json({ error: "Failed to create coupon" });
    }
  }
});

router.post("/coupons/:id/toggle", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const { isActive } = req.body as { isActive: boolean };
    await db.update(couponCodesTable).set({ isActive }).where(eq(couponCodesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Coupon toggle error");
    res.status(500).json({ error: "Failed to toggle coupon" });
  }
});

router.delete("/coupons/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.delete(couponCodesTable).where(eq(couponCodesTable.id, Number(req.params["id"])));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Coupon delete error");
    res.status(500).json({ error: "Failed to delete coupon" });
  }
});

// ── EXPORT CSV ───────────────────────────────────────────────────────────────
router.get("/export/users", requireAuth, async (_req: Request, res: Response) => {
  try {
    const users = await db.select().from(usersTable).orderBy(usersTable.joinedAt);
    const header = "id,userId,fullName,username,tier,targetExamMain,targetExamSub,totalTestsTaken,referralCount,joinedAt\n";
    const rows = users.map((u) =>
      [u.id, u.userId, `"${u.fullName.replace(/"/g, '""')}"`, u.username ?? "", u.tier,
       u.targetExamMain ?? "", u.targetExamSub ?? "", u.totalTestsTaken, u.referralCount,
       u.joinedAt.toISOString()].join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=users.csv");
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to export users" });
  }
});

router.get("/export/payments", requireAuth, async (_req: Request, res: Response) => {
  try {
    const payments = await db.select().from(paymentsTable).orderBy(desc(paymentsTable.submittedAt));
    const header = "id,paymentId,userId,method,amount,testId,status,submittedAt\n";
    const rows = payments.map((p) =>
      [p.id, p.paymentId, p.userId, p.method, p.amount, p.testId ?? "", p.status,
       p.submittedAt.toISOString()].join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=payments.csv");
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to export payments" });
  }
});

router.get("/export/analytics", requireAuth, async (_req: Request, res: Response) => {
  try {
    const history = await db.select().from(userHistoryTable).orderBy(desc(userHistoryTable.completedAt)).limit(5000);
    const header = "id,userId,testId,score,maxScore,correctCount,wrongCount,skippedCount,accuracy,completedAt\n";
    const rows = history.map((h) =>
      [h.id, h.userId, h.testId, h.score, h.maxScore, h.correctCount, h.wrongCount,
       h.skippedCount, h.accuracy.toFixed(2), h.completedAt.toISOString()].join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=analytics.csv");
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to export analytics" });
  }
});

// ── ACHIEVEMENTS ─────────────────────────────────────────────────────────────
router.get("/achievements", requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(achievementsTable).orderBy(desc(achievementsTable.awardedAt)).limit(200);
    res.json(rows.map((r) => ({ ...r, awardedAt: r.awardedAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: "Failed to load achievements" });
  }
});

// ── EXPORT ALL (JSON full backup) ──────────────────────────────────────────
router.get("/export/all", requireAuth, async (_req: Request, res: Response) => {
  try {
    const [users, tests, payments, history, achievements, configs] = await Promise.all([
      db.select().from(usersTable),
      db.select().from(testSeriesTable),
      db.select().from(paymentsTable),
      db.select().from(userHistoryTable).limit(20000),
      db.select().from(achievementsTable),
      db.select().from(globalConfigTable),
    ]);

    const data = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      users,
      tests,
      payments,
      history,
      achievements,
      configs,
    };

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=series-testpro-backup-${date}.json`);
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Export all failed");
    res.status(500).json({ error: "Failed to export data" });
  }
});

// ── IMPORT ALL (JSON restore) ───────────────────────────────────────────────
router.post("/import/all", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = req.body as {
      version?: string;
      configs?: Array<{ key: string; value: string }>;
      users?: Array<Record<string, unknown>>;
      tests?: Array<Record<string, unknown>>;
      payments?: Array<Record<string, unknown>>;
      achievements?: Array<Record<string, unknown>>;
    };

    let imported = { configs: 0, users: 0, tests: 0, payments: 0, achievements: 0 };

    if (data.configs?.length) {
      for (const cfg of data.configs) {
        await db.insert(globalConfigTable).values({ key: cfg.key, value: cfg.value })
          .onConflictDoUpdate({ target: globalConfigTable.key, set: { value: cfg.value } })
          .catch(() => {});
      }
      imported.configs = data.configs.length;
    }

    if (data.users?.length) {
      for (const u of data.users) {
        const { id: _id, joinedAt, premiumExpiry, ...rest } = u as any;
        await db.insert(usersTable).values({
          ...rest,
          joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
          premiumExpiry: premiumExpiry ? new Date(premiumExpiry) : null,
        }).onConflictDoNothing().catch(() => {});
      }
      imported.users = data.users.length;
    }

    if (data.tests?.length) {
      for (const t of data.tests) {
        const { id: _id, createdAt, updatedAt, ...rest } = t as any;
        await db.insert(testSeriesTable).values({
          ...rest,
          createdAt: createdAt ? new Date(createdAt) : new Date(),
          updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
        }).onConflictDoNothing().catch(() => {});
      }
      imported.tests = data.tests.length;
    }

    if (data.payments?.length) {
      for (const p of data.payments) {
        const { id: _id, submittedAt, ...rest } = p as any;
        await db.insert(paymentsTable).values({
          ...rest,
          submittedAt: submittedAt ? new Date(submittedAt) : new Date(),
        }).onConflictDoNothing().catch(() => {});
      }
      imported.payments = data.payments.length;
    }

    if (data.achievements?.length) {
      for (const a of data.achievements) {
        const { id: _id, awardedAt, ...rest } = a as any;
        await db.insert(achievementsTable).values({
          ...rest,
          awardedAt: awardedAt ? new Date(awardedAt) : new Date(),
        }).onConflictDoNothing().catch(() => {});
      }
      imported.achievements = data.achievements.length;
    }

    emitTelemetry(`Data import completed: ${JSON.stringify(imported)}`);
    res.json({ success: true, imported });
  } catch (err) {
    logger.error({ err }, "Import all failed");
    res.status(500).json({ error: "Failed to import data" });
  }
});

// ── CUSTOM TEST SETS ───────────────────────────────────────────────────────────
router.get("/custom-sets", requireAuth, async (_req: Request, res: Response) => {
  try {
    const sets = await db
      .select({
        id: userCustomSetsTable.id,
        userId: userCustomSetsTable.userId,
        title: userCustomSetsTable.title,
        language: userCustomSetsTable.language,
        questionCount: userCustomSetsTable.questionCount,
        status: userCustomSetsTable.status,
        shareToken: userCustomSetsTable.shareToken,
        failReason: userCustomSetsTable.failReason,
        sourceFileName: userCustomSetsTable.sourceFileName,
        isActive: userCustomSetsTable.isActive,
        createdAt: userCustomSetsTable.createdAt,
        completedAt: userCustomSetsTable.completedAt,
        questionsData: userCustomSetsTable.questionsData,
        priceInr: userCustomSetsTable.priceInr,
        priceInStars: userCustomSetsTable.priceInStars,
        timerSeconds: userCustomSetsTable.timerSeconds,
        positiveMarking: userCustomSetsTable.positiveMarking,
        negativeMarking: userCustomSetsTable.negativeMarking,
        fullName: usersTable.fullName,
        username: usersTable.username,
      })
      .from(userCustomSetsTable)
      .leftJoin(usersTable, eq(userCustomSetsTable.userId, usersTable.userId))
      .orderBy(desc(userCustomSetsTable.createdAt))
      .limit(200);
    res.json(sets.map((set) => ({
      ...set,
      createdAt: set.createdAt.toISOString(),
      completedAt: set.completedAt?.toISOString() ?? null,
    })));
  } catch (err) {
    logger.error({ err }, "admin custom-sets list failed");
    res.status(500).json({ error: "Failed to list custom sets" });
  }
});

router.put("/custom-sets/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid custom set id" }); return; }
    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim().slice(0, 100);
    if (body.language === "en" || body.language === "hi") updates.language = body.language;
    for (const key of ["priceInr", "priceInStars", "timerSeconds", "positiveMarking", "negativeMarking"]) {
      if (body[key] !== undefined) {
        const value = Number(body[key]);
        if (!Number.isFinite(value) || value < 0) { res.status(400).json({ error: `Invalid ${key}` }); return; }
        updates[key] = value;
      }
    }
    if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
    if (!Object.keys(updates).length) { res.status(400).json({ error: "No editable fields supplied" }); return; }
    const [updated] = await db.update(userCustomSetsTable).set(updates).where(eq(userCustomSetsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Custom set not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "admin custom-set update failed");
    res.status(500).json({ error: "Failed to update custom set" });
  }
});

router.get("/custom-sets/:id/analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params["id"]);
    const [set] = await db.select().from(userCustomSetsTable).where(eq(userCustomSetsTable.id, id)).limit(1);
    if (!set) { res.status(404).json({ error: "Custom set not found" }); return; }
    const history = await db.select().from(userHistoryTable).where(eq(userHistoryTable.testId, `custom_${id}`));
    const totalAttempts = history.length;
    const avgScore = totalAttempts ? history.reduce((sum, row) => sum + row.score, 0) / totalAttempts : 0;
    const avgAccuracy = totalAttempts ? history.reduce((sum, row) => sum + row.accuracy, 0) / totalAttempts : 0;
    const bestScore = totalAttempts ? Math.max(...history.map((row) => row.score)) : 0;
    const maxPossible = set.questionCount * Number(set.positiveMarking);
    const buckets = [0, 0, 0, 0, 0];
    for (const row of history) {
      const bucket = Math.min(4, Math.max(0, Math.floor(((maxPossible ? row.score / maxPossible : 0) * 100) / 20)));
      buckets[bucket]++;
    }
    const userBest = new Map<number, number>();
    for (const row of history) userBest.set(row.userId, Math.max(userBest.get(row.userId) ?? -Infinity, row.score));
    const topScorers = await Promise.all([...userBest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(async ([userId, score]) => {
      const [user] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
      return { userId, score, name: user?.fullName ?? String(userId) };
    }));
    const questions = Array.isArray(set.questionsData) ? set.questionsData as QuestionData[] : [];
    const questionAnalytics = addQuestionDiscrimination(buildQuestionAnalytics(questions, history), history);
    res.json({
      setId: id, testId: `custom_${id}`, testName: set.title, totalAttempts,
      avgScore: Number(avgScore.toFixed(2)), avgAccuracy: Number(avgAccuracy.toFixed(1)), bestScore, topScorers,
      scoreDistribution: ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"].map((range, index) => ({ range, count: buckets[index] })),
      questions: questionAnalytics,
      insights: {
        questionsTracked: questionAnalytics.filter((q) => q.answered > 0).length,
        averageQuestionAccuracy: questionAnalytics.length ? Number((questionAnalytics.reduce((sum, q) => sum + q.accuracy, 0) / questionAnalytics.length).toFixed(1)) : 0,
        highSkipQuestions: questionAnalytics.filter((q) => q.skipRate >= 25).length,
        hardQuestions: questionAnalytics.filter((q) => q.difficulty === "Hard" || q.difficulty === "Very hard").length,
      },
    });
  } catch (err) {
    logger.error({ err }, "custom-set analytics failed");
    res.status(500).json({ error: "Failed to load custom set analytics" });
  }
});

router.delete("/custom-sets/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const idParam = req.params["id"];
    const id = parseInt(Array.isArray(idParam) ? idParam[0]! : idParam!, 10);
    await db.update(userCustomSetsTable).set({ isActive: false }).where(eq(userCustomSetsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "admin custom-set delete failed");
    res.status(500).json({ error: "Failed to delete custom set" });
  }
});

export default router;
