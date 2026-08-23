import type { Bot } from "grammy";
import { config } from "../config.js";
import {
  countEvents,
  openNotes,
  postItemsSince,
  removeNote,
  setSetting,
  getSetting,
  sumCostSince,
} from "../db/index.js";
import { addBannedPhrase, appendFact, bannedPhrases, readFacts } from "../gen/voice.js";
import { pickPillar } from "../gen/posts.js";
import { generateRecap } from "../gen/recap.js";
import { generateWeeklyPlan } from "../gen/plan.js";
import { rebuildVoiceSections } from "../gen/voice-rebuild.js";
import { getPlan } from "../db/index.js";
import { describeMix, getProductPillar, parseAndSaveMix } from "../gen/mix.js";
import { createAndSendPost } from "./cards.js";
import { sendPlanDigest } from "./plan-card.js";
import { dateInTz, datePlusDays, dayKeyInTz, hhmmInTz, nowIso, weekKey, weekStartIso } from "../util.js";

const HELP = `xdesk — phase 1 (posts)

any plain message = a note for future posts.

/today — today's slots and their status
/plan — this week's plan · /plan new — plan now (reply to the digest to edit it)
/gen [pillar] — generate a post now
/recap — build the friday recap now
/notes — open notes · /note rm <n> — delete one
/facts — show facts.md · /facts add <text> — append a fact
/voice ban <phrase> — ban a phrase · /voice rebuild — rebuild examples now
/pause · /resume — stop/start scheduled generation
/stats — this week's counts and spend
/settings — current configuration · /settings mix — view/change the weekly mix
/help — this message

cards: Another regenerates (max 3), Edit replaces the text (or just reply
to the card), Posted ✓ saves it as a voice example, Skip rejects it,
Snooze 30m reminds later (max 3).`;

