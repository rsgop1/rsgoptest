import { Router, type Request, type Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, reportsTable, testSeriesTable, userHistoryTable, usersTable } from "@workspace/db";
import type { QuestionData } from "@workspace/db";
import { createHmac, timingSafeEqual } from "crypto";
import { getApi } from "../bot/api-instance.js";
import { scorecardKeyboard } from "../bot/keyboards.js";
import { askOpenRouter, BOT_HELP_CONTEXT } from "../bot/ai.js";
import { logger } from "../lib/logger.js";
import { updateSession } from "../bot/session.js";

const router = Router();
const WEB_TOKEN_SECRET = process.env["SESSION_SECRET"] ?? "fallback-secret-change-me";
const TOKEN_TTL_SECONDS = 6 * 60 * 60;

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
    webTimerSeconds: test.webTimerSeconds,
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
    const sectionSkipped = sectionAnswers.length - sectionAttempted;
    return {
      name,
      attempted: sectionAttempted,
      correct: sectionCorrect,
      incorrect: sectionIncorrect,
      skipped: sectionSkipped,
      score: sectionCorrect * test.positiveMarking - sectionIncorrect * test.negativeMarking,
      percentage: sectionAttempted ? Number(((sectionCorrect / sectionAttempted) * 100).toFixed(1)) : 0,
    };
  });
  const review = questions.map((question, index) => {
    const selectedOption = answerArray[index] ?? null;
    return {
      id: question.id,
      question: question.question,
      options: question.options,
      section: question.section,
      imageUrl: question.imageUrl ?? null,
      selectedOption,
      correctOptionIndex: question.correctOptionIndex,
      explanation: question.explanation || "No detailed explanation has been added for this question yet.",
      status: selectedOption === null ? "skipped" : selectedOption === question.correctOptionIndex ? "correct" : "incorrect",
    };
  });
  const orderedSections = [...sections].sort((a, b) => b.percentage - a.percentage);
  const strengths = orderedSections.filter((section) => section.attempted > 0 && section.percentage >= 70).slice(0, 3).map((section) => section.name);
  const focusAreas = orderedSections.filter((section) => section.attempted > 0 && section.percentage < 60).slice(0, 3).map((section) => section.name);
  const recommendation = focusAreas.length
    ? `Revise ${focusAreas.join(", ")} first, then retake this paper with a tighter skip strategy.`
    : "Your fundamentals look steady. Review the marked questions and take the next paper under the same time pressure.";
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
  updateSession(parsed.userId, {
    solution: {
      testId: parsed.testId,
      testName: test.testName,
      questions,
      userAnswers: answerArray,
      currentIndex: 0,
      attemptId: history.id,
    },
  });
  let telegramSynced = false;
  try {
    const telegramText =
      `Testbook+ result\n\n` +
      `${test.testName}\n` +
      `Score: ${score}/${maxScore}\n` +
      `Correct: ${correct}  Wrong: ${incorrect}  Skipped: ${skipped}\n` +
      `Accuracy: ${accuracy.toFixed(1)}%\n\n` +
      `Your detailed solutions and analysis are available in the web app.`;
    await getApi().sendMessage(parsed.userId, telegramText, { reply_markup: scorecardKeyboard(parsed.testId) });
    telegramSynced = true;
  } catch (error) {
    logger.warn({ error, userId: parsed.userId, testId: parsed.testId }, "Could not sync web result to Telegram");
  }
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
    timeSpentSeconds: Math.max(0, Number(body.timeSpentSeconds ?? 0)),
    markedForReview: Array.isArray(body.markedForReview) ? body.markedForReview : [],
    telegramSynced,
    sections,
    review,
    strengths,
    focusAreas,
    recommendation,
  });
});

router.post("/reports", async (req: Request, res: Response) => {
  const body = req.body as { token?: string; testId?: string; questionId?: string; reportText?: string };
  const parsed = typeof body.token === "string" ? verifyLearnerToken(body.token) : null;
  if (!parsed || parsed.testId !== body.testId) return res.status(401).json({ error: "Invalid or expired web session" });
  const user = await getPremiumUser(parsed.userId);
  if (!user) return res.status(401).json({ error: "An active Premium plan is required" });
  const reportText = String(body.reportText ?? "").trim();
  if (reportText.length < 3 || reportText.length > 1000) return res.status(400).json({ error: "Report must be between 3 and 1000 characters" });
  const [test] = await db.select({ questionsData: testSeriesTable.questionsData }).from(testSeriesTable).where(eq(testSeriesTable.testId, parsed.testId)).limit(1);
  const questions = normalizedQuestions(test?.questionsData);
  const questionIndex = questions.findIndex((question) => question.id === body.questionId);
  if (!test || questionIndex < 0) return res.status(404).json({ error: "Question not found" });
  const question = questions[questionIndex]!;
  await db.insert(reportsTable).values({
    userId: parsed.userId,
    testId: parsed.testId,
    questionIndex,
    questionText: question.question,
    userAnswer: null,
    correctAnswer: question.correctOptionIndex,
    reportText,
  });
  return res.status(201).json({ success: true, message: "Question report submitted to the faculty team." });
});

router.post("/ai-info", async (req: Request, res: Response) => {
  const body = req.body as { token?: string; testId?: string; questionId?: string };
  const parsed = typeof body.token === "string" ? verifyLearnerToken(body.token) : null;
  if (!parsed || parsed.testId !== body.testId) return res.status(401).json({ error: "Invalid or expired web session" });
  const user = await getPremiumUser(parsed.userId);
  if (!user) return res.status(401).json({ error: "An active Premium plan is required" });
  const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, parsed.testId)).limit(1);
  const question = normalizedQuestions(test?.questionsData).find((item) => item.id === body.questionId);
  if (!test || !question) return res.status(404).json({ error: "Question not found" });
  try {
    const answer = await askOpenRouter([
      { role: "system", content: `${BOT_HELP_CONTEXT}\nYou are a concise exam tutor. Use plain text, no markdown symbols.` },
      { role: "user", content: `Test: ${test.testName}\nQuestion: ${question.question}\nOptions: ${question.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join(" | ")}\nCorrect answer: ${question.options[question.correctOptionIndex]}\nExisting explanation: ${question.explanation || "None"}\nExplain the answer in 3 short paragraphs and add one exam tip. Keep it under 180 words.` },
    ], { maxTokens: 700 });
    return res.json({ questionId: question.id, answer });
  } catch (error) {
    logger.warn({ error, testId: parsed.testId, questionId: question.id }, "Learner AI info failed");
    return res.status(503).json({ error: "AI tutor is temporarily unavailable" });
  }
});

export default router;