import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { testSeriesTable, userHistoryTable, usersTable } from "@workspace/db";
import { askOpenRouter, BOT_HELP_CONTEXT } from "./ai.js";
import { getApi } from "./api-instance.js";
import { clearAgenticSession, getSession, updateSession } from "./session.js";
import { logger } from "../lib/logger.js";

type QuestionAnalysis = { question: string; topics: string[]; skills: string[]; difficulty: string; focus: string };
type SetAnalysis = { topics: string[]; skills: string[]; difficulty: string; focus: string; questions: QuestionAnalysis[] };
const setAnalysisCache = new Map<string, { analysis: SetAnalysis; updatedAt: number }>();
let analysisRunning = false;

export function agenticRoomKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📈 My Insights", "agentic_insights").text("🎯 Study Plan", "agentic_plan").row()
    .text("🧠 Analyze a Topic", "agentic_topic").text("📝 Make Practice Set", "agentic_practice").row()
    .text("🧹 Clear Chat", "agentic_clear").text("🏠 Back Home", "agentic_back");
}

export function agenticRoomText(): string {
  return "🧠 Agentic AI Workspace\n\nYour always-on exam strategist is ready.\n\nAsk anything, or use the tools below. I can explain concepts, find weak areas, build a study plan, generate practice, and guide your next attempt.";
}

export async function openAgenticWorkspace(ctx: any): Promise<void> {
  const currentMessageId = ctx.callbackQuery?.message?.message_id;
  updateSession(ctx.from.id, { agenticActive: true, agenticMessageIds: currentMessageId ? [currentMessageId] : [] });
  try {
    await ctx.editMessageText(agenticRoomText(), { reply_markup: agenticRoomKeyboard() });
  } catch {
    const sent = await ctx.reply(agenticRoomText(), { reply_markup: agenticRoomKeyboard() });
    updateSession(ctx.from.id, { agenticMessageIds: [sent.message_id] });
  }
}

async function deleteTrackedAgenticMessages(userId: number, keepMessageId?: number): Promise<void> {
  const session = getSession(userId);
  const ids = session.agenticMessageIds ?? [];
  for (const id of ids) {
    if (id === keepMessageId) continue;
    try { await getApi().deleteMessage(userId, id); } catch {}
  }
  updateSession(userId, { agenticMessageIds: keepMessageId ? [keepMessageId] : [] });
}

export async function closeAgenticWorkspace(ctx: any, goHome: () => Promise<void>): Promise<void> {
  await deleteTrackedAgenticMessages(ctx.from.id, ctx.callbackQuery?.message?.message_id);
  clearAgenticSession(ctx.from.id);
  await goHome();
}

export async function clearAgenticChat(userId: number, keepMessageId?: number): Promise<void> {
  await deleteTrackedAgenticMessages(userId, keepMessageId);
  updateSession(userId, { agenticActive: true, agenticMessageIds: keepMessageId ? [keepMessageId] : [] });
}

