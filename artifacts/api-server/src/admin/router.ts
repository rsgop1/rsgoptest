import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  paymentsTable,
  testSeriesTable,
  purchasedTestsTable,
  globalConfigTable,
} from "@workspace/db";
import { eq, and, count, gte, sql } from "drizzle-orm";
import { layout, statCard, alert } from "./html.js";
import { getApi } from "../bot/api-instance.js";
import { setConfig } from "../bot/handlers/helpers.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "crypto";

const ADMIN_PASSWORD = "rsg@123";
const COOKIE_NAME = "tbadmin";
const COOKIE_SECRET = process.env["SESSION_SECRET"] ?? "fallback-secret-change-me";

const router = Router();

function signValue(value: string): string {
  const crypto = require("crypto") as typeof import("crypto");
  const hmac = crypto.createHmac("sha256", COOKIE_SECRET);
  hmac.update(value);
  return `${value}.${hmac.digest("hex")}`;
}

function verifyValue(signed: string): string | null {
  const parts = signed.split(".");
  if (parts.length < 2) return null;
  const sig = parts.pop()!;
  const value = parts.join(".");
  const crypto = require("crypto") as typeof import("crypto");
  const expected = crypto.createHmac("sha256", COOKIE_SECRET).update(value).digest("hex");
  return sig === expected ? value : null;
}

function isAuthenticated(req: Request): boolean {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return false;
  return verifyValue(cookie) === "admin";
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) return next();
  res.redirect("/admin/login");
}

router.get("/", (_req, res) => res.redirect("/admin/dashboard"));

router.get("/login", (req, res) => {
  if (isAuthenticated(req)) return res.redirect("/admin/dashboard");
  const err = req.query["err"];
  const body = `
    <div class="max-w-sm mx-auto mt-20">
      <h1 class="text-2xl font-bold text-center mb-6">🔐 Admin Login</h1>
      ${err ? alert("Wrong password. Please try again.", "error") : ""}
      <form method="POST" action="/admin/login" class="bg-gray-900 rounded-xl p-6 space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Password</label>
          <input type="password" name="password" autofocus
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500" />
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 rounded-lg py-2 font-semibold transition">
          Login
        </button>
      </form>
    </div>`;
  res.send(layout("Login", body));
});

router.post("/login", (req, res) => {
  const { password } = req.body as { password?: string };
  if (password === ADMIN_PASSWORD) {
    res.cookie(COOKIE_NAME, signValue("admin"), {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });
    return res.redirect("/admin/dashboard");
  }
  res.redirect("/admin/login?err=1");
});

router.get("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect("/admin/login");
});

router.get("/dashboard", requireAuth, async (_req, res) => {
  try {
    const [totalUsers] = await db.select({ cnt: count() }).from(usersTable);
    const [premiumUsers] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.tier, "Premium"));
    const yesterday = new Date(Date.now() - 86400000);
    const [activeToday] = await db.select({ cnt: count() }).from(usersTable).where(gte(usersTable.joinedAt, yesterday));
    const [totalTests] = await db.select({ cnt: count() }).from(testSeriesTable);
    const [pendingPayments] = await db.select({ cnt: count() }).from(paymentsTable).where(eq(paymentsTable.status, "Pending"));
    const upiEarnings = await db.select({ total: sql<number>`COALESCE(SUM(amount),0)` }).from(paymentsTable).where(and(eq(paymentsTable.method, "UPI"), eq(paymentsTable.status, "Approved")));
    const starsEarnings = await db.select({ total: sql<number>`COALESCE(SUM(amount),0)` }).from(paymentsTable).where(and(eq(paymentsTable.method, "TG_Stars"), eq(paymentsTable.status, "Approved")));

    const body = `
      <h1 class="text-3xl font-bold mb-8">📊 Live Dashboard</h1>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        ${statCard("Total Users", totalUsers?.cnt ?? 0, "blue")}
        ${statCard("Premium Users", premiumUsers?.cnt ?? 0, "purple")}
        ${statCard("New (24h)", activeToday?.cnt ?? 0, "green")}
        ${statCard("Test Series", totalTests?.cnt ?? 0, "yellow")}
        ${statCard("Pending Payments", pendingPayments?.cnt ?? 0, "red")}
        ${statCard("UPI Earnings (₹)", upiEarnings[0]?.total ?? 0, "green")}
        ${statCard("Stars Earned (⭐)", starsEarnings[0]?.total ?? 0, "yellow")}
      </div>
      <div class="grid grid-cols-2 gap-4">
        <a href="/admin/payments" class="bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-xl p-5 transition">
          <h3 class="font-semibold text-lg mb-1">🧾 Payment Queue</h3>
          <p class="text-gray-400 text-sm">Review & approve UPI screenshots</p>
        </a>
        <a href="/admin/import" class="bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-xl p-5 transition">
          <h3 class="font-semibold text-lg mb-1">📄 Import Tests</h3>
          <p class="text-gray-400 text-sm">Upload JSON mock test series</p>
        </a>
        <a href="/admin/settings" class="bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-xl p-5 transition">
          <h3 class="font-semibold text-lg mb-1">⚙️ Settings</h3>
          <p class="text-gray-400 text-sm">Broadcast, force-sub, UPI config</p>
        </a>
      </div>`;
    res.send(layout("Dashboard", body, "admin"));
  } catch (err) {
    logger.error({ err }, "Admin dashboard error");
    res.status(500).send(layout("Error", `<p class="text-red-400">Error loading dashboard.</p>`, "admin"));
  }
});

