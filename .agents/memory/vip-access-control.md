---
name: VIP access control
description: Durable rules for Premium-based Telegram VIP group access
---

VIP access is tied to the existing Premium tier and expiry timestamp. The bot creates a one-member, expiring Telegram invite link when Premium is activated or an admin sync is run, and a periodic sweep removes expired users from the VIP group.

**Why:** Telegram invite links cannot cryptographically bind a link to one specific user, so the link is limited to one join and access is enforced again through expiry removal.

**How to apply:** Keep the VIP group ID, enabled flag, access code, and welcome message in global config. The bot must be an administrator with invite and ban permissions. Treat the admin test-message and broadcast controls as explicit actions, not automatic recurring sends.