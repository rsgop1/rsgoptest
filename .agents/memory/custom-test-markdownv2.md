---
name: Custom Test + MarkdownV2 Gotchas
description: Debug lessons from the custom test creation flow — MarkdownV2 escaping errors cause silent failures via bot.catch
---

## MarkdownV2: `=` inside italic blocks must be escaped

In `parse_mode: "MarkdownV2"`, the `=` character is reserved even inside italic `_..._` blocks.  
`_More questions = more processing time_` will throw `400: Character '=' is reserved and must be escaped with the preceding '\'`.

**Fix in template literals:** use `\\=` to produce the string `\=`, which Telegram displays as `=`.

## Silent failures from bot.catch

The bot has a `bot.catch()` handler that logs unhandled errors. When a callback query handler's reply throws (e.g. from MarkdownV2 parse errors), the error is caught by `bot.catch`, the callback query is answered (so the button stops loading), but NO message is sent to the user. This makes it appear to the user that clicking the button did nothing.

Always check `bot.catch` logs when a callback handler seems to "do nothing" — the handler probably fired but its response threw.

## Preference: editMessageText over delete+reply

Using `ctx.editMessageText()` to update the inline keyboard message is more reliable than `ctx.deleteMessage()` + `ctx.reply()`. It avoids:
- Race conditions when the delete arrives before the new message
- Callback query message_id becoming stale after deletion
- Better UX — no message flashing