router.get("/payments", requireAuth, async (_req, res) => {
  try {
    const pending = await db.select().from(paymentsTable).where(eq(paymentsTable.status, "Pending")).orderBy(paymentsTable.submittedAt);

    const rows = pending.map((p) => `
      <tr class="border-b border-gray-800">
        <td class="py-3 px-4 text-sm">${p.userId}</td>
        <td class="py-3 px-4 text-sm">${p.method}</td>
        <td class="py-3 px-4 text-sm">₹${p.amount}</td>
        <td class="py-3 px-4 text-sm">${p.testId ?? "Premium"}</td>
        <td class="py-3 px-4 text-sm">${new Date(p.submittedAt).toLocaleString("en-IN")}</td>
        <td class="py-3 px-4 text-sm">
          ${p.screenshotFileId ? `<a href="/admin/payment-image/${p.screenshotFileId}" target="_blank" class="text-blue-400 hover:underline">View Screenshot</a>` : "—"}
        </td>
        <td class="py-3 px-4 text-sm flex gap-2">
          <form method="POST" action="/admin/payments/approve/${p.paymentId}">
            <button class="bg-green-700 hover:bg-green-600 px-3 py-1 rounded text-xs font-semibold transition">✅ Approve</button>
          </form>
          <form method="POST" action="/admin/payments/reject/${p.paymentId}">
            <button class="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs font-semibold transition">❌ Reject</button>
          </form>
        </td>
      </tr>`).join("");

    const body = `
      <h1 class="text-3xl font-bold mb-6">🧾 UPI Payment Queue</h1>
      ${!pending.length ? `<div class="bg-gray-900 rounded-xl p-8 text-center text-gray-400">No pending payments 🎉</div>` : `
      <div class="overflow-x-auto bg-gray-900 rounded-xl">
        <table class="w-full">
          <thead class="text-left text-gray-400 text-xs uppercase border-b border-gray-800">
            <tr>
              <th class="py-3 px-4">User ID</th>
              <th class="py-3 px-4">Method</th>
              <th class="py-3 px-4">Amount</th>
              <th class="py-3 px-4">Test</th>
              <th class="py-3 px-4">Submitted</th>
              <th class="py-3 px-4">Screenshot</th>
              <th class="py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`}`;
    res.send(layout("Payments", body, "admin"));
  } catch (err) {
    logger.error({ err }, "Admin payments error");
    res.status(500).send("Error");
  }
});

router.get("/payment-image/:fileId", requireAuth, async (req, res) => {
  try {
    const api = getApi();
    const file = await api.getFile(req.params["fileId"]!);
    const token = process.env["TELEGRAM_BOT_TOKEN"]!;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) { res.status(404).send("Image not found"); return; }
    const buffer = await response.arrayBuffer();
    res.set("Content-Type", "image/jpeg");
    res.send(Buffer.from(buffer));
  } catch (err) {
    logger.error({ err }, "Error fetching payment image");
    res.status(500).send("Error fetching image");
  }
});

router.post("/payments/approve/:paymentId", requireAuth, async (req, res) => {
  try {
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.paymentId, req.params["paymentId"]!))
      .limit(1);

    if (!payment) { res.redirect("/admin/payments"); return; }

    await db.update(paymentsTable).set({ status: "Approved" }).where(eq(paymentsTable.paymentId, payment.paymentId));

    if (payment.testId && payment.testId !== "premium") {
      await db.insert(purchasedTestsTable).values({ userId: payment.userId, testId: payment.testId }).catch(() => {});
      const api = getApi();
      await api.sendMessage(payment.userId,
        `✅ *Payment Approved\\!*\n\nAapka UPI payment verify ho gaya\\! 🎉\nTest unlock ho gaya hai\\. /test\\_series se access karein\\.`,
        { parse_mode: "MarkdownV2" }
      ).catch(() => {});
    } else {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      await db.update(usersTable).set({ tier: "Premium", premiumExpiry: expiry }).where(eq(usersTable.userId, payment.userId));
      const api = getApi();
      await api.sendMessage(payment.userId,
        `✅ *Premium Approved\\!*\n\nAapka payment verify ho gaya\\! 💎\nTestbook\\+ Premium activate ho gaya hai — 30 days\\.\n\n/test\\_series se saare tests access karein\\.`,
        { parse_mode: "MarkdownV2" }
      ).catch(() => {});
    }
    res.redirect("/admin/payments");
  } catch (err) {
    logger.error({ err }, "Error approving payment");
    res.redirect("/admin/payments");
  }
});

