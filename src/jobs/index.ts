import type { Bot } from "grammy";
import { registerSlotJobs } from "./slots.js";
import { registerNudgeJob } from "./nudges.js";
import { registerMetricsJob } from "./metrics.js";
import { registerPlanJob } from "./plan.js";
import { registerMaterialJob } from "./material.js";
import { registerVoiceRebuildJob } from "./voice-rebuild.js";

export function registerJobs(bot: Bot): void {
  registerSlotJobs(bot);
  registerNudgeJob(bot);
  registerMetricsJob();
  registerPlanJob(bot);
  registerMaterialJob(bot);
  registerVoiceRebuildJob(bot);
}
