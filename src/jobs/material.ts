import cron from "node-cron";
import type { Bot } from "grammy";
import { config } from "../config.js";
import { getPlan, getPlanEntry, getSetting } from "../db/index.js";
import { dayKeyInTz, weekKey } from "../util.js";

/**
 * Daily 10:00: one question about today's slots if material is missing,
 * silence otherwise. Only speaks when a plan exists — without one the slot
 * generator sources itself. Any reply lands in the notes inbox, which is
 * exactly where the material is read from.
 */
export function registerMaterialJob(bot: Bot): void {
  cron.schedule(
    "0 10 * * *",
    async () => {
      if (getSetting("paused") === "1") return;
      const week = weekKey(config.tz);
      if (getPlan(week).length === 0) return;

      const day = dayKeyInTz(new Date(), config.tz);
      const issues: string[] = [];
      for (const slot of config.slots) {
        if (day === "fri" && slot === config.slots[0]) continue; // recap sources itself from git
        const entry = getPlanEntry(week, day, slot);
        if (!entry) continue;
        if (!entry.source) {
          issues.push(`${slot} — ${entry.pillar}: ${entry.angle}`);
        }
      }
      if (issues.length === 0) return;
      await bot.api
        .sendMessage(
          config.telegramUserId,
          `material check for today:\n${issues.map((i) => `- ${i}`).join("\n")}\n` +
            `anything to give me? a note is enough — otherwise i'll write without it.`,
        )
        .catch(() => {});
    },
    { timezone: config.tz },
  );
}
