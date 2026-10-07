import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { testSeriesTable, userHistoryTable, usersTable } from "@workspace/db";
import { askGemini, BOT_AGENT_CONTEXT } from "./ai.js";
import { getApi } from "./api-instance.js";
import { clearAgenticSession, getSession, updateSession } from "./session.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "./handlers/helpers.js";

type QuestionAnalysis = { question: string; topics: string[]; skills: string[]; difficulty: string; focus: string };
const TOPIC_TAGGING_VERSION = "gemini-canonical-topics-v1";
const DEFAULT_SUBJECTS: Record<string, string[]> = {
  Maths: ["Arithmetic", "Algebra", "Geometry", "Trigonometry", "Data Interpretation"],
  GK: ["History", "Polity", "Geography", "Economics", "General Science"],
  English: ["Grammar", "Vocabulary", "Reading Comprehension", "Cloze Test"],
  Reasoning: ["Verbal Reasoning", "Non-Verbal Reasoning", "Puzzles", "Analogy", "Series"],
  "Current Affairs": ["National", "International", "Economy", "Sports", "Science & Technology"],
  General: ["General"],
};
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TAG_REQUEST_MIN_INTERVAL_MS = 13_000;
let analysisRunning = false;
let lastRunAt: number | null = null;
let lastCompletedAt: number | null = null;
let lastError: string | null = null;
let lastRunStats = { sets: 0, questions: 0 };
let analysisQuotaBlockedUntil = 0;
let lastTagRequestAt = 0;

export function agenticRoomKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Analyze my tests", "agentic_insights");
}

export function agenticRoomText(): string {
  return "🤖 AI Space\n\nYour personal study agent is ready.\n\nIt can analyse your completed tests, explain weak topics, solve exam doubts, and help with any Series TestPro problem.\n\nTap Analyse to get a detailed performance report, or send a message.";
}

export async function openAgenticWorkspace(ctx: any): Promise<void> {
  const currentMessageId = ctx.callbackQuery?.message?.message_id;
  const [user] = await db.select({ tier: usersTable.tier, premiumExpiry: usersTable.premiumExpiry })
    .from(usersTable).where(eq(usersTable.userId, ctx.from.id)).limit(1);
  const premium = user?.tier === "Premium" && !!user.premiumExpiry && user.premiumExpiry > new Date();
  if (!premium) {
    await ctx.reply("🔒 AI Space is available for active Premium users. Use /premium to unlock your personal study agent.");
    return;
  }
  updateSession(ctx.from.id, { agenticActive: true, agenticMessageIds: currentMessageId ? [currentMessageId] : [] });
  refreshAgenticIdle(ctx.from.id);
  try {
    await ctx.editMessageText(agenticRoomText(), { reply_markup: agenticRoomKeyboard() });
  } catch {
    const sent = await ctx.reply(agenticRoomText(), { reply_markup: agenticRoomKeyboard() });
    updateSession(ctx.from.id, { agenticMessageIds: [sent.message_id] });
  }
}

function refreshAgenticIdle(userId: number): void {
  const current = getSession(userId);
  if (current.agenticIdleTimer) clearTimeout(current.agenticIdleTimer);
  const timer = setTimeout(async () => {
    const session = getSession(userId);
    if (!session.agenticActive) return;
    await deleteTrackedAgenticMessages(userId);
    clearAgenticSession(userId);
    logger.info({ userId }, "Agentic AI session expired after idle timeout");
  }, IDLE_TIMEOUT_MS);
  updateSession(userId, { agenticIdleTimer: timer });
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
    refreshAgenticIdle(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "Building your insights…" });
    await sendAgenticToolResult(ctx, "Personal Insights", "Give me a concise personal dashboard: my weak areas, strong areas, recent trend, and the best next 3 actions.");
  });

  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    const session = getSession(userId);
    if (!session.agenticActive || text.startsWith("/")) return next();

    refreshAgenticIdle(userId);
    trackMessage(userId, ctx.message.message_id);
    const thinking = await ctx.reply("🧠 Agentic AI is thinking through your request…");
    trackMessage(userId, thinking.message_id);
    try {
      const answer = await answerAgenticMessage(userId, text);
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, renderAgenticText(`🧠 Agentic AI\n\n${answer}`), {
        parse_mode: "HTML",
        reply_markup: agenticRoomKeyboard(),
      });
    } catch (error) {
      logger.error({ error, userId }, "Agentic AI response failed");
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "⚠️ I could not complete that request right now. Please try again.", {
        parse_mode: "HTML",
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
  refreshAgenticIdle(ctx.from.id);
  const thinking = await ctx.reply(`🧠 ${title} is being prepared…`);
  trackMessage(ctx.from.id, thinking.message_id);
  try {
    const answer = await answerAgenticMessage(ctx.from.id, request);
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, renderAgenticText(`🧠 ${title}\n\n${answer}`), {
      parse_mode: "HTML",
      reply_markup: agenticRoomKeyboard(),
    });
  } catch (error) {
    logger.error({ error }, "Agentic tool failed");
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, "⚠️ Agentic analysis is temporarily unavailable.", {
      parse_mode: "HTML",
      reply_markup: agenticRoomKeyboard(),
    });
  }
}

