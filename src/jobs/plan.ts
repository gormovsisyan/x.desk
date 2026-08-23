import cron from "node-cron";
import type { Bot } from "grammy";
import { config } from "../config.js";
import { getSetting } from "../db/index.js";
import { generateWeeklyPlan } from "../gen/plan.js";
import { sendPlanDigest } from "../bot/plan-card.js";
import { datePlusDays, weekKey } from "../util.js";

/** Sunday 20:00: plan the coming week and send the digest. */
export function registerPlanJob(bot: Bot): void {
  cron.schedule(
    "0 20 * * 0",
    async () => {
      if (getSetting("paused") === "1") return;
      const week = datePlusDays(weekKey(config.tz), 7);
      try {
        const entries = await generateWeeklyPlan(week);
        await sendPlanDigest(bot.api, week, entries);
      } catch (err) {
        console.error("weekly plan failed:", err);
        await bot.api
          .sendMessage(config.telegramUserId, `weekly plan failed: ${String(err)} — /plan new to retry`)
          .catch(() => {});
      }
    },
    { timezone: config.tz },
  );
}
