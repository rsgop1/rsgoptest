import { logger } from "../lib/logger.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export const BOT_HELP_CONTEXT = `
You are the AI assistant inside Series TestPro Telegram bot.
Working features:
- /start: home, exam category selection, referral link and quick actions
- /test_series: browse tests; users see test details, timer, marking, then Start Test
- /createtest: Premium users upload a selectable-text PDF; AI creates source-grounded MCQs
- /mysets: view, share and start custom PDF test sets
- /ai_tutor: conversational exam tutor
- /doubt: one-command doubt solver
- AI Info button: explains a question, correct answer and wrong options from the solution screen
- /dashboard and /profile: progress, wrong notebook, Premium status and remaining days
- /support: category selection followed by a written issue creates a support ticket
- /premium: upgrade or renew Premium
- /stats and /notebook: performance and wrong-question practice
When a user reports a bot problem, first explain the correct command or button path. If it still needs human help, tell them to use /support and include the category and details.
`;

export async function askOpenRouter(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; json?: boolean } = {},
): Promise<string> {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];
  const baseUrl = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OpenRouter AI is not configured");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
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