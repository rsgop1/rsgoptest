import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { userCustomSetsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { mkdtemp, writeFile, rm, readdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getSession, updateSession } from "../session.js";
import { getApi } from "../api-instance.js";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";
import type { QuestionData } from "@workspace/db";
import { askOpenRouter, askOpenRouterVision, BOT_HELP_CONTEXT } from "../ai.js";
import { getConfig } from "./helpers.js";

const execFileAsync = promisify(execFile);

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function generateShareToken(): string {
  return randomBytes(8).toString("hex");
}

// ─── PDF text extraction ───────────────────────────────────────────────────────

async function extractTextFromPdf(fileId: string): Promise<{ text: string; sourceMode: "text" | "ocr" | "mixed" }> {
  const api = getApi();
  const file = await api.getFile(fileId);
  const filePath = file.file_path;
  if (!filePath) throw new Error("Could not get file path from Telegram");

  const token = process.env["TELEGRAM_BOT_TOKEN"]!;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download PDF: ${resp.status}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  const workDir = await mkdtemp(join(tmpdir(), "testpro-pdf-"));
  const inputPath = join(workDir, "source.pdf");
  const outputPath = join(workDir, "source.txt");
  try {
    await writeFile(inputPath, buffer);
    let text = "";
    try {
      await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", inputPath, outputPath], {
        timeout: 45_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const extracted = await readFile(outputPath, "utf8");
      text = extracted
        .replace(/\u0000/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error("PDF extraction tools are unavailable on the server.");
      }
      // Some image-only PDFs make pdftotext exit non-zero. Continue to OCR.
      text = "";
    }

    if (text.length >= 100) {
      return { text: text.slice(0, 50000), sourceMode: "text" };
    }
    const scannedOcrEnabled = (await getConfig("scanned_pdf_ocr_enabled")) === "true";
    if (!scannedOcrEnabled) {
      throw new Error("This PDF appears to be scanned/image-based. Ask an admin to enable scanned-image AI scanning in AI Settings.");
    }
    // Scanned/image-only PDFs have little or no text layer. Render their pages
    // and send page images to the vision model for careful transcription.
    await execFileAsync("pdftoppm", ["-png", "-r", "160", inputPath, join(workDir, "page")], {
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const pageFiles = (await readdir(workDir))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 30);
    if (!pageFiles.length) throw new Error("Could not render scanned PDF pages.");
    const chunks: string[] = [];
    for (let index = 0; index < pageFiles.length; index += 3) {
      const batch = pageFiles.slice(index, index + 3);
      const images = await Promise.all(batch.map(async (name) => `data:image/png;base64,${(await readFile(join(workDir, name))).toString("base64")}`));
      const transcription = await askOpenRouterVision(
        `Transcribe these study-document pages in reading order. Page numbers: ${index + 1}-${index + batch.length}. Preserve all useful exam content, headings, formulas, examples, dates, names, tables and MCQ options. Return plain text only.`,
        images,
        { maxTokens: 6000 },
      );
      chunks.push(transcription);
    }
    const ocrText = chunks.join("\n\n").replace(/\u0000/g, " ").trim();
    if (ocrText.length < 100) throw new Error("OCR could not read enough content from this scanned PDF.");
    return { text: ocrText.slice(0, 50000), sourceMode: text.length ? "mixed" : "ocr" };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── AI question generation ────────────────────────────────────────────────────

async function generateQuestionsFromText(
  text: string,
  count: number,
  language: "en" | "hi",
  topic: string,
  sourceMode: "text" | "ocr" | "mixed",
): Promise<QuestionData[]> {
  const langInstruction =
    language === "hi"
      ? "Generate ALL questions, options, and explanations in Hindi (Devanagari script)."
      : "Generate ALL questions, options, and explanations in English.";

  const prompt = `You are an expert exam question setter for Indian competitive exams (SSC, Railway, Banking, Bihar Govt).

Given the following study material, generate exactly ${count} multiple-choice questions suitable for exam practice.

MATERIAL:
${text}

RULES:
0. Every question MUST be answerable from the MATERIAL. Do not use outside facts, generic exam knowledge, or invented details. Keep the key term, person, date, formula, or concept from the material in the question or explanation.
1. ${langInstruction}
2. Each question must have exactly 4 options (A, B, C, D).
3. Only one option must be correct.
4. Questions should test understanding, not just recall.
5. Include a high-quality 2–3 line solution for each correct answer: first explain why the answer is correct from the material, then add a concise exam-useful takeaway.
6. Add "examRelevance": one short line explaining why this fact/concept matters for SSC, Railway, Banking, State PCS or another Indian government exam. If not relevant, say "Useful for concept revision."
7. Vary difficulty: ~30% easy, ~50% medium, ~20% hard.
8. Do NOT repeat similar questions.
9. This material came through ${sourceMode === "ocr" ? "OCR from scanned pages" : sourceMode === "mixed" ? "text extraction plus OCR" : "text extraction"}; resolve wording carefully and never invent unreadable facts.

OUTPUT FORMAT (JSON array only, no other text):
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctOptionIndex": 0,
    "explanation": "2–3 lines explaining the answer and the key concept.",
    "examRelevance": "Why this is useful for government-exam preparation."
  }
]

Generate exactly ${count} questions now:`;

  const raw = await askOpenRouter([
    {
      role: "system",
      content: `${BOT_HELP_CONTEXT}\nYou are a precise JSON-generating exam question setter. Output only valid JSON arrays. No markdown, no explanation outside JSON.`,
    },
    { role: "user", content: prompt },
  ], { maxTokens: 8192, temperature: 0.7 });
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("AI did not return valid JSON array");

  const parsed = JSON.parse(jsonMatch[0]) as Array<{
    question: string;
    options: string[];
    correctOptionIndex: number;
    explanation: string;
    examRelevance?: string;
  }>;

  const valid = parsed.filter((q) =>
    typeof q.question === "string" &&
    q.question.trim().length > 10 &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    typeof q.correctOptionIndex === "number"
  );
  if (valid.length < Math.max(1, Math.floor(count * 0.6))) {
    throw new Error("AI returned too few complete questions grounded in the PDF.");
  }
  return valid.slice(0, count).map((q, i) => ({
    id: `custom_q_${Date.now()}_${i}`,
    question: q.question ?? "Question",
    options: (q.options ?? []).slice(0, 4),
    correctOptionIndex: Math.max(0, Math.min(3, q.correctOptionIndex ?? 0)),
    explanation: [q.explanation ?? "", q.examRelevance ? `Exam relevance: ${q.examRelevance}` : ""].filter(Boolean).join("\n"),
    language,
  }));
}

// ─── Animation messages ────────────────────────────────────────────────────────

const PROCESSING_FRAMES = [
  "🔍 *Analysing your PDF\\.\\.\\.*\n\n📄 Reading document structure\\.\\.\\.",
  "📖 *Extracting your text\\.\\.\\.*\n\n🔤 Identifying key concepts and topics\\.\\.\\.",
  "📚 *Reading through your resources\\.\\.\\.*\n\n🧩 Connecting headings, examples and important facts\\.\\.\\.",
  "🖼️ *Scanning pages when needed\\.\\.\\.*\n\n🔎 Carefully reading diagrams and image-based text\\.\\.\\.",
  "🧠 *AI is thinking\\.\\.\\.*\n\n📊 Mapping topics to exam patterns\\.\\.\\.",
  "✍️ *Preparing your quiz\\.\\.\\.*\n\n🎯 Crafting high\\-quality MCQs from your material\\.\\.\\.",
  "✅ *Verifying answers\\.\\.\\.*\n\n🔎 Cross\\-checking solutions, difficulty and exam relevance\\.\\.\\.",
  "📦 *Finalising your test set\\.\\.\\.*\n\n💾 Saving it to your profile\\.\\.\\.",
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

    const extracted = await extractTextFromPdf(fileId);
    questions = await generateQuestionsFromText(extracted.text, questionCount, language, fileName, extracted.sourceMode);

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
       `❌ *Failed to generate your test\\.*\n\n_Reason: ${escMd(errMsg.slice(0, 200))}_\n\nPlease try again with a clearer PDF or image scan\\. Scanned PDFs are supported, but very blurry pages may need a better upload\\.`,
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
        priceInr: 0,
        priceInStars: 0,
        timerSeconds: 30,
        positiveMarking: 1,
        negativeMarking: 0,
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
    await ctx.answerCallbackQuery();
    const setId = parseInt(ctx.callbackQuery.data.replace("customset_start_", ""), 10);

    const [set] = await db
      .select()
      .from(userCustomSetsTable)
      .where(eq(userCustomSetsTable.id, setId))
      .limit(1);

    if (!set || set.status !== "ready" || !set.isActive) {
      await ctx.reply("❌ Test set not ready yet. Please wait for processing to complete.");
      return;
    }

    const kb = new InlineKeyboard().text("🚀 Start Test", `customset_begin_${set.id}`).row().text("📂 My Sets", "my_custom_sets");
    await ctx.reply(
      `📋 ${set.title}\n\n📝 Questions: ${set.questionCount}\n⏱️ Timer: ${set.timerSeconds} seconds per question\n➕ Correct: +${set.positiveMarking}   ➖ Wrong: -${set.negativeMarking}\n💵 ${set.priceInr > 0 ? `₹${set.priceInr}` : set.priceInStars > 0 ? `${set.priceInStars}⭐` : "Free"}\n🤖 Generated from your PDF\n\nTap Start Test to begin.`,
      { reply_markup: kb },
    );
  });

  bot.callbackQuery(/^customset_begin_/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Choose your starting point" });
    const setId = parseInt(ctx.callbackQuery.data.replace("customset_begin_", ""), 10);
    const userId = ctx.from.id;
    const [set] = await db.select().from(userCustomSetsTable).where(eq(userCustomSetsTable.id, setId)).limit(1);
    if (!set || set.status !== "ready" || !set.isActive) {
      await ctx.reply("❌ Test set not ready yet.");
      return;
    }
    updateSession(userId, {
      pendingCustomPractice: {
        setId: set.id,
        totalQuestions: set.questionCount,
        awaiting: "start",
      },
    });
    await ctx.reply(
      `🔢 This custom test has ${set.questionCount} questions.\n\n` +
      `Enter the question number you want to start from (1-${set.questionCount}).`,
    );
  });

  bot.callbackQuery(/^customset_timer_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.replace("customset_timer_", "").split("_");
    const timerSeconds = Number(parts.pop());
    const setId = Number(parts.join("_"));
    const pending = getSession(ctx.from.id).pendingCustomPractice;
    if (!pending || pending.setId !== setId || pending.awaiting !== "count") return;
    updateSession(ctx.from.id, { pendingCustomPractice: { ...pending, timerSeconds, awaiting: "count" } });
    const counts = [...new Set([5, 10, 20, 30, pending.totalQuestions])]
      .filter((count) => count > 0 && count <= pending.totalQuestions);
    const kb = new InlineKeyboard();
    counts.forEach((count, index) => {
      kb.text(String(count), `customset_count_${setId}_${count}`);
      if ((index + 1) % 3 === 0) kb.row();
    });
    kb.row().text("All", `customset_count_${setId}_all`).text("Cancel", "customset_cancel_practice");
    await ctx.reply(
      `🔢 How many questions do you want to attempt?\n\nTotal available: ${pending.totalQuestions}`,
      { reply_markup: kb },
    );
  });

  bot.callbackQuery(/^customset_count_/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Starting custom test..." });
    const parts = ctx.callbackQuery.data.replace("customset_count_", "").split("_");
    const value = parts.pop()!;
    const setId = Number(parts.join("_"));
    const pending = getSession(ctx.from.id).pendingCustomPractice;
    if (!pending || pending.setId !== setId || pending.startQuestion === undefined) return;
    const count = value === "all" ? pending.totalQuestions : Number(value);
    if (!Number.isInteger(count) || count < 1 || count > pending.totalQuestions) {
      await ctx.reply("❌ Invalid question count.");
      return;
    }
    const [set] = await db.select().from(userCustomSetsTable).where(eq(userCustomSetsTable.id, setId)).limit(1);
    if (!set || set.status !== "ready" || !set.isActive) { await ctx.reply("❌ Test set is no longer available."); return; }
    updateSession(ctx.from.id, { pendingCustomPractice: undefined });
    const { startQuizForUser } = await import("./quiz.js");
    await startQuizForUser(ctx.from.id, {
      testId: `custom_${set.id}`,
      testName: set.title,
      questionsData: set.questionsData,
      timerSeconds: pending.timerSeconds ?? 30,
      positiveMarking: set.positiveMarking,
      negativeMarking: set.negativeMarking,
    }, true, pending.timerSeconds ?? 30, pending.startQuestion, count);
  });

  bot.callbackQuery("customset_cancel_practice", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    updateSession(ctx.from.id, { pendingCustomPractice: undefined });
    try { await ctx.deleteMessage(); } catch {}
  });

  bot.on("message:text", async (ctx, next) => {
    const pending = getSession(ctx.from.id).pendingCustomPractice;
    if (!pending || !/^\d+$/.test(ctx.message.text.trim())) return next();
    const value = Number(ctx.message.text.trim());
    if (pending.awaiting === "start") {
      if (value < 1 || value > pending.totalQuestions) {
        await ctx.reply(`❌ Enter a number between 1 and ${pending.totalQuestions}.`);
        return;
      }
      const kb = new InlineKeyboard()
        .text("15s", `customset_timer_${pending.setId}_15`)
        .text("30s", `customset_timer_${pending.setId}_30`)
        .text("45s", `customset_timer_${pending.setId}_45`).row()
        .text("60s", `customset_timer_${pending.setId}_60`)
        .text("90s", `customset_timer_${pending.setId}_90`)
        .text("Cancel", "customset_cancel_practice");
      updateSession(ctx.from.id, { pendingCustomPractice: { ...pending, startQuestion: value, awaiting: "count" } });
      await ctx.reply("⏱️ Select time allowed per question:", { reply_markup: kb });
      return;
    }
    await ctx.reply("Use the question-count buttons above to continue.");
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
