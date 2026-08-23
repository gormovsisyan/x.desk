import cron from "node-cron";
import { config } from "../config.js";
import { refreshMetrics } from "../data/history.js";

/** Daily 09:30 local: refresh npm downloads + github stars into metrics_cache. */
export function registerMetricsJob(): void {
  cron.schedule(
    "30 9 * * *",
    () => {
      refreshMetrics().catch((err) => console.error("metrics refresh failed:", err));
    },
    { timezone: config.tz },
  );
}
