import { InlineKeyboard, type Api } from "grammy";
import { config } from "../config.js";
import { getSetting, setSetting, type PlanEntry } from "../db/index.js";
import { renderPlanDigest } from "../gen/plan.js";

const keyboard = (week: string) => new InlineKeyboard().text("Regenerate", `pl:regen:${week}`);

/** Send a fresh plan digest and remember the message so replies edit the plan. */
export async function sendPlanDigest(api: Api, week: string, entries: PlanEntry[]): Promise<void> {
  const sent = await api.sendMessage(config.telegramUserId, renderPlanDigest(week, entries), {
    reply_markup: keyboard(week),
  });
  setSetting(`plan_digest_msg:${week}`, String(sent.message_id));
  setSetting(`plan_digest:${sent.message_id}`, week);
}

/** Re-render the digest in place after a regenerate or a text edit. */
export async function updatePlanDigest(
  api: Api,
  week: string,
  entries: PlanEntry[],
  messageId?: number,
): Promise<void> {
  const stored = getSetting(`plan_digest_msg:${week}`);
  const id = messageId ?? (stored ? Number(stored) : undefined);
  if (!id) return;
  await api
    .editMessageText(config.telegramUserId, id, renderPlanDigest(week, entries), {
      reply_markup: keyboard(week),
    })
    .catch(() => {}); // unchanged content is a Telegram error, not a problem
}