export function registerCommands(bot: Bot): void {
  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));

  bot.command("today", (ctx) => {
    const today = dateInTz(new Date(), config.tz);
    const items = postItemsSince(new Date(Date.now() - 2 * 86_400_000).toISOString()).filter(
      (i) => i.scheduled_for && dateInTz(new Date(i.scheduled_for), config.tz) === today,
    );
    if (items.length === 0) {
      const slots = config.slots.join(", ");
      return ctx.reply(`nothing generated yet today. slots: ${slots} (cards arrive 15 min early).`);
    }
    const lines = items.map((i) => {
      const time = i.scheduled_for ? hhmmInTz(new Date(i.scheduled_for), config.tz) : "?";
      const preview = (i.text ?? "").slice(0, 80);
      return `${time} · ${i.pillar ?? ""} · ${i.status}\n  ${preview}`;
    });
    return ctx.reply(lines.join("\n\n"));
  });

  bot.command("plan", async (ctx) => {
    const arg = ctx.match?.trim() ?? "";
    const thisWeek = weekKey(config.tz);
    if (arg === "new") {
      // on sunday the current week is over — plan the coming one
      const target =
        dayKeyInTz(new Date(), config.tz) === "sun" ? datePlusDays(thisWeek, 7) : thisWeek;
      await ctx.reply(`planning the week of ${target}…`);
      const entries = await generateWeeklyPlan(target);
      await sendPlanDigest(ctx.api, target, entries);
      return;
    }
    const current = getPlan(thisWeek);
    if (current.length > 0) return sendPlanDigest(ctx.api, thisWeek, current);
    const next = getPlan(datePlusDays(thisWeek, 7));
    if (next.length > 0) return sendPlanDigest(ctx.api, datePlusDays(thisWeek, 7), next);
    return ctx.reply("no plan yet — /plan new to generate one (sundays 20:00 it's automatic).");
  });

  bot.command("recap", async (ctx) => {
    await ctx.reply("building the recap…");
    await createAndSendPost(ctx.api, {
      slotLabel: "now",
      pillar: getProductPillar(),
      format: "recap",
      scheduledFor: nowIso(),
      remindAt: null,
      generate: (itemId) => generateRecap({ slotLabel: "now", itemId }),
    });
  });

  bot.command("gen", async (ctx) => {
    const requested = ctx.match?.trim();
    const pillar = requested || pickPillar();
    await ctx.reply(`generating a "${pillar}" post…`);
    await createAndSendPost(ctx.api, {
      slotLabel: "now",
      pillar,
      scheduledFor: nowIso(),
      remindAt: null,
    });
  });

  bot.command("notes", (ctx) => {
    const notes = openNotes();
    if (notes.length === 0) return ctx.reply("no open notes.");
    const lines = notes.map((n, i) => `${i + 1}. [${n.created_at.slice(0, 10)}] ${n.text}`);
    return ctx.reply(`open notes:\n${lines.join("\n")}\n\n/note rm <n> to delete`);
  });

  bot.command("note", (ctx) => {
    const match = /^rm\s+(\d+)$/.exec(ctx.match?.trim() ?? "");
    if (!match) return ctx.reply("usage: /note rm <n>");
    const idx = Number(match[1]) - 1;
    const notes = openNotes();
    if (idx < 0 || idx >= notes.length) return ctx.reply(`no note #${match[1]} — see /notes`);
    removeNote(notes[idx].id);
    return ctx.reply(`removed: ${notes[idx].text.slice(0, 60)}`);
  });

  bot.command("facts", (ctx) => {
    const arg = ctx.match?.trim() ?? "";
    if (arg.startsWith("add ")) {
      const fact = arg.slice(4).trim();
      if (!fact) return ctx.reply("usage: /facts add <text>");
      appendFact(fact);
      return ctx.reply("fact added.");
    }
    const facts = readFacts();
    return ctx.reply(facts.trim() ? facts.slice(0, 4000) : "facts.md is empty.");
  });

  bot.command("voice", (ctx) => {
    const arg = ctx.match?.trim() ?? "";
    if (arg === "rebuild") {
      const result = rebuildVoiceSections();
      if (result.skipped) return ctx.reply("no approved posts yet — nothing to rebuild from.");
      return ctx.reply(
        `voice examples rebuilt: ${result.approved} approved (${result.edited} edited` +
          `${result.padded ? `, ${result.padded} seed kept` : ""}), avoid-list ${result.rejectedUsed}.`,
      );
    }
    if (arg.startsWith("ban ")) {
      const phrase = arg.slice(4).trim();
      if (!phrase) return ctx.reply("usage: /voice ban <phrase>");
      addBannedPhrase(phrase);
      return ctx.reply(`banned: "${phrase}"`);
    }
    const banned = bannedPhrases();
    return ctx.reply(
      banned.length
        ? `banned phrases:\n${banned.map((p) => `- ${p}`).join("\n")}\n\n/voice ban <phrase> to add`
        : "no banned phrases yet. /voice ban <phrase> to add one.",
    );
  });

  bot.command("pause", (ctx) => {
    setSetting("paused", "1");
    return ctx.reply("paused — no scheduled posts until /resume.");
  });

  bot.command("resume", (ctx) => {
    setSetting("paused", "0");
    return ctx.reply("resumed.");
  });

  bot.command("stats", (ctx) => {
    const since = weekStartIso(config.tz);
    const items = postItemsSince(since);
    const posted = items.filter((i) => i.status === "done");
    const edited = posted.filter((i) => countEvents("edit", i.id) > 0);
    const skipped = items.filter((i) => i.status === "skipped");
    const missed = items.filter((i) => i.status === "expired");
    const cost = sumCostSince(since);
    return ctx.reply(
      `this week:\n` +
        `generated ${items.length} · posted ${posted.length} (${edited.length} edited) · ` +
        `skipped ${skipped.length} · missed ${missed.length}\n` +
        `model spend $${cost.toFixed(2)}`,
    );
  });

  bot.command("settings", (ctx) => {
    const arg = ctx.match?.trim() ?? "";
    if (arg.startsWith("mix ")) {
      const result = parseAndSaveMix(arg.slice(4));
      return ctx.reply(
        result.ok ? `weekly mix set: ${describeMix(result.mix)}` : `mix not saved: ${result.error}`,
      );
    }
    if (arg === "mix") {
      return ctx.reply(
        `weekly mix: ${describeMix()}\nproduct pillar: ${getProductPillar()}\n\n` +
          `set with: /settings mix building in public=4, claude code=3, life=3, leadership=2, question=1, thread=1`,
      );
    }
    const launchMatch = /^launch\s+(live|pre-launch)$/.exec(arg);
    if (launchMatch) {
      setSetting("launch.status", launchMatch[1]);
      return ctx.reply(
        launchMatch[1] === "live"
          ? "launch.status = live — availability claims and links are now allowed."
          : "launch.status = pre-launch — no availability claims, no links.",
      );
    }
    const paused = getSetting("paused") === "1";
    return ctx.reply(
      `slots: ${config.slots.join(", ")} (${config.tz}), cards at T-15\n` +
        `mix: ${describeMix()} (/settings mix to change)\n` +
        `writer: ${config.writer}${config.writer === "cli" ? " (claude -p, subscription)" : " (messages api)"}\n` +
        `model: ${config.modelWrite}\n` +
        `npm: ${config.npmPackages.join(", ") || "(none)"}\n` +
        `github: ${config.githubRepos.join(", ") || "(none)"}\n` +
        `launch: ${getSetting("launch.status") ?? "pre-launch"} (change: /settings launch live)\n` +
        `status: ${paused ? "paused" : "active"}`,
    );
  });
}
