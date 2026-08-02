import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { userCustomSetsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getSession, updateSession } from "../session.js";
import { getApi } from "../api-instance.js";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";
import type { QuestionData } from "@workspace/db";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function generateShareToken(): string {
  return randomBytes(8).toString("hex");
}

// ─── PDF text extraction ───────────────────────────────────────────────────────

async function extractTextFromPdf(fileId: string): Promise<string> {
  const api = getApi();
  const file = await api.getFile(fileId);
  const filePath = file.file_path;
  if (!filePath) throw new Error("Could not get file path from Telegram");

  const token = process.env["TELEGRAM_BOT_TOKEN"]!;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download PDF: ${resp.status}`);

  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let text = "";
  for (let i = 0; i < bytes.length; i++) {
    const ch = bytes[i]!;
    if (ch >= 32 && ch <= 126) {
      text += String.fromCharCode(ch);
    } else if (ch === 10 || ch === 13) {
      text += " ";
    }
  }

  text = text
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.,!?;:()\-'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 100)
    throw new Error("Could not extract enough text from PDF. Please make sure the PDF has selectable text.");
  return text.slice(0, 12000);
}

// ─── AI question generation ────────────────────────────────────────────────────

async function generateQuestionsFromText(
  text: string,
  count: number,
  language: "en" | "hi",
  topic: string
): Promise<QuestionData[]> {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];
  const baseUrl = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1";

  if (!apiKey) throw new Error("AI service not configured");

  const langInstruction =
    language === "hi"
      ? "Generate ALL questions, options, and explanations in Hindi (Devanagari script)."
      : "Generate ALL questions, options, and explanations in English.";

  const prompt = `You are an expert exam question setter for Indian competitive exams (SSC, Railway, Banking, Bihar Govt).

Given the following study material, generate exactly ${count} multiple-choice questions suitable for exam practice.

MATERIAL:
${text}

RULES:
1. ${langInstruction}
2. Each question must have exactly 4 options (A, B, C, D).
3. Only one option must be correct.
4. Questions should test understanding, not just recall.
5. Include a brief explanation for each correct answer.
6. Vary difficulty: ~30% easy, ~50% medium, ~20% hard.
7. Do NOT repeat similar questions.

OUTPUT FORMAT (JSON array only, no other text):
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctOptionIndex": 0,
    "explanation": "Brief explanation here."
  }
]