export function registerAgenticHandlers(bot: Bot): void {
  bot.callbackQuery("agentic_open", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openAgenticWorkspace(ctx);
  });

  bot.callbackQuery("agentic_back", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { showHomeForUser } = await import("./handlers/navigation.js");
    await closeAgenticWorkspace(ctx, () => showHomeForUser(ctx));
  });

  bot.callbackQuery("agentic_clear", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Agentic chat cleared" });
    await clearAgenticChat(ctx.from.id, ctx.callbackQuery.message?.message_id);
    await ctx.editMessageText(agenticRoomText(), { reply_markup: agenticRoomKeyboard() });
  });

  bot.callbackQuery("agentic_insights", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Building your insights…" });
    await sendAgenticToolResult(ctx, "Personal Insights", "Give me a concise personal dashboard: my weak areas, strong areas, recent trend, and the best next 3 actions.");
  });

  bot.callbackQuery("agentic_plan", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Creating your plan…" });
    await sendAgenticToolResult(ctx, "Your Study Plan", "Create a practical 7-day personalized study plan based on my weak topics, strong topics, target exam, and recent performance.");
  });

  bot.callbackQuery("agentic_topic", async (ctx) => {
    await ctx.answerCallbackQuery();
    const message = await ctx.reply("🧠 Send the topic you want me to analyze next.", { reply_markup: new InlineKeyboard().text("⬅️ Back to Agentic AI", "agentic_open") });
    trackMessage(ctx.from.id, message.message_id);
  });

  bot.callbackQuery("agentic_practice", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Designing practice…" });
    await sendAgenticToolResult(ctx, "Personal Practice Set", "Create a 5-question practice set focused on my weakest areas. Include options, answers, and short explanations.");
  });

  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    const session = getSession(userId);
    if (!session.agenticActive || text.startsWith("/")) return next();

    trackMessage(userId, ctx.message.message_id);
    const thinking = await ctx.reply("🧠 Agentic AI is thinking through your request…");
    trackMessage(userId, thinking.message_id);
    try {
      const answer = await answerAgenticMessage(userId, text);
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `🧠 Agentic AI\n\n${answer}`, {
        reply_markup: agenticRoomKeyboard(),
      });
    } catch (error) {
      logger.error({ error, userId }, "Agentic AI response failed");
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "⚠️ I could not complete that request right now. Please try again.", {
        reply_markup: agenticRoomKeyboard(),
      });
    }
  });
}

function trackMessage(userId: number, messageId: number): void {
  const session = getSession(userId);
  const ids = session.agenticMessageIds ?? [];
  if (!ids.includes(messageId)) updateSession(userId, { agenticMessageIds: [...ids, messageId] });
}

async function sendAgenticToolResult(ctx: any, title: string, request: string): Promise<void> {
  const thinking = await ctx.reply(`🧠 ${title} is being prepared…`);
  trackMessage(ctx.from.id, thinking.message_id);
  try {
    const answer = await answerAgenticMessage(ctx.from.id, request);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `🧠 ${title}\n\n${answer}`, {
      reply_markup: agenticRoomKeyboard(),
    });
  } catch (error) {
    logger.error({ error }, "Agentic tool failed");
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "⚠️ Agentic analysis is temporarily unavailable.", {
      reply_markup: agenticRoomKeyboard(),
    });
  }
}

