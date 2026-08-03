---
name: AI Space session behavior
description: Telegram AI Space formatting, context, and idle-session rules
---

AI Space is Premium-only and behaves as an active workspace session. It renders AI emphasis through Telegram HTML rather than sending Markdown markers literally, gives the model test titles plus question-level user/correct answers and explanations, and clears tracked AI messages after five minutes without interaction.

**Why:** Telegram was displaying `**bold**` as plain text, and users need personalized mistake analysis without exposing internal test IDs or leaving stale AI chats active.

**How to apply:** Keep dynamic AI replies HTML-escaped before converting supported emphasis. Preserve title-only user-facing analytics, include question-level mistake evidence, refresh the idle timer on workspace opens, button clicks, and messages, and clear the session after five idle minutes.