Generate exactly ${count} questions now:`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a precise JSON-generating exam question setter. Output only valid JSON arrays. No markdown, no explanation outside JSON.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) throw new Error(`AI API error: ${resp.status}`);
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);

  const raw = data.choices?.[0]?.message?.content ?? "[]";
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("AI did not return valid JSON array");

  const parsed = JSON.parse(jsonMatch[0]) as Array<{
    question: string;
    options: string[];
    correctOptionIndex: number;
    explanation: string;
  }>;

  return parsed.slice(0, count).map((q, i) => ({
    id: `custom_q_${Date.now()}_${i}`,
    question: q.question ?? "Question",
    options: (q.options ?? []).slice(0, 4),
    correctOptionIndex: Math.max(0, Math.min(3, q.correctOptionIndex ?? 0)),
    explanation: q.explanation ?? "",
    language,
  }));
}

// ─── Animation messages ────────────────────────────────────────────────────────

const PROCESSING_FRAMES = [
  "🔍 *Analysing your PDF\\.\\.\\.*\n\n📄 Reading document structure\\.\\.\\.",
  "📖 *Extracting content\\.\\.\\.*\n\n🔤 Identifying key concepts and topics\\.\\.\\.",
  "🧠 *AI is thinking\\.\\.\\.*\n\n📊 Mapping topics to exam patterns\\.\\.\\.",
  "✍️ *Generating questions\\.\\.\\.*\n\n🎯 Crafting MCQs from your material\\.\\.\\.",
  "✅ *Verifying answers\\.\\.\\.*\n\n🔎 Cross\\-checking correctness and difficulty\\.\\.\\.",
  "📦 *Finalising your test set\\.\\.\\.*\n\n💾 Saving to your profile\\.\\.\\.",
];

async function runAnimationLoop(
  userId: number,
  msgId: number,
  done: Promise<void>
): Promise<void> {
  const api = getApi();
  let frame = 0;
  const tick = async () => {
    try {
      await api.editMessageText(
        userId,
        msgId,
        PROCESSING_FRAMES[frame % PROCESSING_FRAMES.length]!,
        { parse_mode: "MarkdownV2" }
      );
    } catch {
      /* ignore edit errors */
    }
    frame++;
  };

  const interval = setInterval(() => {
    tick().catch(() => {});
  }, 4000);
  try {
    await done;
  } finally {
    clearInterval(interval);
  }
}

// ─── Main pipeline ─────────────────────────────────────────────────────────────

async function processCustomTest(
  userId: number,
  fileId: string,
  fileName: string,
  language: "en" | "hi",
  questionCount: number,
  setId: number,
  animMsgId: number
): Promise<void> {
  const api = getApi();
  let questions: QuestionData[] = [];

  try {
    let resolveAnim!: () => void;
    const animDone = new Promise<void>((res) => {
      resolveAnim = res;
    });

    runAnimationLoop(userId, animMsgId, animDone).catch(() => {});

    const text = await extractTextFromPdf(fileId);
    questions = await generateQuestionsFromText(text, questionCount, language, fileName);

    if (questions.length === 0)
      throw new Error("AI could not generate any questions from this document.");

    await db
      .update(userCustomSetsTable)
      .set({
        questionsData: questions,
        questionCount: questions.length,
        status: "ready",
        completedAt: new Date(),
      })
      .where(eq(userCustomSetsTable.id, setId));

    resolveAnim();

    const [saved] = await db
      .select({ shareToken: userCustomSetsTable.shareToken })
      .from(userCustomSetsTable)
      .where(eq(userCustomSetsTable.id, setId))
      .limit(1);

    const botUsername = process.env["BOT_USERNAME"] ?? "gt_testprobot";
    const shareLink = `https://t.me/${botUsername}?start=customset_${saved?.shareToken ?? ""}`;

    try {
      await api.deleteMessage(userId, animMsgId);
    } catch {}

    const langLabel = language === "hi" ? "Hindi" : "English";
    const kb = new InlineKeyboard()
      .text("🚀 Start Test Now", `customset_start_${setId}`)
      .row()
      .text("📋 My Sets", "my_custom_sets")
      .text("🔗 Share", `customset_share_${setId}`);

    await api.sendMessage(
      userId,
      `✅ *Your Custom Test is Ready\\!*\n\n` +
        `📝 *${escMd(fileName.replace(".pdf", "").slice(0, 40))}*\n\n` +
        `🔢 Questions: *${questions.length}*\n` +
        `🌐 Language: *${langLabel}*\n\n` +
        `🔗 *Shareable Link:*\n\`${escMd(shareLink)}\`\n\n` +
        `_Tap *Start Test Now* to begin, or find it anytime in /mysets_`,
      { parse_mode: "MarkdownV2", reply_markup: kb }
    );

    emitTelemetry(`User ${userId} created custom set: ${fileName} (${questions.length} questions)`);
  } catch (err) {
    logger.error({ err, userId }, "Custom test generation failed");

    const errMsg = err instanceof Error ? err.message : "Unknown error";

    await db
      .update(userCustomSetsTable)
      .set({ status: "failed", failReason: errMsg.slice(0, 500) })
      .where(eq(userCustomSetsTable.id, setId));

    try {
      await api.deleteMessage(userId, animMsgId);
    } catch {}

    await api.sendMessage(
      userId,
      `❌ *Failed to generate your test\\.*\n\n_Reason: ${escMd(errMsg.slice(0, 200))}_\n\nPlease try again with a different PDF\\. Make sure the PDF has selectable text \\(not scanned images\\)\\.`,
      { parse_mode: "MarkdownV2" }
    );
  }
}

// ─── Handler registration ──────────────────────────────────────────────────────

