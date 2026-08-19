---
name: Premium web mock tests
description: Security and continuity rules for moving Premium test attempts from Telegram to web
---

Premium web test access is issued from Telegram as a short-lived signed token bound to both the Telegram user and test ID. The learner API must re-check active Premium status on session, test, and attempt requests; never trust a bare test ID from the browser.

**Why:** The web runner is a continuation of the Telegram product, not a public test catalog, so access must remain Premium-only while preserving shared history and analytics.

**How to apply:** Keep Telegram and web attempts writing the same user-history model. After a web submission, refresh the in-memory Telegram solution session so the result message's View Solutions action works. Configure the public web base URL rather than deriving production URLs from development environment variables.

The Telegram handoff URL is normalized centrally and must point to the learner artifact's `/testbook-web/` path. A missing `web_app_url` config row can make old or newly generated Telegram buttons appear to do nothing; seed the current public URL for development and update it to the published URL after deployment.

**Why:** Telegram URL buttons contain the target at message creation time, so fixing the builder does not repair an already-sent message.

**How to apply:** Ask the learner to re-open the test series and generate a fresh test-detail message after changing the URL configuration.