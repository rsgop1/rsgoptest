---
name: Bot AI, support, and profile flows
description: Shared OpenRouter AI and Telegram Markdown safety decisions for user-facing bot flows
---

All bot AI features should call the shared OpenRouter helper so the user-provided key, base URL, model, error handling, and bot capability context stay consistent across PDF MCQ generation, doubt solving, tutor, AI Info, and inline AI tools.

**Why:** Separate direct fetch implementations drifted in model choice and error handling, making some AI features work while others failed.

**How to apply:** Add new AI behavior through the helper and extend its bot-working-context prompt when the product gains a new user-facing command.

User-facing messages containing user data should avoid MarkdownV2 unless every dynamic value is escaped. Plain text is safer for support confirmations and profile/start summaries; use MarkdownV2 only for carefully controlled templates.

**Why:** Unescaped `>`, `.`, `#`, and underscores caused `/start`, `/ai_tutor`, and support flows to fail after their database work had already succeeded.

**How to apply:** Prefer plain text for dynamic summaries and always inspect Telegram parse errors in bot logs before changing business logic.