function renderAgenticText(value: string): string {
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/__(.+?)__/gs, "<b>$1</b>")
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<i>$1</i>")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");
}

async function getUserInsights(userId: number): Promise<string> {
  const [user] = await db.select({
    fullName: usersTable.fullName,
    username: usersTable.username,
    tier: usersTable.tier,
    premiumExpiry: usersTable.premiumExpiry,
    targetExamMain: usersTable.targetExamMain,
    targetExamSub: usersTable.targetExamSub,
    joinedAt: usersTable.joinedAt,
    totalTestsTaken: usersTable.totalTestsTaken,
    referralCount: usersTable.referralCount,
  }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
  const attempts = await db.select({
    testId: userHistoryTable.testId, score: userHistoryTable.score, accuracy: userHistoryTable.accuracy,
    correctCount: userHistoryTable.correctCount, wrongCount: userHistoryTable.wrongCount,
    userAnswers: userHistoryTable.userAnswers, completedAt: userHistoryTable.completedAt,
  }).from(userHistoryTable).where(eq(userHistoryTable.userId, userId)).orderBy(desc(userHistoryTable.completedAt)).limit(20);

  const testRows = await db.select({
    testId: testSeriesTable.testId,
    testName: testSeriesTable.testName,
    questionsData: testSeriesTable.questionsData,
    topicTags: testSeriesTable.topicTags,
  }).from(testSeriesTable);
  const testMap = new Map(testRows.map((t) => [t.testId, t]));
  const testGroups = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const group = testGroups.get(attempt.testId) ?? [];
    group.push(attempt);
    testGroups.set(attempt.testId, group);
  }
  const allAttempts = testGroups.size
    ? await db.select({
      testId: userHistoryTable.testId,
      score: userHistoryTable.score,
      userAnswers: userHistoryTable.userAnswers,
      correctCount: userHistoryTable.correctCount,
      wrongCount: userHistoryTable.wrongCount,
      accuracy: userHistoryTable.accuracy,
      completedAt: userHistoryTable.completedAt,
    }).from(userHistoryTable).where(inArray(userHistoryTable.testId, [...testGroups.keys()]))
    : [];
  const allGroups = new Map<string, typeof allAttempts>();
  for (const attempt of allAttempts) {
    const group = allGroups.get(attempt.testId) ?? [];
    group.push(attempt);
    allGroups.set(attempt.testId, group);
  }
  const performance = attempts.length
    ? [...testGroups.entries()].slice(0, 12).map(([testId, rows]) => {
      const title = testMap.get(testId)?.testName ?? testId;
      const avg = rows.reduce((sum, row) => sum + row.accuracy, 0) / rows.length;
      const population = allGroups.get(testId) ?? [];
      const topper = population.reduce((max, row) => Math.max(max, row.score), -Infinity);
      const test = testMap.get(testId);
      const qCount = Array.isArray(test?.questionsData) ? test.questionsData.length : 0;
       const questionData = Array.isArray(test?.questionsData) ? test.questionsData as any[] : [];
      const questionStats = Array.from({ length: qCount }, (_, index) => {
        const valid = rows.filter((row) => Array.isArray(row.userAnswers) && typeof (row.userAnswers as unknown[])[index] === "number");
         const correct = valid.filter((row) => (row.userAnswers as unknown[])[index] === questionData[index]?.correctOptionIndex).length;
        return valid.length ? correct / valid.length : null;
      }).filter((v): v is number => v !== null);
      const weakQuestionAccuracy = questionStats.length ? Math.min(...questionStats) * 100 : null;
       const mistakes = rows.flatMap((row) => {
         const answers = Array.isArray(row.userAnswers) ? row.userAnswers : [];
         return questionData.flatMap((question, index) => {
           const answerIndex = answers[index];
           if (typeof answerIndex !== "number" || answerIndex === question.correctOptionIndex) return [];
           return [`Question: ${String(question.question).slice(0, 260)} | User answer: ${question.options?.[answerIndex] ?? "unknown"} | Correct answer: ${question.options?.[question.correctOptionIndex] ?? "unknown"} | Explanation: ${String(question.explanation ?? "").slice(0, 260)}`];
         });
        }).slice(0, 5);
      const sorted = [...population].sort((a, b) => b.score - a.score);
      const band = Math.max(1, Math.ceil(sorted.length * 0.27));
      const accuracyFor = (group: typeof rows) => {
        const answered = group.reduce((sum, row) => sum + row.correctCount + row.wrongCount, 0);
        return answered ? group.reduce((sum, row) => sum + row.correctCount, 0) / answered : 0;
      };
      const discrimination = sorted.length >= 4 ? (accuracyFor(sorted.slice(0, band)) - accuracyFor(sorted.slice(-band))) * 100 : null;
       const topicStats = new Map<string, { correct: number; answered: number }>();
       for (const row of rows) {
         const answers = Array.isArray(row.userAnswers) ? row.userAnswers : [];
         questionData.forEach((question, index) => {
           const answer = answers[index];
           if (typeof answer !== "number") return;
           const topics = Array.isArray(question.topics) && question.topics.length
             ? question.topics
             : question.topic ? [question.topic] : [];
           for (const topic of topics) {
             const stat = topicStats.get(String(topic)) ?? { correct: 0, answered: 0 };
             stat.answered++;
             if (answer === question.correctOptionIndex) stat.correct++;
             topicStats.set(String(topic), stat);
           }
         });
       }
       const weakTopics = [...topicStats.entries()]
         .filter(([, stat]) => stat.answered > 0)
         .map(([topic, stat]) => ({ topic, accuracy: (stat.correct / stat.answered) * 100, answered: stat.answered }))
         .sort((a, b) => a.accuracy - b.accuracy)
         .slice(0, 5)
         .map((item) => `${item.topic} ${item.accuracy.toFixed(0)}% (${item.answered} answers)`);
       const topics = testMap.get(testId)?.topicTags?.length
         ? testMap.get(testId)!.topicTags.join(", ")
         : "not indexed yet";
       return `Title: ${title}; attempts=${rows.length}; average accuracy=${avg.toFixed(1)}%; best personal score=${rows.reduce((max, row) => Math.max(max, row.score), -Infinity)}; topper score=${topper === -Infinity ? "unknown" : topper}; indexed topics=${topics}; weak topics=${weakTopics.length ? weakTopics.join(", ") : "not enough tagged answers"}; weakest question accuracy=${weakQuestionAccuracy === null ? "not enough data" : `${weakQuestionAccuracy.toFixed(1)}%`}; discrimination index=${discrimination === null ? "not reliable yet" : discrimination.toFixed(1)}\nMistakes to coach:\n${mistakes.length ? mistakes.join("\n") : "No recorded mistakes in the available attempts."}`;
    }).join("\n")
    : "No completed attempts yet";
  const weak = attempts.length
    ? attempts.filter((a) => a.accuracy < 60).map((a) => testMap.get(a.testId)?.testName ?? "Untitled test").slice(0, 5).join(", ")
    : "Not enough data yet";
  const strong = attempts.length
    ? attempts.filter((a) => a.accuracy >= 80).map((a) => testMap.get(a.testId)?.testName ?? "Untitled test").slice(0, 5).join(", ")
    : "Not enough data yet";
  const percentileValues = attempts.slice(0, 3).map((attempt) => {
    const population = allGroups.get(attempt.testId) ?? [];
    if (!population.length) return null;
    return (population.filter((row) => row.score <= attempt.score).length / population.length) * 100;
  }).filter((value): value is number => value !== null);
  const recentThree = attempts.slice(0, 3).map((attempt) => {
    const title = testMap.get(attempt.testId)?.testName ?? "Untitled test";
    return `${title}: score ${attempt.score}, accuracy ${attempt.accuracy.toFixed(1)}%, completed ${new Date(attempt.completedAt).toISOString().slice(0, 10)}`;
  });
  const premiumStatus = user?.premiumExpiry
    ? `${user.tier}, expires ${user.premiumExpiry.toISOString().slice(0, 10)}`
    : user?.tier ?? "Free";
  return `Student profile:
Name: ${user?.fullName ?? "Student"}${user?.username ? ` (@${user.username})` : ""}
Plan: ${premiumStatus}
Target exam: ${user?.targetExamMain ?? "Not set"} / ${user?.targetExamSub ?? "Not set"}
Joined: ${user?.joinedAt?.toISOString().slice(0, 10) ?? "unknown"}; total tests recorded: ${user?.totalTestsTaken ?? attempts.length}; referrals: ${user?.referralCount ?? 0}
Average percentile across last 3 tests: ${percentileValues.length ? `${(percentileValues.reduce((sum, value) => sum + value, 0) / percentileValues.length).toFixed(1)}%` : "not enough population data"}
Last 3 tests:
${recentThree.length ? recentThree.join("\n") : "No completed attempts yet"}
Completed test analysis (use titles, not IDs):
${performance}
Likely weak sets: ${weak}
Strong sets: ${strong}`;
}

