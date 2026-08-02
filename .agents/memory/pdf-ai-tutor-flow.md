---
name: PDF-grounded AI and tutor flow
description: PDF uploads need real text extraction; Telegram command visibility and conversational tutor state are separate concerns
---

PDF files are binary containers, so scanning printable bytes does not extract document content. Use a real PDF text extractor and reject image-only PDFs with a clear message. Keep the extracted source text in the generation prompt and explicitly require every question to be answerable from that source.

**Why:** The old byte-filter approach produced mostly PDF metadata/garbage, so the model generated generic exam questions unrelated to the uploaded material.

**How to apply:** Preserve document structure as much as possible, cap prompt size, validate the returned question shape, and fail rather than silently saving weak output.

The Telegram command menu must be published with `setMyCommands` at bot startup for commands such as `/ai_tutor` and `/dashboard` to appear in clients. A command that only sends an intro is not an interactive tutor: set a session flag and handle the user's next non-command text in the shared text-message pipeline, with a clear cancel path and usage limit.

**Why:** Bot handlers can exist and typecheck while users still cannot discover or complete the flow.

**How to apply:** Register visible commands on startup, set/reset conversational session state around the response, and keep the free-user limit in the database rather than only in memory.