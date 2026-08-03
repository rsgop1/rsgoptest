import { logger } from "../lib/logger.js";
import { BOT_FUNCTIONS_MANUAL } from "./manual.js";
import { getConfig } from "./handlers/helpers.js";

type ChatContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
type ChatMessage = { role: "system" | "user" | "assistant"; content: ChatContent };

export const BOT_HELP_CONTEXT = `
You are the AI assistant inside Series TestPro Telegram bot.
Working features:
- /start: home, exam category selection, referral link and quick actions
- /test_series: browse tests; users see test details, timer, marking, then Start Test
- /createtest: Premium users upload a selectable-text PDF; AI creates source-grounded MCQs
- /mysets: view, share and start custom PDF test sets
- AI Space: active Premium users can analyse their completed tests and chat about bot problems, tests, and academic doubts
- AI Info button: explains a question, correct answer and wrong options from the solution screen
- /dashboard and /profile: progress, wrong notebook, Premium status and remaining days
- /support: category selection followed by a written issue creates a support ticket
- /premium: upgrade or renew Premium
- /stats and /notebook: performance and wrong-question practice
When a user reports a bot problem, first explain the correct command or button path. If it still needs human help, tell them to use /support and include the category and details. Legacy AI commands are not the supported entry point; send users to /menu and AI Space.
`;

export const BOT_AGENT_CONTEXT = `${BOT_HELP_CONTEXT}

Authoritative operating manual:
${BOT_FUNCTIONS_MANUAL}

Use the manual as product truth, but use live database context as truth for personal metrics.`;

export async function askOpenRouter(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; json?: boolean } = {},
): Promise<string> {
  const provider = (await getConfig("ai_provider")) ?? "openrouter";
  const configuredModel = await getConfig("ai_model");
  const model = configuredModel || (provider === "openai" ? "gpt-4o-mini" : provider === "gemini" ? "gemini-2.0-flash" : "openai/gpt-4o-mini");
  if (provider === "gemini") {
    const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
    if (!apiKey) throw new Error("Gemini AI is not configured");
    const parts = messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: typeof message.content === "string"
        ? [{ text: message.content }]
        : message.content.map((part) => part.type === "text"
          ? { text: part.text }
          : { inlineData: { mimeType: "image/png", data: part.image_url.url.split(",")[1] ?? "" } }),
    }));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: messages.find((message) => message.role === "system")?.content
          ? { parts: [{ text: String(messages.find((message) => message.role === "system")!.content) }] }
          : undefined,
        contents: parts.filter((message) => message.role !== "model" || messages.some((item) => item.role === "assistant")),
        generationConfig: { temperature: options.temperature ?? 0.3, maxOutputTokens: options.maxTokens ?? 8192 },
      }),
    });
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
    if (!response.ok || data.error) throw new Error(data.error?.message ?? `Gemini request failed: ${response.status}`);
    return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
  }
  const apiKeyName = provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
  const apiKey = process.env[apiKeyName] ??
    (provider === "openrouter" ? process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"] : undefined);
  const baseUrl = provider === "openai"
    ? "https://api.openai.com/v1"
    : process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error(`${provider === "openai" ? "OpenAI" : "OpenRouter"} AI is not configured`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 8192,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok || data.error) {
    logger.error({ status: response.status, error: data.error }, "OpenRouter request failed");
    throw new Error(data.error?.message ?? `OpenRouter request failed: ${response.status}`);
  }
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function askOpenRouterVision(
  prompt: string,
  imageDataUrls: string[],
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    { type: "text", text: prompt },
    ...imageDataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  return askOpenRouter([
    { role: "system", content: "You are a careful document OCR specialist. Transcribe only visible content, preserve equations, names, dates, tables and answer choices, and mark unreadable words as [unclear]. Do not invent missing text." },
    { role: "user", content },
  ], { ...options, temperature: options.temperature ?? 0.1 });
}