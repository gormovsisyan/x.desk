/**
 * Day-one check for the configured writer: one tiny structured call.
 *   npx tsx scripts/writer-smoke.mts
 * Uses haiku so a cli-mode run barely touches the Max allowance. Needs a
 * filled .env (or the dummy vars below) — it never talks to Telegram.
 */
process.env.TELEGRAM_BOT_TOKEN ??= "dummy";
process.env.TELEGRAM_USER_ID ??= "1";

import { z } from "zod";
const { getWriter } = await import("../src/writers/index.js");
const { config } = await import("../src/config.js");
const db = await import("../src/db/index.js");

const Schema = z.object({ text: z.string(), mood: z.enum(["calm", "tired"]) });
const t0 = Date.now();
const res = await getWriter().write({
  system: "you write single lowercase sentences about the weather. pick mood calm or tired.",
  prompt: "one sentence about fog in the morning.",
  model: config.writer === "cli" ? "claude-haiku-4-5-20251001" : config.modelWrite,
  schema: Schema,
  kind: "smoke_writer",
});
console.log(`writer=${config.writer} ok in ${Date.now() - t0}ms`);
console.log("result:", JSON.stringify(res.data));
const ev = db.db
  .prepare("SELECT payload, cost_usd FROM events WHERE kind='smoke_writer' ORDER BY created_at DESC LIMIT 1")
  .get();
console.log("logged event:", JSON.stringify(ev));
process.exit(0);
