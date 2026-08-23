# xdesk — agent instructions

Telegram bot that ghost-writes X posts with Claude and delivers them as
tap-to-copy cards. The user posts manually; there is no X write access.

## Commands

- `npm run dev` — run with watch (tsx)
- `npm start` — run once
- `npm run typecheck` — `tsc --noEmit`; this is the main verification gate
- `npx tsx scripts/writer-smoke.mts` — one real end-to-end writer call
  (costs a small model call; don't run it casually)

There is no test framework. Verify changes with the typecheck plus small
throwaway `tsx` scripts against a scratch `DB_PATH` — never against
`./data/xdesk.sqlite`, which is live user data.

## Architecture

One Node process. `src/index.ts` boots config → db → bot (grammY long
polling) → cron jobs.

- `src/writers/` — the Writer abstraction. **All model calls go through
  `getWriter()`**; never import an SDK or spawn `claude` elsewhere.
  `cli.ts` runs `claude -p --safe-mode --json-schema` (subscription-billed,
  max-turns 3, sandbox cwd); `api.ts` is the Anthropic SDK with a cached
  system block. Structured output is zod-validated in both.
- `src/gen/` — prompt building and content logic: `posts.ts` (generation +
  guard-retry loop), `guards.ts` (deterministic checks), `plan.ts` (weekly
  plan), `recap.ts` (friday recap), `mix.ts` (weekly-mix config),
  `voice.ts` / `voice-rebuild.ts` (voice.md access + weekly rebuild).
- `src/bot/` — Telegram: `cards.ts` (render/send/refresh, edit in place),
  `callbacks.ts` (button actions), `notes.ts` (plain text = note; replies =
  edits/plan edits), `commands.ts`, `md.ts` (MarkdownV2 escaping — use it
  for every user-visible string outside code spans).
- `src/jobs/` — node-cron registrations; all times run in `config.tz`.
- `src/db/index.ts` — better-sqlite3, idempotent schema, all queries.
  Timestamps are ISO strings; timezone math lives in `src/util.ts`.

## Invariants — do not break

- **Grounding**: a post may only contain numbers present in the data block,
  a note, or facts.md — enforced in `guards.ts`, not by prompt alone. Guard
  failures are fed back and regenerated (max 2), then delivered flagged.
- **Billing safety**: with `WRITER=cli` the process must refuse to start if
  `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` is set (see `config.ts`).
- **Privacy split**: `.env`, `voice.md`, `facts.md`, `data/`, `logs/` are
  gitignored personal files. The tracked tree is de-personalized — never
  add real product names, user ids, tokens, cities, or paths containing a
  username to tracked files. Templates use placeholders.
- **Single user**: the bot answers exactly `TELEGRAM_USER_ID`; keep the
  allowlist middleware first.
- Runtime-tunable state lives in the `settings` table (`weekly_mix`,
  `launch.status`, `paused`, `product_pillar`); boot config lives in env.
  Prefer settings for anything the user may change from Telegram.

## Conventions

- ESM TypeScript, strict; relative imports carry the `.js` suffix.
- User-visible bot strings are lowercase, matching the product's register.
- Comments only for constraints the code can't show.
- Deployed instances run under launchd/systemd — code changes need a
  service restart to take effect; `voice.md`/`facts.md` are re-read every
  generation and do not.

## Roadmap context

Phases 1–2 are built (posts, plan, recap, voice rebuild). Phases 3–4
(X-read reply lanes, mentions) are not: the `items` schema, `seen_posts`
table, and env placeholders for them already exist — extend, don't rename.
