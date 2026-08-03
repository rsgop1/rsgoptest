---
name: PDF custom-set OCR pipeline
description: How custom PDF tests handle selectable and scanned documents
---

Custom PDF tests first try the PDF text layer. If it is too short or unusable, the server renders pages with `pdftoppm` and batches page images into a vision OCR request. The generated MCQ prompt requires grounded questions, 2–3 line solutions, and a government-exam relevance takeaway.

**Why:** Users upload both normal study PDFs and scanned/image-only notes; silently rejecting scanned documents loses the most valuable source material.

**How to apply:** Keep OCR batches bounded, preserve page order, mark unreadable content instead of inventing it, and show progress states for reading resources, scanning pages, preparing the quiz, verifying solutions, and saving the set.