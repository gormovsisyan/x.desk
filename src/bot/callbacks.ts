import type { Bot, Context } from "grammy";
import {
  addRejected,
  addVoiceExample,
  consumeNote,
  countEvents,
  getItem,
  setSetting,
  updateItem,
  type Item,
} from "../db/index.js";
import { generatePost } from "../gen/posts.js";
import { generateRecap } from "../gen/recap.js";
import { applyGeneration, refreshCard, slotLabelOf } from "./cards.js";
import { minutesFromNowIso } from "../util.js";

const MAX_ANOTHER = 3;
const MAX_SNOOZES = 3;

// updates are processed sequentially, so a tap queued behind a long regeneration
// can expire before we answer it — that must never abort the tapped action
const answer = (ctx: Context, opts?: Parameters<Context["answerCallbackQuery"]>[0]) =>
  ctx.answerCallbackQuery(opts).catch(() => {});

function fullText(item: Item): string {
  if (item.parts) {
    try {
      const parts = JSON.parse(item.parts) as string[];
      if (parts.length > 0) return parts.join("\n---\n");
    } catch {
      /* fall through */
    }
  }
  return item.text ?? "";
}

async function handleAnother(ctx: Context, item: Item): Promise<void> {
  if (item.regen_count >= MAX_ANOTHER) {
    await answer(ctx, {
      text: "3 regenerations used — send me a note with a fresh angle instead.",
      show_alert: true,
    });
    return;
  }
  await answer(ctx, { text: "regenerating…" });
  const previous = fullText(item);
  if (previous) addRejected(previous, "another");
  updateItem(item.id, { regen_count: item.regen_count + 1 });

  // a recap must regenerate as a recap — generatePost alone would drop the
  // git summaries and consumed notes that ground it (the rejected previous
  // text still reaches the writer via recentRejected)
  const gen =
    item.format === "recap"
      ? await generateRecap({ slotLabel: slotLabelOf(item), itemId: item.id })
      : await generatePost({
          slotLabel: slotLabelOf(item),
          pillar: item.pillar ?? "building in public",
          format: item.format ?? "single",
          angle: `take a different angle; avoid anything resembling: ${previous}`,
          itemId: item.id,
          extraAvoid: previous ? [previous] : [],
        });
  const updated = applyGeneration({ ...item, regen_count: item.regen_count + 1 }, gen);
  await refreshCard(ctx.api, updated, gen.guardProblems);
}

async function handleEdit(ctx: Context, item: Item): Promise<void> {
  await answer(ctx);
  const sent = await ctx.reply("send the edited text for this post:", {
    reply_markup: { force_reply: true },
    reply_parameters: item.tg_message_id ? { message_id: item.tg_message_id } : undefined,
  });
  setSetting(`edit_wait:${sent.message_id}`, item.id);
}

async function handlePosted(ctx: Context, item: Item): Promise<void> {
  updateItem(item.id, { status: "done", remind_at: null });
  const wasEdited = countEvents("edit", item.id) > 0;
  addVoiceExample(fullText(item), "post", wasEdited);

  // consume the notes this post was built on
  if (item.sources) {
    try {
      const sources = JSON.parse(item.sources) as string[];
      for (const s of sources) {
        if (s.startsWith("note:")) consumeNote(s.slice("note:".length), item.id);
      }
    } catch {
      /* malformed sources — nothing to consume */
    }
  }
  await refreshCard(ctx.api, { ...item, status: "done" });
  await answer(ctx, { text: "posted ✓" });
}

async function handleSkip(ctx: Context, item: Item): Promise<void> {
  updateItem(item.id, { status: "skipped", remind_at: null });
  addRejected(fullText(item), "skip");
  await refreshCard(ctx.api, { ...item, status: "skipped" });
  await answer(ctx, { text: "skipped" });
}

async function handleSnooze(ctx: Context, item: Item): Promise<void> {
  if (item.snoozes >= MAX_SNOOZES) {
    updateItem(item.id, { status: "expired", remind_at: null });
    await refreshCard(ctx.api, { ...item, status: "expired" });
    await answer(ctx, { text: "snooze limit reached — marked missed." });
    return;
  }
  const remindAt = minutesFromNowIso(30);
  updateItem(item.id, { status: "snoozed", snoozes: item.snoozes + 1, remind_at: remindAt });
  await refreshCard(ctx.api, {
    ...item,
    status: "snoozed",
    snoozes: item.snoozes + 1,
    remind_at: remindAt,
  });
  await answer(ctx, { text: "snoozed 30 min" });
}

export function registerCallbacks(bot: Bot): void {
  bot.callbackQuery(/^pl:regen:(.+)$/, async (ctx) => {
    const week = ctx.match![1];
    await answer(ctx, { text: "replanning…" });
    const { generateWeeklyPlan } = await import("../gen/plan.js");
    const { updatePlanDigest } = await import("./plan-card.js");
    const entries = await generateWeeklyPlan(week);
    await updatePlanDigest(ctx.api, week, entries, ctx.callbackQuery.message?.message_id);
  });

  bot.callbackQuery(/^p:(another|edit|posted|skip|snooze):(.+)$/, async (ctx) => {
    const [, action, id] = ctx.match!;
    const item = getItem(id);
    if (!item) {
      await answer(ctx, { text: "item not found (expired?)" });
      return;
    }
    if (item.status === "done" || item.status === "skipped") {
      await answer(ctx, { text: `already ${item.status}` });
      return;
    }
    switch (action) {
      case "another":
        return handleAnother(ctx, item);
      case "edit":
        return handleEdit(ctx, item);
      case "posted":
        return handlePosted(ctx, item);
      case "skip":
        return handleSkip(ctx, item);
      case "snooze":
        return handleSnooze(ctx, item);
    }
  });
}
