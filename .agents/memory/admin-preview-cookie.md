---
name: Admin preview cookie
description: Admin API authentication must account for Replit preview proxy protocol.
---

Admin login cookies should set `Secure` and `SameSite=None` only when the request actually arrived over HTTPS; Replit preview can use an internal HTTP hop, where a forced Secure cookie is dropped and all React admin API calls return 401.

**Why:** The React admin panel appeared empty even though the database and endpoint were healthy because the browser never sent the forced Secure cookie in preview.

**How to apply:** Derive the flag from `req.secure` or `x-forwarded-proto`, and use a non-Secure Lax cookie for HTTP preview requests.