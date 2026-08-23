import cron from "node-cron";
import type { Bot } from "grammy";
import { config } from "../config.js";
import { getPlanEntry, getSetting } from "../db/index.js";
import { pickPillar } from "../gen/posts.js";
import { generateRecap } from "../gen/recap.js";
import { createAndSendPost } from "../bot/cards.js";
import { cronAtOffset, dayKeyInTz, minutesFromNowIso, weekKey } from "../util.js";

/** Generate + deliver the card for one slot (fires at T-15). */
export async function runSlot(bot: Bot, slot: string): Promise<void> {
  if (getSetting("paused") === "1") return;

  const day = dayKeyInTz(new Date(), config.tz);
  const scheduledFor = minutesFromNowIso(15); // the slot itself
  const remindAt = minutesFromNowIso(35); // T+20 nudge

  // the friday first slot is always the weekly recap
  if (day === "fri" && slot === config.slots[0]) {
    await createAndSendPost(bot.api, {
      slotLabel: slot,
      pillar: "building in public",
      format: "recap",
      scheduledFor,
      remindAt,
      generate: (itemId) => generateRecap({ slotLabel: slot, itemId }),
    });
    return;
  }

  const entry = getPlanEntry(weekKey(config.tz), day, slot);
  await createAndSendPost(bot.api, {
    slotLabel: slot,
    pillar: entry?.pillar ?? pickPillar(),
    format: entry?.format ?? "single",
    angle: entry?.angle ?? null,
    source: entry?.source ?? null,
    scheduledFor,
    remindAt,
  });
}

export function registerSlotJobs(bot: Bot): void {
  for (const slot of config.slots) {
    cron.schedule(
      cronAtOffset(slot, -15),
      () => {
        runSlot(bot, slot).catch(async (err) => {
          console.error(`slot ${slot} failed:`, err);
          await bot.api
            .sendMessage(config.telegramUserId, `slot ${slot} failed: ${String(err)}`)
            .catch(() => {});
        });
      },
      { timezone: config.tz },
    );
  }
}
