import type { Bot } from "grammy";
import {
  addNote,
  deleteSetting,
  getItem,
  getItemByMessageId,
  getSetting,
  logEvent,
  openNotes,
  updateItem,
} from "../db/index.js";
import { weightedLength } from "../gen/guards.js";
import { refreshCard } from "./cards.js";

/**
 * Plain-text handler: an edit reply (to a ForceReply prompt or directly to a
 * card) replaces the post text; anything else is a note.
 */
export function registerNotesInbox(bot: Bot): void {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await ctx.reply("unknown command — see /help");
      return;
    }

    const replyTo = ctx.message.reply_to_message;
    if (replyTo) {
      // a reply to a plan digest is a plan edit instruction
      const planWeek = getSetting(`plan_digest:${replyTo.message_id}`);
      if (planWeek) {
        await ctx.reply("updating the plan…");
        const { applyPlanEdit } = await import("../gen/plan.js");
        const { updatePlanDigest } = await import("./plan-card.js");
        const entries = await applyPlanEdit(planWeek, text);
        await updatePlanDigest(ctx.api, planWeek, entries, replyTo.message_id);
        await ctx.reply("plan updated.");
        return;
      }

      // via the [Edit] ForceReply prompt, or a direct reply to the card itself
      const waitKey = `edit_wait:${replyTo.message_id}`;
      const waitingItemId = getSetting(waitKey);
      const target = waitingItemId
        ? getItem(waitingItemId)
        : getItemByMessageId(replyTo.message_id);

      if (target && (target.status === "pending" || target.status === "snoozed")) {
        updateItem(target.id, { text, parts: null });
        logEvent("edit", target.id, { length: text.length });
        if (waitingItemId) deleteSetting(waitKey);
        await refreshCard(ctx.api, { ...target, text, parts: null });
        const len = weightedLength(text);
        await ctx.reply(
          len > 280
            ? `updated — but it's ${len}/280 weighted chars, trim before posting.`
            : `updated (${len}/280).`,
        );
        return;
      }
    }

    addNote(text);
    const count = openNotes().length;
    await ctx.reply(`noted (${count} open note${count === 1 ? "" : "s"} — /notes)`);
  });
}
