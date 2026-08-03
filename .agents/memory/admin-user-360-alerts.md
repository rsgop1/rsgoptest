---
name: Admin user 360 and alerts
description: Admin profile and operational alert architecture
---

Admin user management uses one consolidated 360 response for identity, access, test history, payments, coupon redemptions, support, custom sets, achievements, and risk summaries. Dashboard alerts are derived server-side from pending payments, expiring Premium, stale/failed custom sets, overdue support, and VIP failures.

**Why:** Separate page-specific queries made high-context user decisions slow and made operational issues easy to miss.

**How to apply:** Extend the 360 contract for new user-domain data instead of adding scattered requests; add actionable alert types with a direct admin route and severity.