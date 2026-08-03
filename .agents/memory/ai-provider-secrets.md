---
name: AI provider secrets
description: Security boundary for configurable AI providers
---

The admin panel may select the active AI provider, model, and scanned-PDF OCR behavior, but raw provider keys must remain in Replit Secrets. The API server reads provider-specific secrets at runtime and the panel only shows configured/missing status.

**Why:** Letting a browser form write arbitrary API keys into application storage would expose credentials and create an unnecessary secret-management privilege.

**How to apply:** Use the secure Secrets flow for `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY`; then select the provider in AI Settings and restart the API workflow when needed.