router.post("/payments/reject/:paymentId", requireAuth, async (req, res) => {
  try {
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.paymentId, req.params["paymentId"]!))
      .limit(1);

    if (payment) {
      await db.update(paymentsTable).set({ status: "Rejected" }).where(eq(paymentsTable.paymentId, payment.paymentId));
      const api = getApi();
      await api.sendMessage(payment.userId,
        `❌ *Payment Rejected*\n\nAapka payment screenshot verify nahi ho saka\\.\nKripya sahi screenshot bhejein ya admin se contact karein\\.`,
        { parse_mode: "MarkdownV2" }
      ).catch(() => {});
    }
    res.redirect("/admin/payments");
  } catch (err) {
    logger.error({ err }, "Error rejecting payment");
    res.redirect("/admin/payments");
  }
});

router.get("/import", requireAuth, (_req, res) => {
  const body = `
    <h1 class="text-3xl font-bold mb-6">📄 Import Test Series</h1>
    <div class="bg-gray-900 rounded-xl p-6 max-w-2xl">
      <form method="POST" action="/admin/import" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Test Name *</label>
            <input name="testName" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Test ID (unique) *</label>
            <input name="testId" required placeholder="e.g. STENO_MOCK_01" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Main Category *</label>
            <select name="mainCategory" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
              <option>SSC Exams</option>
              <option>Railway Exams</option>
              <option>Banking Exams</option>
              <option>Bihar Govt Exams</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Sub Category *</label>
            <input name="subCategory" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Positive Marking</label>
            <input name="positiveMarking" type="number" step="0.25" value="1" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Negative Marking</label>
            <input name="negativeMarking" type="number" step="0.25" value="0.25" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Price (₹)</label>
            <input name="priceInr" type="number" value="0" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Price (Stars ⭐)</label>
            <input name="priceInStars" type="number" value="0" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
          </div>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Questions JSON * <span class="text-gray-500">(array of {question, options[], correctOptionIndex, explanation})</span></label>
          <textarea name="questionsJson" rows="12" required
            placeholder='[{"question":"Q1?","options":["A","B","C","D"],"correctOptionIndex":0,"explanation":"Explanation here"}]'
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-blue-500"></textarea>
        </div>
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-semibold transition">
          📥 Import Test Series
        </button>
      </form>
    </div>`;
  res.send(layout("Import Tests", body, "admin"));
});

router.post("/import", requireAuth, async (req, res) => {
  try {
    const { testId, testName, mainCategory, subCategory, positiveMarking, negativeMarking, priceInr, priceInStars, questionsJson } = req.body as Record<string, string>;
    let questions: unknown[];
    try {
      questions = JSON.parse(questionsJson ?? "[]");
      if (!Array.isArray(questions)) throw new Error("Not an array");
    } catch {
      res.send(layout("Import Tests", `<div class="text-red-400">❌ Invalid JSON format. Please check your questions array.</div><br/><a href="/admin/import" class="text-blue-400">← Back</a>`, "admin"));
      return;
    }

    const questionsWithIds = questions.map((q: any, i: number) => ({
      id: `${testId}_q${i}`,
      question: q.question ?? "",
      options: q.options ?? [],
      correctOptionIndex: q.correctOptionIndex ?? 0,
      explanation: q.explanation ?? "",
    }));

    await db.insert(testSeriesTable).values({
      testId,
      testName,
      mainCategory,
      subCategory,
      positiveMarking: parseFloat(positiveMarking ?? "1"),
      negativeMarking: parseFloat(negativeMarking ?? "0.25"),
      priceInr: parseInt(priceInr ?? "0"),
      priceInStars: parseInt(priceInStars ?? "0"),
      questionsData: questionsWithIds,
    }).onConflictDoUpdate({
      target: testSeriesTable.testId,
      set: {
        testName,
        mainCategory,
        subCategory,
        positiveMarking: parseFloat(positiveMarking ?? "1"),
        negativeMarking: parseFloat(negativeMarking ?? "0.25"),
        priceInr: parseInt(priceInr ?? "0"),
        priceInStars: parseInt(priceInStars ?? "0"),
        questionsData: questionsWithIds,
      },
    });

    res.send(layout("Import Tests", `<div class="text-green-400">✅ Test series "${testName}" imported successfully with ${questionsWithIds.length} questions!</div><br/><a href="/admin/import" class="text-blue-400">← Import another</a> | <a href="/admin/dashboard" class="text-blue-400">Dashboard →</a>`, "admin"));
  } catch (err) {
    logger.error({ err }, "Error importing test");
    res.send(layout("Import Tests", `<div class="text-red-400">❌ Error importing test. Check if Test ID already exists or try again.</div><br/><a href="/admin/import" class="text-blue-400">← Back</a>`, "admin"));
  }
});

