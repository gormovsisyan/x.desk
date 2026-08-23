import { Bot } from "grammy";
import { config } from "../config.js";
import { registerCommands } from "./commands.js";
import { registerCallbacks } from "./callbacks.js";
import { registerNotesInbox } from "./notes.js";

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  // single-user allowlist — everyone else is silently ignored
  bot.use((ctx, next) => {
    if (ctx.from?.id === config.telegramUserId) return next();
    return;
  });

  bot.catch((err) => {
    console.error("bot error:", err.error);
  });

  registerCommands(bot);
  registerCallbacks(bot);
  registerNotesInbox(bot); // last: catches all remaining plain text as notes

  return bot;
}

export async function setCommandMenu(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "today", description: "today's slots and status" },
    { command: "plan", description: "this week's plan / plan new" },
    { command: "gen", description: "generate a post now" },
    { command: "recap", description: "build the friday recap now" },
    { command: "notes", description: "open notes" },
    { command: "facts", description: "show facts / add with: add <text>" },
    { command: "voice", description: "ban a phrase: ban <phrase>" },
    { command: "stats", description: "this week's counts and spend" },
    { command: "pause", description: "pause scheduled posts" },
    { command: "resume", description: "resume scheduled posts" },
    { command: "settings", description: "current configuration" },
    { command: "help", description: "how it works" },
  ]);
}