export async function answerAgenticMessage(userId: number, text: string): Promise<string> {
  const insights = await getUserInsights(userId);
  const userAttempts = await db.select({ testId: userHistoryTable.testId })
    .from(userHistoryTable)
    .where(eq(userHistoryTable.userId, userId))
    .orderBy(desc(userHistoryTable.completedAt))
    .limit(20);
  const relevantTestIds = [...new Set(userAttempts.map((attempt) => attempt.testId))];
  const indexedTests = relevantTestIds.length
    ? await db.select({
      testId: testSeriesTable.testId,
      testName: testSeriesTable.testName,
      topicTags: testSeriesTable.topicTags,
      questionsData: testSeriesTable.questionsData,
    }).from(testSeriesTable).where(inArray(testSeriesTable.testId, relevantTestIds))
    : [];
  const cached = indexedTests.map((test) => {
    const questions = Array.isArray(test.questionsData) ? test.questionsData as QuestionAnalysis[] : [];
    const questionDetails = questions.slice(0, 12).map((question, index) =>
      `Q${index + 1} "${String(question.question ?? "").slice(0, 180)}": topics=${question.topics.join(", ") || "unknown"}; difficulty=${question.difficulty ?? "unknown"}; focus=${String(question.focus ?? "").slice(0, 180)}`
    ).join("\n");
    return `Test title: ${test.testName}; indexed topics=${(test.topicTags ?? []).join(", ") || "not indexed"}\n${questionDetails}`;
  }).join("\n");
  const studentContext = `${insights}\nBackground question intelligence:\n${cached || "Still building the question intelligence index."}`.slice(0, 24_000);
  return askGemini([
      { role: "system", content: `${BOT_AGENT_CONTEXT}
You are the always-on Agentic AI strategist inside Series TestPro. You can act as a tutor, performance analyst, study planner, practice-set designer, revision coach, and exam accountability partner.
Use the student's real context below. Be personal and actionable. If asked to do work, do it directly in the response. Never claim an action happened if it did not. Keep responses under 350 words, plain text, readable in Telegram.
Never show internal test IDs to the user. Use test titles. Report average accuracy, weak topics, strong topics, topper score, and discrimination index only when available in the context; otherwise say that data is insufficient.
You have access to question-level intelligence and the student's answer arrays. When a question was answered incorrectly, identify the question by its text/short title, explain the likely mistake, and recommend a correction. Never reveal an internal question ID or test ID.
Student context:
${studentContext}` },
    { role: "user", content: text.slice(0, 5000) },
  ], { maxTokens: 4096, temperature: 0.4 });
}

