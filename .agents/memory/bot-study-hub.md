---
name: Bot Study Hub navigation
description: Navigation and cleanup conventions for the Telegram bot experience
---

The bot's primary UX is a single editable inline-button Study Hub, while the command menu remains available for compatibility and power users. Test poll messages should be tracked in the quiz session and deleted when a test ends or is stopped; live group polls should be tracked per live session and removed before final results.

**Why:** A single editable surface feels more like a premium app and prevents chats from filling with navigation and stale poll messages.

**How to apply:** Add new top-level bot features as Study Hub callbacks first, then keep or add a command fallback. Keep callback navigation focused on editing the current message; send separate messages only for active test questions, payment flows, or user-entered AI responses.