import cron from "node-cron";
import type { Bot } from "grammy";
import { config } from "../config.js";
import { countEvents, itemsDueForReminder, logEvent, updateItem } from "../db/index.js";
import { refreshCard } from "../bot/cards.js";
import { minutesFromNowIso } from "../util.js";

/**
 * Reminder loop, every minute:
 * - a pending card 20 min past its slot gets one silent nudge;
 * - a snooze that ran out gets a silent nudge and goes back to pending;
 * - after a nudge with no reaction for 60 min, the card is marked missed.
 */
async function tick(bot: Bot): Promise<void> {
  for (const item of itemsDueForReminder()) {
    const nudges = countEvents("nudge", item.id);
    if (item.status === "snoozed" || nudges === 0) {
      updateItem(item.id, { status: "pending", remind_at: minutesFromNowIso(60) });
      logEvent("nudge", item.id, null);
      await bot.api
        .sendMessage(config.telegramUserId, "⏰ still pending ↑", {
          disable_notification: true,
          reply_parameters: item.tg_message_id
            ? { message_id: item.tg_message_id }
            : undefined,
        })
        .catch(() => {});
    } else {
      updateItem(item.id, { status: "expired", remind_at: null });
      await refreshCard(bot.api, { ...item, status: "expired" }).catch(() => {});
    }
  }
}

export function registerNudgeJob(bot: Bot): void {
  cron.schedule("* * * * *", () => {
    tick(bot).catch((err) => console.error("nudge tick failed:", err));
  });
}
