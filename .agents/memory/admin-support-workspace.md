---
name: Admin support workspace
description: Admin support tickets must use the support_tickets table and stay separate from question reports
---

The admin panel has a dedicated Support Inbox backed by the support_tickets table, with server-side search and filters plus persistent status, priority, and admin-note updates.

**Why:** The original React admin panel had no support-ticket route or API endpoint, so Telegram tickets existed in the database but were invisible to admins.

**How to apply:** Keep `/support` for customer support tickets and `/reports` for question-quality reports; do not derive ticket priority or category from report text when the support schema already stores those fields.