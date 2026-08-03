---
name: Agentic admin-only mode
description: Current product boundary for Agentic AI and normal bot AI
---

Agentic AI is currently an admin-panel analysis worker, not a user-facing Telegram chat feature. The Analysis page exposes worker status, manual runs, indexed sets/questions, and per-question intelligence. Telegram AI entry points are hidden or disabled.

**Why:** The user explicitly rejected the normal conversational AI experience as “agentic” and wants to inspect the agent's live work before exposing it to users.

**How to apply:** Do not add Agentic buttons back to the bot until the admin monitoring experience proves the worker's behavior and the user explicitly asks for a Telegram-facing agent.