export async function agenticInsights(userId: number): Promise<string> {
  return answerAgenticMessage(userId, "Give me a concise personal dashboard: my weak areas, strong areas, recent trend, and the best next 3 actions.");
}

async function loadSubjectTopics(subject: string): Promise<string[]> {
  const raw = await getConfig("subjects");
  let taxonomy = DEFAULT_SUBJECTS;
  if (raw) {
    try {
      taxonomy = JSON.parse(raw) as Record<string, string[]>;
    } catch {
      taxonomy = DEFAULT_SUBJECTS;
    }
  }
  const subjectTopics = Array.isArray(taxonomy[subject]) ? taxonomy[subject] : [];
  const allowed = subjectTopics.length ? subjectTopics : Object.values(taxonomy).flat();
  const result = [...new Set(allowed.map((topic) => String(topic).trim()).filter(Boolean))];
  return result.length ? result : ["General"];
}

function canonicalTopic(value: unknown, allowedTopics: string[]): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  return allowedTopics.find((topic) => topic.toLowerCase() === text) ?? null;
}

function normalizeDifficulty(value: unknown): "easy" | "medium" | "hard" {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "easy") return "easy";
  if (text === "hard" || text === "very hard") return "hard";
  return "medium";
}

async function analyzeTestSet(test: {
  testId: string;
  testName: string;
  subject: string;
  subSubject: string;
  questionsData: unknown;
}, allowedTopics: string[]): Promise<void> {
  const sourceQuestions = Array.isArray(test.questionsData) ? test.questionsData as any[] : [];
  if (!sourceQuestions.length) throw new Error("Test has no questions to tag");
  const taggedQuestions = [...sourceQuestions];
  const pending = taggedQuestions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) =>
      question.topicTagVersion !== TOPIC_TAGGING_VERSION ||
      !allowedTopics.some((topic) => topic.toLowerCase() === String(question.topic ?? "").toLowerCase())
    );

  for (let start = 0; start < pending.length; start += 50) {
    const elapsed = lastTagRequestAt ? Date.now() - lastTagRequestAt : TAG_REQUEST_MIN_INTERVAL_MS;
    const waitMs = Math.max(0, TAG_REQUEST_MIN_INTERVAL_MS - elapsed);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastTagRequestAt = Date.now();
    const batch = pending.slice(start, start + 50);
    const prompt = batch.map(({ question, index }) =>
      `INDEX ${index + 1}\nQuestion: ${String(question.question ?? "").slice(0, 700)}\nOptions: ${(question.options ?? []).join(" | ")}\nExplanation: ${String(question.explanation ?? "").slice(0, 500)}`
    ).join("\n\n");
    const raw = await askGemini([
      { role: "system", content: `You tag Indian competitive-exam questions. Use ONLY one topic from this canonical list: ${allowedTopics.join(", ")}.
Return JSON only: {"questions":[{"index":1,"topic":"Canonical topic","difficulty":"easy|medium|hard","focus":"one short sentence"}]}.
Return exactly one item for every input question, preserve each supplied INDEX, never invent a topic, and do not solve the question.` },
      { role: "user", content: `Test: ${test.testName}\nSubject: ${test.subject}\nSub-subject: ${test.subSubject}\n${prompt}` },
    ], { json: true, maxTokens: 4096, temperature: 0.1 });
    const parsed = JSON.parse(raw) as {
      questions?: Array<{ index?: number; topic?: string; difficulty?: string; focus?: string }>;
    };
    const returnedQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const byIndex = new Map(returnedQuestions.map((item) => [Number(item.index), item]));
    if (byIndex.size !== batch.length || batch.some(({ index }) => !byIndex.has(index + 1))) {
      throw new Error("Gemini returned incomplete question tags; this test will be retried later.");
    }
    batch.forEach(({ question, index }) => {
      const item = byIndex.get(index + 1);
      const topic = canonicalTopic(item?.topic, allowedTopics);
      if (!topic) {
        throw new Error("Gemini returned a topic outside the Subject Library taxonomy; this test will be retried later.");
      }
      taggedQuestions[index] = {
        ...question,
        topic,
        topics: [topic],
        skills: [],
        difficulty: normalizeDifficulty(item?.difficulty),
        focus: String(item?.focus ?? "").slice(0, 220),
        topicTagVersion: TOPIC_TAGGING_VERSION,
      };
    });
    // Persist each completed batch so retries after a quota or network error
    // only spend another request on questions that were not tagged yet.
    await db.update(testSeriesTable).set({ questionsData: taggedQuestions })
      .where(eq(testSeriesTable.testId, test.testId));
  }

  if (taggedQuestions.some((question) =>
    question.topicTagVersion !== TOPIC_TAGGING_VERSION ||
    !allowedTopics.some((topic) => topic.toLowerCase() === String(question.topic ?? "").toLowerCase())
  )) {
    throw new Error("Some questions remain untagged; this test will be retried later.");
  }
  const topicTags = [...new Set(taggedQuestions.map((question) => String(question.topic)))];
  await db.update(testSeriesTable).set({
    questionsData: taggedQuestions,
    topicTags,
    topicTaggedAt: new Date(),
    topicTaggingVersion: TOPIC_TAGGING_VERSION,
  }).where(eq(testSeriesTable.testId, test.testId));
}