export function registerCustomTestHandlers(bot: Bot): void {
  //
  // /createtest — entry point
  //
  bot.command("createtest", async (ctx) => {
    const userId = ctx.from!.id;
    try {
      const [user] = await db
        .select({ tier: usersTable.tier })
        .from(usersTable)
        .where(eq(usersTable.userId, userId))
        .limit(1);
      const isPremium = user?.tier === "Premium";

      if (!isPremium) {
        await ctx.reply(
          "🔒 *Create Your Own Test — Premium Feature*\n\n" +
            "💎 Upload any PDF and AI will automatically generate a personalized test for you\\!\n\n" +
            "*What you get with Premium:*\n" +
            "✅ PDF → 50 AI\\-generated MCQs\n" +
            "✅ Hindi or English language choice\n" +
            "✅ Shareable link for your set\n" +
            "✅ Stored in your profile forever\n" +
            "✅ Start, retry, share anytime\n\n" +
            "👉 Use /premium to upgrade\\!",
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      updateSession(userId, { pendingCustomTest: { step: "awaiting_language" } });

      const kb = new InlineKeyboard()
        .text("🇮🇳 Hindi", "ctest_lang_hi")
        .text("🇬🇧 English", "ctest_lang_en")
        .row()
        .text("❌ Cancel", "ctest_cancel");

      await ctx.reply(
        "🧪 *Create Your Own Test*\n\n" +
          "Upload any PDF \\(notes, book chapter, study material\\) and AI will generate a custom test for you\\!\n\n" +
          "*Step 1 of 3:* Choose the language for your test:",
        { parse_mode: "MarkdownV2", reply_markup: kb }
      );
    } catch (err) {
      logger.error({ err, userId }, "/createtest error");
      await ctx.reply("❌ Something went wrong. Please try again.");
    }
  });

  //
  // Language selection
  //
  bot.callbackQuery(/^ctest_lang_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const lang = ctx.callbackQuery.data.replace("ctest_lang_", "") as "en" | "hi";

    const session = getSession(userId);
    if (!session.pendingCustomTest || session.pendingCustomTest.step !== "awaiting_language") {
      await ctx.reply("❌ Session expired. Please use /createtest to start again.");
      return;
    }

    updateSession(userId, {
      pendingCustomTest: { step: "awaiting_count", language: lang },
    });

    const kb = new InlineKeyboard()
      .text("10", "ctest_count_10")
      .text("20", "ctest_count_20")
      .text("30", "ctest_count_30")
      .row()
      .text("40", "ctest_count_40")
      .text("50", "ctest_count_50")
      .row()
      .text("❌ Cancel", "ctest_cancel");

    try {
      await ctx.editMessageText(
        `✅ Language: *${lang === "hi" ? "Hindi 🇮🇳" : "English 🇬🇧"}*\n\n` +
          "*Step 2 of 3:* How many questions do you want? \\(max 50\\)\n\n" +
          "_More questions \\= more processing time_",
        { parse_mode: "MarkdownV2", reply_markup: kb }
      );
    } catch {
      // Fallback if edit fails
      try {
        await ctx.deleteMessage();
      } catch {}
      await ctx.reply(
        `✅ Language: *${lang === "hi" ? "Hindi 🇮🇳" : "English 🇬🇧"}*\n\n` +
          "*Step 2 of 3:* How many questions do you want? \\(max 50\\)\n\n" +
          "_More questions \\= more processing time_",
        { parse_mode: "MarkdownV2", reply_markup: kb }
      );
    }
  });

  //
  // Question count selection
  //
  bot.callbackQuery(/^ctest_count_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const count = parseInt(ctx.callbackQuery.data.replace("ctest_count_", ""), 10);

    const session = getSession(userId);
    if (!session.pendingCustomTest || session.pendingCustomTest.step !== "awaiting_count" || !session.pendingCustomTest.language) {
      await ctx.reply("❌ Session expired. Please use /createtest to start again.");
      return;
    }

    updateSession(userId, {
      pendingCustomTest: {
        ...session.pendingCustomTest,
        questionCount: count,
        step: "awaiting_pdf",
      },
    });

    try {
      await ctx.editMessageText(
        `✅ Questions: *${count}*\n\n` +
          "*Step 3 of 3:* Now send me your PDF file\\!\n\n" +
          "📎 Upload your study material / notes / book chapter as a PDF\n\n" +
          "_Tip: Make sure the PDF has selectable text, not scanned images_",
        { parse_mode: "MarkdownV2" }
      );
    } catch {
      try {
        await ctx.deleteMessage();
      } catch {}
      await ctx.reply(
        `✅ Questions: *${count}*\n\n` +
          "*Step 3 of 3:* Now send me your PDF file\\!\n\n" +
          "📎 Upload your study material / notes / book chapter as a PDF\n\n" +
          "_Tip: Make sure the PDF has selectable text, not scanned images_",
        { parse_mode: "MarkdownV2" }
      );
    }
  });

  //
  // Cancel
  //
  bot.callbackQuery("ctest_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Cancelled." });
    updateSession(ctx.from.id, { pendingCustomTest: undefined });
    try {
      await ctx.deleteMessage();
    } catch {
      try {
        await ctx.editMessageText("❌ Cancelled.", {});
      } catch {}
    }
  });

  //
  // Document upload handler — placed on :document filter
  //
  bot.on(":document", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const session = getSession(userId);
    if (!session.pendingCustomTest || session.pendingCustomTest.step !== "awaiting_pdf") {
      return next();
    }

    const doc = ctx.message?.document;
    if (!doc) return next();

    const mimeType = doc.mime_type ?? "";
    if (!mimeType.includes("pdf")) {
      await ctx.reply("❌ Please send a PDF file\\. Other file types are not supported\\.", {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    const { language, questionCount } = session.pendingCustomTest;
    if (!language || !questionCount) {
      updateSession(userId, { pendingCustomTest: undefined });
      await ctx.reply("❌ Session expired. Please use /createtest to start again.");
      return;
    }

    // Clear session immediately
    updateSession(userId, { pendingCustomTest: undefined });

    const fileName = doc.file_name ?? "document.pdf";
    const fileId = doc.file_id;
    const shareToken = generateShareToken();

    logger.info({ userId, fileName, language, questionCount }, "Processing custom test PDF");

    // Insert placeholder row
    const [inserted] = await db
      .insert(userCustomSetsTable)
      .values({
        userId,
        title: fileName.replace(".pdf", "").slice(0, 100),
        language,
        questionCount,
        questionsData: [],
        status: "processing",
        shareToken,
        sourceFileName: fileName,
      })
      .returning({ id: userCustomSetsTable.id });

    if (!inserted) {
      await ctx.reply("❌ Database error. Please try again.");
      return;
    }

    // Send initial animation message
    const animMsg = await ctx.reply(
      "🔍 *Analysing your PDF\\.\\.\\.*\n\n📄 Reading document structure\\.\\.\\.",
      { parse_mode: "MarkdownV2" }
    );

    // Notify user
    await ctx.reply(
      "⏳ *Processing your PDF\\!*\n\n" +
        "Your test set is being generated\\. This may take 1\\-3 minutes depending on document size\\.\n\n" +
        "🔔 *I will notify you here when your test is ready\\!*\n\n" +
        "You can continue using the bot normally — use /test\\_series, /stats, etc\\.",
      { parse_mode: "MarkdownV2" }
    );

    // Run pipeline in background
    processCustomTest(
      userId,
      fileId,
      fileName,
      language,
      questionCount,
      inserted.id,
      animMsg.message_id
    ).catch((err) => logger.error({ err, userId }, "processCustomTest uncaught"));
  });

  //
  // /mysets — view custom sets
  //
  bot.command("mysets", async (ctx) => {
    await showMySets(ctx.from!.id, (msg, opts) => ctx.reply(msg, opts));
  });

  bot.callbackQuery("my_custom_sets", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMySets(ctx.from.id, (msg, opts) => ctx.reply(msg, opts));
  });

  //
  // Start a custom set test
  //
  bot.callbackQuery(/^customset_start_/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "⏳ Loading your test..." });
    const setId = parseInt(ctx.callbackQuery.data.replace("customset_start_", ""), 10);

    const [set] = await db
      .select()
      .from(userCustomSetsTable)
      .where(eq(userCustomSetsTable.id, setId))
      .limit(1);

    if (!set || set.status !== "ready") {
      await ctx.reply("❌ Test set not ready yet. Please wait for processing to complete.");
      return;
    }

    const { startQuizForUser } = await import("./quiz.js");
    await startQuizForUser(ctx.from.id, {
      testId: `custom_${set.id}`,
      testName: set.title,
      questionsData: set.questionsData,
      timerSeconds: 30,
      positiveMarking: 1,
      negativeMarking: 0.25,
    });
  });

  //
  // Share a custom set
  //
  bot.callbackQuery(/^customset_share_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const setId = parseInt(ctx.callbackQuery.data.replace("customset_share_", ""), 10);
    const userId = ctx.from.id;

    const [set] = await db
      .select({
        shareToken: userCustomSetsTable.shareToken,
        title: userCustomSetsTable.title,
        userId: userCustomSetsTable.userId,
      })
      .from(userCustomSetsTable)
      .where(eq(userCustomSetsTable.id, setId))
      .limit(1);

    if (!set) {
      await ctx.reply("❌ Set not found.");
      return;
    }
    if (set.userId !== userId) {
      await ctx.reply("❌ Access denied.");
      return;
    }

    const botUsername = (await ctx.api.getMe()).username ?? "gt_testprobot";
    const shareLink = `https://t.me/${botUsername}?start=customset_${set.shareToken}`;

    await ctx.reply(
      `🔗 *Share Your Test Set*\n\n` +
        `📝 *${escMd(set.title)}*\n\n` +
        `Share this link with anyone:\n\`${escMd(shareLink)}\`\n\n` +
        `_Anyone who opens this link can attempt your custom test\\!_`,
      { parse_mode: "MarkdownV2" }
    );
  });

  //
  // Delete a custom set
  //
  bot.callbackQuery(/^customset_delete_/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Set deleted." });
    const setId = parseInt(ctx.callbackQuery.data.replace("customset_delete_", ""), 10);

    await db
      .update(userCustomSetsTable)
      .set({ isActive: false })
      .where(eq(userCustomSetsTable.id, setId));

    await ctx.reply("🗑️ *Test set deleted from your profile\\.*", { parse_mode: "MarkdownV2" });
  });
}

