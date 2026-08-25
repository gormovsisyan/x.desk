import cron from "node-cron";
import type { Bot } from "grammy";
import { config } from "../config.js";
import { describeRebuild, rebuildVoiceSections } from "../gen/voice-rebuild.js";

/** Sunday 19:00: rebuild voice.md examples from the week's approvals. */
export function registerVoiceRebuildJob(bot: Bot): void {
  cron.schedule(
    "0 19 * * 0",
    async () => {
      try {
        const result = rebuildVoiceSections();
        if (result.skipped) return;
        await bot.api
          .sendMessage(config.telegramUserId, describeRebuild(result), {
            disable_notification: true,
          })
          .catch(() => {});
      } catch (err) {
        console.error("voice rebuild failed:", err);
      }
    },
    { timezone: config.tz },
  );
}