export async function runAgenticAnalysis(): Promise<void> {
  if (analysisRunning) return;
  if (Date.now() < analysisQuotaBlockedUntil) {
    lastError = "Gemini quota cooldown active; try again after the cooldown.";
    return;
  }
  analysisRunning = true;
  lastRunAt = Date.now();
  lastError = null;
  try {
    const tests = await db.select({
      testId: testSeriesTable.testId,
      testName: testSeriesTable.testName,
      subject: testSeriesTable.subject,
      subSubject: testSeriesTable.subSubject,
      questionsData: testSeriesTable.questionsData,
      topicTags: testSeriesTable.topicTags,
      topicTaggedAt: testSeriesTable.topicTaggedAt,
    })
      .from(testSeriesTable).where(eq(testSeriesTable.isActive, true));
    let analyzedSets = 0;
    let analyzedQuestions = 0;
    for (const test of tests) {
      if (test.topicTaggedAt || test.topicTags.length > 0) continue;
      try {
        const allowedTopics = await loadSubjectTopics(test.subject);
        await analyzeTestSet(test, allowedTopics);
        analyzedSets++;
        analyzedQuestions += Array.isArray(test.questionsData) ? test.questionsData.length : 0;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn({ error, testId: test.testId }, "Agentic set analysis failed");
        if (/429|quota|resource_exhausted|rate limit/i.test(lastError)) {
          analysisQuotaBlockedUntil = Date.now() + 60_000;
          break;
        }
      }
    }
    lastRunStats = { sets: analyzedSets, questions: analyzedQuestions };
    lastCompletedAt = Date.now();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    logger.error({ error }, "Agentic analysis run failed");
  } finally {
    analysisRunning = false;
  }
}

