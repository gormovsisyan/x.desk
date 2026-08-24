# xdesk

**Claude writes, Telegram delivers, you post.**

xdesk is a personal ghostwriting desk for X. Twice a day it writes a post in
your voice and sends it to Telegram as a tap-to-copy card — you post it from
the X app yourself. The bot has **no X write access, ever**. It learns from
what you approve, edit, and skip.

- Grounded by construction: posts can only use your voice file, your facts
  file, your notes, and live numbers (npm downloads, GitHub stars, git
  history). Every number is checked against its source before a card ships.
- Two interchangeable writers: `claude -p` on a Claude subscription (no API
  key, $0) or the Anthropic API — switch with one env var.
- A weekly plan, a daily material check, a git-grounded Friday recap, and a
  weekly rebuild of the voice file from your approved posts.

## Requirements

- Node 22+
- A Telegram bot token (free, via [@BotFather](https://t.me/BotFather))
- One of:
  - [Claude Code](https://claude.com/claude-code) installed and logged in
    (`claude auth status` exits 0) — the default, runs on your subscription
  - an Anthropic API key (`WRITER=api`)

## Setup

```bash
git clone <repo-url> xdesk && cd xdesk
npm install
cp .env.example .env
cp voice.example.md voice.md
cp facts.example.md facts.md
```

**1. Create the Telegram bot.** Message [@BotFather](https://t.me/BotFather)
→ `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`. Get your numeric user
id from [@userinfobot](https://t.me/userinfobot) and put it in
`TELEGRAM_USER_ID`. The bot answers only that id and treats any plain message
as a note.

**2. Fill the two personality files.** They are gitignored — they're you.

- `voice.md` — register rules, weekly pillar mix, banned phrases, and (most
  importantly) ~40 of your real posts in the examples section.
- `facts.md` — everything the bot may state as true. Anything not in this
  file is unknown to the writer by instruction.

**3. Point it at your numbers** in `.env`:

```
NPM_PACKAGES=your-package            # weekly downloads in the data block
GITHUB_REPOS=you/your-repo           # stars + open issues (public repos)
REPO_PATHS=/abs/path/to/your-repo    # git history for the friday recap
TZ=Europe/Berlin                     # your timezone
SLOTS=18:00,22:00                    # posting slots, cards arrive 15 min early
```

**4. Choose a writer.**

- `WRITER=cli` (default): uses `claude -p` on your subscription. The
  environment must **not** contain `ANTHROPIC_API_KEY` — the bot refuses to
  start if it does, because the CLI would silently bill the API instead.
  Check `claude auth status` exits 0 first.
- `WRITER=api`: set `ANTHROPIC_API_KEY`. Same code, Messages API, prompt
  caching, ~$0.05 per post.

**5. Run it.**

```bash
npm run dev          # watch mode
npx tsx scripts/writer-smoke.mts   # optional: one tiny end-to-end writer call
```

Send the bot `/start`, then `/gen` — your first card arrives in ~30–60 s.

## The cards

```
📝 18:00 · building in public
`yourpkg crossed 1,400 npm downloads this week. no launch post…`
first reply: `https://www.npmjs.com/package/yourpkg`
231/280 · from: tue note + npm weekly
[Another] [Edit] [Posted ✓] [Skip] [Snooze 30m]
```

- **Another** regenerates with a different angle (max 3, then it asks you for
  a note instead).
- **Edit** — or simply reply to the card — replaces the text. Edits are the
  strongest training signal.
- **Posted ✓** saves the post as a voice example and consumes the notes it
  was built on. **Skip** records a rejection the writer must avoid resembling.
- No reaction → one silent nudge at T+20, then the card is marked missed.

## The week

| When | What |
|---|---|
| daily, T−15 before each slot | a post card, planned or fallback-picked |
| daily 10:00 | material check: one question if a planned slot has no source, else silence |
| friday, first slot | recap (downloads / shipped / broke / learned / next week) grounded in your repos' actual `git log` |
| sunday 19:00 | voice.md examples rebuilt from approved posts, avoid-list from rejections |
| sunday 20:00 | next week's 14-slot plan arrives as a digest — tap Regenerate or reply in plain text ("swap tue 22:00 for a product post") |

## Guards

Every draft is checked in code before it reaches you; failures are fed back
and silently regenerated (max 2), and a still-failing draft arrives flagged
⚠️ rather than silently dropped:

≤ 280 weighted chars (`twitter-text`) · lowercase only · no hashtags, emoji,
@mentions, exclamation marks · no links in the body (they go to a "first
reply" line) · no trailing question outside the weekly question post · banned
phrases from voice.md · **every number must exist in the data block, a note,
or facts.md** · trigram similarity < 0.6 against your last 60 posts.

## Commands

`/today` `/plan` `/plan new` `/gen [pillar]` `/recap` `/notes` `/note rm <n>`
`/facts` `/facts add <text>` `/voice ban <phrase>` `/voice rebuild` `/stats`
`/pause` `/resume` `/settings` `/help`

**Switching model from your phone** — useful when a subscription allowance
gets tight:

```
/model                 # current model, fallback chain, and the options
/model sonnet          # switch (aliases: fable, opus, sonnet, haiku)
/model reset           # back to MODEL_WRITE from .env
```

Takes effect on the next generation, no restart. In `cli` mode the writer
also passes a `--fallback-model` chain (the lighter known models below the
active one), so an exhausted allowance or an overloaded model degrades to a
lighter post instead of a dead slot.

The weekly mix (which pillars, how many slots each, plus the question and
thread slots) is configuration, not code — view and change it from Telegram:

```
/settings mix
/settings mix building in public=4, claude code=3, life=3, leadership=2, question=1, thread=1
```

Counts must fill the week exactly (slots per day × 7). The first pillar is
treated as the product pillar (the recap and the "non-product posts don't
mention the products" rule key off it); override with a `product_pillar`
row in the settings table if yours isn't first.

## Running permanently (macOS)

```bash
mkdir -p logs
cp deploy/com.xdesk.plist ~/Library/LaunchAgents/
# edit the plist paths first: node binary, repo location, PATH containing `claude`
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xdesk.plist
# stop: launchctl bootout gui/$(id -u)/com.xdesk
```

Keep the machine awake around your slots (caffeinate / Amphetamine) — launchd
keeps the process alive but not the Mac.

## Running on a VPS (Hetzner example, `WRITER=api`)

The bot is one Node process with no open ports (Telegram long polling), so
the smallest box Hetzner sells (~€4/mo CX22, Ubuntu 24.04) is plenty. On a
VPS you use the Anthropic API instead of a local Claude login: `WRITER=api`.

```bash
# as root on the fresh box
adduser --disabled-password --gecos "" xdesk
apt-get update && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs git

# as the xdesk user
su - xdesk
git clone <repo-url> xdesk && cd xdesk
npm install
cp .env.example .env && chmod 600 .env
cp voice.example.md voice.md && cp facts.example.md facts.md
```

Edit `.env`:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=...
WRITER=api
ANTHROPIC_API_KEY=sk-ant-...
TZ=Europe/Berlin              # slots and jobs run in this timezone
NPM_PACKAGES=your-package
GITHUB_REPOS=you/your-repo
```

Fill `voice.md` and `facts.md` (or `scp` your existing ones from your
machine — they're gitignored, so they don't travel with the clone). Then:

```bash
# back as root
cp /home/xdesk/xdesk/deploy/xdesk.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now xdesk
journalctl -u xdesk -f        # watch it come up
```

You should see `xdesk up — slots …, writer api` and the bot answering in
Telegram. Verify the writer end-to-end with
`sudo -u xdesk npx tsx scripts/writer-smoke.mts` from the repo directory.

VPS-mode differences:

- **Cost**: roughly $0.05 per post with prompt caching (the voice+facts
  system block is cached with `cache_control`) — about $5–8/month at two
  posts a day, plus the server.
- **Friday recap**: the git-grounded repo summaries are a `claude -p`
  feature; in api mode the recap builds from your consumed notes and live
  numbers only. `REPO_PATHS` is ignored.
- **Secrets hygiene**: `.env` holds both tokens — keep it `chmod 600`; the
  systemd unit deliberately contains no credentials.
- Migrating from a Mac: copy `voice.md`, `facts.md`, and `data/xdesk.sqlite`
  (your notes, history, and quality loop) to the server and stop the launchd
  agent so two pollers don't fight over the Telegram token.

## Environment reference

| Variable | Default | |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | required |
| `TELEGRAM_USER_ID` | — | required, the only accepted user |
| `WRITER` | `cli` | `cli` (claude -p, subscription) or `api` |
| `ANTHROPIC_API_KEY` | — | `api` mode only; forbidden in `cli` mode |
| `MODEL_WRITE` | `claude-fable-5` | the writing model |
| `CLAUDE_BIN` | `claude` | path to the CLI if not on PATH |
| `CLI_SANDBOX_DIR` | `~/xdesk/sandbox` | empty cwd for `claude -p` runs |
| `NPM_PACKAGES` | — | comma-separated packages for the data block |
| `GITHUB_REPOS` | — | comma-separated `owner/repo` |
| `REPO_PATHS` | — | comma-separated local repos for the recap |
| `TZ` | `UTC` | timezone for slots and jobs |
| `SLOTS` | `18:00,22:00` | posting slots |
| `DB_PATH` | `./data/xdesk.sqlite` | everything lives in one sqlite file |

## Roadmap

Phase 3 — reply lanes over the X read API (target-list polling, a Haiku
relevance filter, reply drafts). Phase 4 — inbound mentions and engagement
weighting. Specced, not built.

## License

MIT — see [LICENSE](LICENSE).