router.get("/settings", requireAuth, async (_req, res) => {
  try {
    const configs = await db.select().from(globalConfigTable);
    const cfg = Object.fromEntries(configs.map((c) => [c.key, c.value]));

    const body = `
      <h1 class="text-3xl font-bold mb-6">⚙️ Settings</h1>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-gray-900 rounded-xl p-6">
          <h2 class="text-lg font-semibold mb-4">💳 UPI Configuration</h2>
          <form method="POST" action="/admin/settings/config" class="space-y-3">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Admin UPI VPA</label>
              <input name="admin_upi_vpa" value="${cfg["admin_upi_vpa"] ?? ""}" placeholder="yourname@upi"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
            </div>
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-semibold transition">Save UPI Config</button>
          </form>
        </div>

        <div class="bg-gray-900 rounded-xl p-6">
          <h2 class="text-lg font-semibold mb-4">🔒 Force Subscribe</h2>
          <form method="POST" action="/admin/settings/config" class="space-y-3">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Channel Username (e.g. @mychannel)</label>
              <input name="force_sub_channel" value="${cfg["force_sub_channel"] ?? ""}" placeholder="@channelname"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
            </div>
            <div class="flex items-center gap-3">
              <label class="text-sm text-gray-400">Enable Force Subscribe:</label>
              <select name="force_sub_enabled" class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="false" ${cfg["force_sub_enabled"] !== "true" ? "selected" : ""}>Disabled</option>
                <option value="true" ${cfg["force_sub_enabled"] === "true" ? "selected" : ""}>Enabled</option>
              </select>
            </div>
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-semibold transition">Save Force-Sub Config</button>
          </form>
        </div>

        <div class="bg-gray-900 rounded-xl p-6 md:col-span-2">
          <h2 class="text-lg font-semibold mb-4">📢 Broadcast Message</h2>
          <form method="POST" action="/admin/settings/broadcast" class="space-y-3">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Target Audience</label>
              <select name="target" class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="all">All Users</option>
                <option value="free">Free Tier Only</option>
                <option value="premium">Premium Tier Only</option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Message (Markdown supported)</label>
              <textarea name="message" rows="4" placeholder="Your broadcast message..."
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"></textarea>
            </div>
            <button type="submit" class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg text-sm font-semibold transition">🚀 Send Broadcast</button>
          </form>
        </div>
      </div>`;
    res.send(layout("Settings", body, "admin"));
  } catch (err) {
    logger.error({ err }, "Admin settings error");
    res.status(500).send("Error");
  }
});

router.post("/settings/config", requireAuth, async (req, res) => {
  try {
    const body = req.body as Record<string, string>;
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) await setConfig(key, String(value));
    }
    res.redirect("/admin/settings");
  } catch (err) {
    logger.error({ err }, "Error saving config");
    res.redirect("/admin/settings");
  }
});

router.post("/settings/broadcast", requireAuth, async (req, res) => {
  try {
    const { target, message } = req.body as { target: string; message: string };
    if (!message?.trim()) { res.redirect("/admin/settings"); return; }

    let query = db.select({ userId: usersTable.userId }).from(usersTable);
    let users: { userId: number }[];
    if (target === "free") {
      users = await db.select({ userId: usersTable.userId }).from(usersTable).where(eq(usersTable.tier, "Free"));
    } else if (target === "premium") {
      users = await db.select({ userId: usersTable.userId }).from(usersTable).where(eq(usersTable.tier, "Premium"));
    } else {
      users = await db.select({ userId: usersTable.userId }).from(usersTable);
    }

    const api = getApi();
    let sent = 0;
    let failed = 0;
    for (const u of users) {
      try {
        await api.sendMessage(u.userId, `📢 *Admin Broadcast*\n\n${message}`, { parse_mode: "Markdown" });
        sent++;
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        failed++;
      }
    }

    res.send(layout("Broadcast Result", `<div class="text-green-400">✅ Broadcast sent! ${sent} delivered, ${failed} failed.</div><br/><a href="/admin/settings" class="text-blue-400">← Back to Settings</a>`, "admin"));
  } catch (err) {
    logger.error({ err }, "Broadcast error");
    res.redirect("/admin/settings");
  }
});

export default router;