// ─── My Sets helper ────────────────────────────────────────────────────────────

async function showMySets(
  userId: number,
  replier: (msg: string, opts?: object) => Promise<unknown>
): Promise<void> {
  const sets = await db
    .select({
      id: userCustomSetsTable.id,
      title: userCustomSetsTable.title,
      questionCount: userCustomSetsTable.questionCount,
      language: userCustomSetsTable.language,
      status: userCustomSetsTable.status,
      shareToken: userCustomSetsTable.shareToken,
      createdAt: userCustomSetsTable.createdAt,
    })
    .from(userCustomSetsTable)
    .where(eq(userCustomSetsTable.userId, userId))
    .orderBy(desc(userCustomSetsTable.createdAt))
    .limit(10);

  const activeSets = sets.filter((s) => s.status !== "failed");

  if (activeSets.length === 0) {
    const kb = new InlineKeyboard().text("🧪 Create My First Test", "ctest_entry");
    await replier(
      "📂 *My Custom Sets*\n\nYou haven't created any custom test sets yet\\!\n\n" +
        "Use /createtest to upload a PDF and AI will generate a test for you\\.",
      { parse_mode: "MarkdownV2", reply_markup: kb }
    );
    return;
  }

  let msg = `📂 *My Custom Sets \\(${activeSets.length}\\)*\n\n`;
  const kb = new InlineKeyboard();

  for (const s of activeSets) {
    const statusEmoji = s.status === "ready" ? "✅" : "⏳";
    const langLabel = s.language === "hi" ? "🇮🇳" : "🇬🇧";
    const d = new Date(s.createdAt).toLocaleDateString("en-IN");
    msg += `${statusEmoji} *${escMd(s.title.slice(0, 35))}*\n`;
    msg += `   ${langLabel} ${s.status === "ready" ? `${s.questionCount} questions` : "Processing\\.\\.\\."} • ${escMd(d)}\n\n`;

    if (s.status === "ready") {
      kb.text(`▶️ ${s.title.slice(0, 18)}`, `customset_start_${s.id}`).row();
    }
  }

  msg += `_Use /createtest to add more sets\\._`;
  await replier(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
}

// ─── Deep link handler ─────────────────────────────────────────────────────────

export async function handleCustomSetDeepLink(
  userId: number,
  shareToken: string
): Promise<void> {
  const api = getApi();

  const [set] = await db
    .select()
    .from(userCustomSetsTable)
    .where(eq(userCustomSetsTable.shareToken, shareToken))
    .limit(1);

  if (!set || set.status !== "ready" || !set.isActive) {
    await api.sendMessage(
      userId,
      "❌ This test set is not available or has been removed."
    );
    return;
  }

  const langLabel = set.language === "hi" ? "Hindi 🇮🇳" : "English 🇬🇧";
  const kb = new InlineKeyboard().text("🚀 Start This Test", `customset_start_${set.id}`);

  await api.sendMessage(
    userId,
    `📋 *${escMd(set.title)}*\n\n` +
      `📝 Questions: *${set.questionCount}*\n` +
      `🌐 Language: *${langLabel}*\n` +
      `🤖 AI\\-generated from PDF\n\n` +
      `_Tap Start to attempt this custom test\\!_`,
    { parse_mode: "MarkdownV2", reply_markup: kb }
  );
}

export { showMySets };