export async function getAgenticAnalysisStatus() {
  const tests = await db.select({
    testId: testSeriesTable.testId,
    testName: testSeriesTable.testName,
    topicTags: testSeriesTable.topicTags,
    topicTaggedAt: testSeriesTable.topicTaggedAt,
    questionsData: testSeriesTable.questionsData,
  }).from(testSeriesTable).where(eq(testSeriesTable.isActive, true));
  const sets = tests.filter((test) => test.topicTaggedAt || test.topicTags.length > 0).map((test) => {
    const questions = Array.isArray(test.questionsData) ? test.questionsData as any[] : [];
    return {
      testId: test.testId,
      testName: test.testName,
      updatedAt: test.topicTaggedAt?.toISOString() ?? null,
      topics: test.topicTags,
      skills: [],
      difficulty: questions.some((question) => question.difficulty === "hard") ? "hard" : "medium",
      focus: "Questions tagged against the configured subject topic library.",
      questionCount: questions.length,
      questions: questions.map((question) => ({
        question: String(question.question ?? "").slice(0, 180),
        topics: Array.isArray(question.topics) ? question.topics : question.topic ? [question.topic] : [],
        skills: Array.isArray(question.skills) ? question.skills : [],
        difficulty: String(question.difficulty ?? "medium"),
        focus: String(question.focus ?? ""),
      })),
    };
  });
  return {
    running: analysisRunning,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastCompletedAt: lastCompletedAt ? new Date(lastCompletedAt).toISOString() : null,
    lastError,
    lastRunStats,
    activeSets: tests.length,
    analyzedSets: sets.length,
    pendingSets: Math.max(0, tests.length - sets.length),
    analyzedQuestions: sets.reduce((sum, set) => sum + set.questionCount, 0),
    sets,
  };
}

export function startAgenticAnalysisScheduler(): void {
  logger.info("Agentic AI scheduler ready; Smart Intelligence runs only when an admin presses Run now");
}

export { deleteTrackedAgenticMessages };