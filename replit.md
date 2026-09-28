# Testbook+ Educational Hub Bot

A full-featured Telegram educational bot (like Testbook+) with quiz engine, payments, AI doubt solver placeholder, and a web admin panel.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Telegram bot (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned by Replit)
- Required secret: `TELEGRAM_BOT_TOKEN` — from BotFather
- Optional secret: `SESSION_SECRET` — for admin panel cookie signing

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Telegram Bot: Grammy v1.x (long polling)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- QR Code: `qrcode` (for UPI payment QRs)
- Build: esbuild (ESM bundle) — Grammy and qrcode are externalized

## Where things live

- `lib/db/src/schema/` — Database schema (users, test_series, payments, etc.)
- `artifacts/api-server/src/bot/` — Telegram bot code (Grammy)
- `artifacts/api-server/src/bot/handlers/` — All bot command/callback handlers
- `artifacts/api-server/src/admin/` — Web admin panel (Express routes + HTML)
- `artifacts/api-server/src/app.ts` — Express app (mounts `/api` and `/admin`)
- `artifacts/api-server/src/index.ts` — Entry point (starts Express + bot)

## Architecture decisions

- Grammy long polling (not webhook) — simpler for Replit, no SSL cert needed
- In-memory Map for active quiz sessions — fast, no DB round trips during quiz
- Bot API singleton (`api-instance.ts`) — avoids circular imports between bot/index and handlers
- React admin panel is the single admin UI at `/admin-panel/`; the API server only exposes `/api/admin` and redirects the legacy `/admin` path
- esbuild externalizes `grammy` and `qrcode` — both use dynamic requires incompatible with bundling

## Product

- `/start` — User onboarding with category → subcategory selection (SSC/Railway/Banking/Bihar)
- `/test_series` — Browse and start mock tests; locked tests show payment options
- Quiz engine — Native Telegram polls, 30s per question timer, auto-skip on timeout
- Scorecard — Score, accuracy, global rank after test completion
- Solution book — Paginated review of all questions with correct/wrong highlighting
- `/notebook` — Practice from previously wrong questions
- `/premium` — Upgrade via Telegram Stars or UPI QR payment
- `/doubt` — AI doubt solver placeholder (OpenRouter integration ready to add)
- Admin Panel at `/admin-panel/` — Login: `rsg@123`
  - Dashboard with live stats
  - UPI payment approval queue with screenshot viewer
  - JSON test series import wizard
  - Broadcast, force-subscribe toggle, UPI VPA settings

## User preferences

- Admin panel password: `rsg@123`
- AI integration: placeholder only — user will add OpenRouter later
- Database: Replit built-in PostgreSQL (no MongoDB)
- Stack: Node.js/Grammy (not Python)

## Gotchas

- Always run `pnpm --filter @workspace/db run push` after schema changes
- Grammy and qrcode must stay in `external` in `build.mjs` (native module issues with esbuild)
- Bot runs in long polling mode — only one instance should run at a time
- Quiz session state is in-memory — restarts clear active quizzes
- For Telegram Stars payments, `provider_token` must be empty string and currency must be `"XTR"`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Grammy docs: https://grammy.dev
- Admin panel: yourapp.replit.app/admin
