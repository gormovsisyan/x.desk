import { config } from "./config.js";
import "./db/index.js"; // opens the db and creates tables
import { createBot, setCommandMenu } from "./bot/bot.js";
import { registerJobs } from "./jobs/index.js";
import { refreshMetrics } from "./data/history.js";
import { assertCliAuth } from "./writers/cli.js";

async function main(): Promise<void> {
  // fail fast before the first scheduled run rather than at 17:45
  if (config.writer === "cli") await assertCliAuth();

  const bot = createBot();

  registerJobs(bot);
  await setCommandMenu(bot).catch((err) => console.error("setMyCommands failed:", err));

  // warm the numbers cache in the background so the first card has data
  refreshMetrics().catch(() => {});

  const stop = () => {
    void bot.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log(
    `xdesk up — slots ${config.slots.join(", ")} (${config.tz}), ` +
      `writer ${config.writer}, model ${config.modelWrite}`,
  );
  await bot.start();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