async function getUserInsights(userId: number): Promise<string> {
  const [user] = await db.select({
    fullName: usersTable.fullName, tier: usersTable.tier, targetExamSub: usersTable.targetExamSub,
  }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
  const attempts = await db.select({
    testId: userHistoryTable.testId, score: userHistoryTable.score, accuracy: userHistoryTable.accuracy,
    correctCount: userHistoryTable.correctCount, wrongCount: userHistoryTable.wrongCount,
    userAnswers: userHistoryTable.userAnswers,
  }).from(userHistoryTable).where(eq(userHistoryTable.userId, userId)).orderBy(desc(userHistoryTable.completedAt)).limit(20);

  const performance = attempts.length
    ? attempts.map((a) => `${a.testId}: ${a.accuracy}% accuracy, ${a.correctCount} correct, ${a.wrongCount} wrong`).join("; ")
    : "No completed attempts yet";
  const weak = attempts.length
    ? attempts.filter((a) => a.accuracy < 60).map((a) => a.testId).slice(0, 5).join(", ")
    : "Not enough data yet";
  const strong = attempts.length
    ? attempts.filter((a) => a.accuracy >= 80).map((a) => a.testId).slice(0, 5).join(", ")
    : "Not enough data yet";
  return `Student: ${user?.fullName ?? "Student"} | Plan: ${user?.tier ?? "Free"} | Target: ${user?.targetExamSub ?? "Not set"}\nAttempts: ${performance}\nLikely weak sets: ${weak}\nStrong sets: ${strong}`;
}

export async function answerAgenticMessage(userId: number, text: string): Promise<string> {
  const insights = await getUserInsights(userId);
  const cached = [...setAnalysisCache.entries()].slice(0, 12)
    .map(([id, value]) => `${id}: topics=${value.analysis.topics.join(",")}; focus=${value.analysis.focus}; question intelligence=${value.analysis.questions.length} questions`).join("\n");
  return askOpenRouter([
    { role: "system", content: `${BOT_HELP_CONTEXT}
You are the always-on Agentic AI strategist inside Series TestPro. You can act as a tutor, performance analyst, study planner, practice-set designer, revision coach, and exam accountability partner.
Use the student's real context below. Be personal and actionable. If asked to do work, do it directly in the response. Never claim an action happened if it did not. Keep responses under 350 words, plain text, readable in Telegram.
Student context:
${insights}
Background question intelligence:
${cached || "Still building the question intelligence index."}` },
    { role: "user", content: text.slice(0, 5000) },
  ], { maxTokens: 8192, temperature: 0.4 });
}

export async function agenticInsights(userId: number): Promise<string> {
  return answerAgenticMessage(userId, "Give me a concise personal dashboard: my weak areas, strong areas, recent trend, and the best next 3 actions.");
}

async function analyzeTestSet(test: { testId: string; testName: string; questionsData: unknown }): Promise<void> {
  const questions = Array.isArray(test.questionsData) ? test.questionsData : [];
  if (!questions.length) return;
  const prompt = questions.map((q: any, i) => `Q${i + 1}: ${q.question}\nOptions: ${(q.options ?? []).join(" | ")}\nExplanation: ${q.explanation ?? ""}`).join("\n\n");
  const raw = await askOpenRouter([
    { role: "system", content: `Extract exam intelligence for the complete question set. Return JSON with:
topics (array max 8), skills (array max 8), difficulty (easy/medium/hard), focus (one sentence),
questions (one object for EVERY input question, in the same order, with question (short label), topics (array max 3), skills (array max 3), difficulty, focus).
Do not solve questions and do not omit any question.` },
    { role: "user", content: `Test: ${test.testName}\n${prompt}` },
  ], { json: true, maxTokens: 8192 });
  const parsed = JSON.parse(raw) as Partial<SetAnalysis>;
  const questionInsights = Array.isArray(parsed.questions) ? parsed.questions : [];
  setAnalysisCache.set(test.testId, {
    analysis: {
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 8).map(String) : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 8).map(String) : [],
      difficulty: String(parsed.difficulty ?? "medium"),
      focus: String(parsed.focus ?? "Mixed exam practice"),
      questions: questionInsights.map((item) => ({
        question: String(item.question ?? ""),
        topics: Array.isArray(item.topics) ? item.topics.slice(0, 3).map(String) : [],
        skills: Array.isArray(item.skills) ? item.skills.slice(0, 3).map(String) : [],
        difficulty: String(item.difficulty ?? "medium"),
        focus: String(item.focus ?? ""),
      })),
    },
    updatedAt: Date.now(),
  });
}

export async function runAgenticAnalysis(): Promise<void> {
  if (analysisRunning) return;
  analysisRunning = true;
  try {
    const tests = await db.select({ testId: testSeriesTable.testId, testName: testSeriesTable.testName, questionsData: testSeriesTable.questionsData })
      .from(testSeriesTable).where(eq(testSeriesTable.isActive, true));
    for (const test of tests) {
      const cached = setAnalysisCache.get(test.testId);
      if (cached && Date.now() - cached.updatedAt < 6 * 60 * 60 * 1000) continue;
      try { await analyzeTestSet(test); } catch (error) { logger.warn({ error, testId: test.testId }, "Agentic set analysis failed"); }
    }
  } finally {
    analysisRunning = false;
  }
}

export function startAgenticAnalysisScheduler(): void {
  logger.info("Agentic AI 24/7 analysis scheduler started");
  void runAgenticAnalysis()
    .then(() => logger.info("Agentic AI initial question analysis completed"))
    .catch((error) => logger.warn({ error }, "Initial agentic analysis failed"));
  setInterval(() => void runAgenticAnalysis()
    .then(() => logger.info("Agentic AI question analysis cycle completed"))
    .catch((error) => logger.warn({ error }, "Agentic analysis cycle failed")), 15 * 60 * 1000);
}

export { deleteTrackedAgenticMessages };