import { Router, type Request, type Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, testSeriesTable, userHistoryTable, usersTable } from "@workspace/db";
import type { QuestionData } from "@workspace/db";
import { createHmac, timingSafeEqual } from "crypto";

const router = Router();
const WEB_TOKEN_SECRET = process.env["SESSION_SECRET"] ?? "fallback-secret-change-me";
const TOKEN_TTL_SECONDS = 15 * 60;

function encode(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function signature(value: string): string {
  return createHmac("sha256", WEB_TOKEN_SECRET).update(value).digest("base64url");
}

export function createLearnerWebToken(userId: number, testId: string): string {
  const payload = encode({ userId, testId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS });
  return `${payload}.${signature(payload)}`;
}

type LearnerToken = { userId: number; testId: string; exp: number };

function verifyLearnerToken(token: string): LearnerToken | null {
  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature) return null;
  const expected = signature(payload);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedSignature);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LearnerToken;
    if (!Number.isInteger(parsed.userId) || !parsed.testId || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function getPremiumUser(userId: number) {
  const [user] = await db.select({
    userId: usersTable.userId,
    fullName: usersTable.fullName,
    username: usersTable.username,
    tier: usersTable.tier,
    premiumExpiry: usersTable.premiumExpiry,
  }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
  if (!user || user.tier !== "Premium" || !user.premiumExpiry || user.premiumExpiry <= new Date()) return null;
  return user;
}

function normalizedQuestions(raw: unknown): Array<QuestionData & { section: string; imageUrl: string | null }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const question = item as Partial<QuestionData> & { section?: string; imageUrl?: string | null };
    return {
      id: String(question.id ?? `q${index + 1}`),
      question: String(question.question ?? ""),
      options: Array.isArray(question.options) ? question.options.map(String) : [],
      correctOptionIndex: Number(question.correctOptionIndex ?? 0),
      explanation: String(question.explanation ?? ""),
      language: question.language,
      section: String(question.section ?? "General"),
      imageUrl: question.imageUrl ?? null,
    };
  });
}

router.get("/web-session", async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const parsed = verifyLearnerToken(token);
  if (!parsed) return res.status(401).json({ error: "Invalid or expired web session" });
  const user = await getPremiumUser(parsed.userId);
  if (!user) return res.status(401).json({ error: "An active Premium plan is required" });
  return res.json({ ...user, premiumExpiry: user.premiumExpiry?.toISOString() ?? null });
});

router.get("/test", async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const testId = typeof req.query.testId === "string" ? req.query.testId : "";
  const parsed = verifyLearnerToken(token);
  if (!parsed || parsed.testId !== testId) return res.status(401).json({ error: "Invalid or expired web session" });
  const user = await getPremiumUser(parsed.userId);
  if (!user) return res.status(401).json({ error: "An active Premium plan is required" });
  const [test] = await db.select().from(testSeriesTable).where(and(eq(testSeriesTable.testId, testId), eq(testSeriesTable.isActive, true))).limit(1);
  if (!test) return res.status(404).json({ error: "Test not found" });
  const questions = normalizedQuestions(test.questionsData);
  return res.json({
    testId: test.testId,
    testName: test.testName,
    mainCategory: test.mainCategory,
    subCategory: test.subCategory,
    positiveMarking: test.positiveMarking,
    negativeMarking: test.negativeMarking,
    timerSeconds: test.timerSeconds,
    questionCount: questions.length,
    sections: [...new Set(questions.map((question) => question.section))],
    questions: questions.map(({ id, question, options, section, imageUrl }) => ({ id, question, options, section, imageUrl })),
  });
});

router.post("/attempts", async (req: Request, res: Response) => {
  const body = req.body as {
    token?: string;
    testId?: string;
    answers?: Record<string, number>;
    markedForReview?: string[];
    timeSpentSeconds?: number;
  };
  const parsed = typeof body.token === "string" ? verifyLearnerToken(body.token) : null;
  if (!parsed || parsed.testId !== body.testId) return res.status(401).json({ error: "Invalid or expired web session" });
  const user = await getPremiumUser(parsed.userId);
  if (!user) return res.status(401).json({ error: "An active Premium plan is required" });
  const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, parsed.testId)).limit(1);
  if (!test) return res.status(404).json({ error: "Test not found" });
  const questions = normalizedQuestions(test.questionsData);
  const answers = body.answers ?? {};
  const answerArray = questions.map((question) => Number.isInteger(answers[question.id]) ? answers[question.id]! : null);
  const attempted = answerArray.filter((answer): answer is number => answer !== null).length;
  const correct = Number(answerArray.reduce<number>((total, answer, index) => total + (answer !== null && answer === questions[index]?.correctOptionIndex ? 1 : 0), 0) ?? 0);
  const incorrect = attempted - correct;
  const skipped = questions.length - attempted;
  const score = correct * test.positiveMarking - incorrect * test.negativeMarking;
  const maxScore = questions.length * test.positiveMarking;
  const accuracy = attempted ? (correct / attempted) * 100 : 0;
  const sectionNames = [...new Set(questions.map((question) => question.section))];
  const sections = sectionNames.map((name) => {
    const indexes = questions.map((question, index) => question.section === name ? index : -1).filter((index) => index >= 0);
    const sectionAnswers = indexes.map((index) => answerArray[index]);
    const sectionAttempted = sectionAnswers.filter((answer): answer is number => answer !== null).length;
    const sectionCorrect = Number(sectionAnswers.reduce<number>((total, answer, index) => total + (answer !== null && answer === questions[indexes[index]]?.correctOptionIndex ? 1 : 0), 0) ?? 0);
    const sectionIncorrect = sectionAttempted - sectionCorrect;
    return { name, attempted: sectionAttempted, correct: sectionCorrect, incorrect: sectionIncorrect, score: sectionCorrect * test.positiveMarking - sectionIncorrect * test.negativeMarking };
  });
  const [history] = await db.insert(userHistoryTable).values({
    userId: parsed.userId,
    testId: parsed.testId,
    score,
    maxScore,
    correctCount: correct,
    wrongCount: incorrect,
    skippedCount: skipped,
    accuracy,
    userAnswers: answerArray,
  }).returning({ id: userHistoryTable.id });
  return res.status(201).json({
    attemptId: history.id,
    testName: test.testName,
    totalQuestions: questions.length,
    attempted,
    correct,
    incorrect,
    skipped,
    score,
    maxScore,
    accuracy,
    rankPercentile: Math.min(99.9, Math.max(1, accuracy * 0.92)),
    sections,
  });
});

export default router;