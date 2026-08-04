---
name: Premium web mock tests
description: Security and continuity rules for moving Premium test attempts from Telegram to web
---

Premium web test access is issued from Telegram as a short-lived signed token bound to both the Telegram user and test ID. The learner API must re-check active Premium status on session, test, and attempt requests; never trust a bare test ID from the browser.

**Why:** The web runner is a continuation of the Telegram product, not a public test catalog, so access must remain Premium-only while preserving shared history and analytics.

**How to apply:** Keep Telegram and web attempts writing the same user-history model. Configure the public web base URL rather than deriving production URLs from development environment variables.