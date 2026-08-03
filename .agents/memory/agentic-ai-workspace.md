---
name: Agentic AI workspace
description: Agentic AI inline workspace and background question intelligence
---

Agentic AI is the primary AI entry point in the Telegram Study Hub. It uses inline callbacks for opening, tools, clear, and back-home; active room messages are tracked for cleanup. Old AI commands remain compatibility fallbacks.

**Why:** Users should not need to remember commands for the main AI experience, and the bot chat should stay clean after leaving the AI room.

**How to apply:** Use the user's real profile and completed-attempt context for personalized replies. Keep background set/question analysis bounded and cached, with periodic refreshes rather than an unbounded request loop.