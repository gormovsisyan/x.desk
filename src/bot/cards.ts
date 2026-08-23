import { InlineKeyboard, type Api } from "grammy";
import { config } from "../config.js";
import {
  createItem,
  updateItem,
  type Item,
} from "../db/index.js";
import { generatePost, type GeneratedPost } from "../gen/posts.js";
import { weightedLength } from "../gen/guards.js";
import { hhmmInTz } from "../util.js";
import { code, esc } from "./md.js";

export function slotLabelOf(item: Item): string {
  return item.scheduled_for ? hhmmInTz(new Date(item.scheduled_for), config.tz) : "now";
}

function parseParts(item: Item): string[] | null {
  if (!item.parts) return null;
  try {
    const parts = JSON.parse(item.parts) as string[];
    return parts.length > 0 ? parts : null;
  } catch {
    return null;
  }
}

export function renderPostCard(item: Item, guardProblems: string[] = []): string {
  const lines: string[] = [];
  const format = item.format ?? "single";
  const head = `📝 ${esc(slotLabelOf(item))} · ${esc(item.pillar ?? "post")}`;
  lines.push(format !== "single" ? `${head} · ${esc(format)}` : head);

  const parts = parseParts(item);
  if (parts) {
    parts.forEach((p, i) => lines.push(`${i + 1}: ${code(p)}`));
    lines.push(esc("post part 1, then reply to it with part 2, and so on."));
  } else if (item.text) {
    lines.push(code(item.text));
  }

  if (item.alt) {
    lines.push(`alt: ${code(item.alt)}`);
  }
  if (item.link_reply) {
    lines.push(`first reply: ${code(item.link_reply)}`);
  }
  if (format === "question") {
    lines.push(esc("question post — reply to every answer."));
  }

  const counted = parts ? parts[0] : item.text ?? "";
  const meta: string[] = [`${weightedLength(counted)}/280`];
  if (item.rationale) meta.push(`from: ${item.rationale}`);
  lines.push(esc(meta.join(" · ")));

  if (guardProblems.length > 0) {
    lines.push(esc("⚠️ failed guards — edit before posting:"));
    for (const p of guardProblems) lines.push(esc(`- ${p}`));
  }

  switch (item.status) {
    case "done":
      lines.push(esc("✓ posted"));
      break;
    case "skipped":
      lines.push(esc("⏭ skipped"));
      break;
    case "expired":
      lines.push(esc("⏰ missed"));
      break;
    case "snoozed":
      lines.push(
        esc(
          `💤 snoozed until ${
            item.remind_at ? hhmmInTz(new Date(item.remind_at), config.tz) : "?"
          }`,
        ),
      );
      break;
  }
  return lines.join("\n");
}

export function cardKeyboard(item: Item): InlineKeyboard | undefined {
  if (item.status !== "pending" && item.status !== "snoozed") return undefined;
  return new InlineKeyboard()
    .text("Another", `p:another:${item.id}`)
    .text("Edit", `p:edit:${item.id}`)
    .row()
    .text("Posted ✓", `p:posted:${item.id}`)
    .text("Skip", `p:skip:${item.id}`)
    .text("Snooze 30m", `p:snooze:${item.id}`);
}

/** Re-render the card in place after any state change. */
export async function refreshCard(
  api: Api,
  item: Item,
  guardProblems: string[] = [],
): Promise<void> {
  if (!item.tg_message_id) return;
  await api.editMessageText(
    config.telegramUserId,
    item.tg_message_id,
    renderPostCard(item, guardProblems),
    { parse_mode: "MarkdownV2", reply_markup: cardKeyboard(item) },
  );
}

export function applyGeneration(item: Item, gen: GeneratedPost): Item {
  updateItem(item.id, {
    text: gen.output.text,
    parts: gen.output.parts && gen.output.parts.length > 0 ? JSON.stringify(gen.output.parts) : null,
    alt: gen.output.alt,
    link_reply: gen.output.link_reply,
    rationale: gen.output.rationale,
    sources: JSON.stringify(gen.output.sources),
  });
  return { ...item, ...{
    text: gen.output.text,
    parts: gen.output.parts && gen.output.parts.length > 0 ? JSON.stringify(gen.output.parts) : null,
    alt: gen.output.alt,
    link_reply: gen.output.link_reply,
    rationale: gen.output.rationale,
    sources: JSON.stringify(gen.output.sources),
  } };
}

/**
 * The slot flow: create the item, generate the post, send the card (with sound).
 * Used by the T-15 cron job, /gen, and /recap (via the generate override).
 */
export async function createAndSendPost(
  api: Api,
  opts: {
    slotLabel: string;
    pillar: string;
    format?: string;
    angle?: string | null;
    source?: string | null;
    scheduledFor: string;
    remindAt: string | null;
    generate?: (itemId: string) => Promise<GeneratedPost>;
  },
): Promise<void> {
  let item = createItem({
    lane: "post",
    pillar: opts.pillar,
    format: opts.format ?? "single",
    plan_angle: opts.angle ?? null,
    plan_source: opts.source ?? null,
    scheduled_for: opts.scheduledFor,
    remind_at: opts.remindAt,
  });

  let gen: GeneratedPost;
  try {
    gen = opts.generate
      ? await opts.generate(item.id)
      : await generatePost({
          slotLabel: opts.slotLabel,
          pillar: opts.pillar,
          format: opts.format,
          angle: opts.angle,
          source: opts.source,
          itemId: item.id,
        });
  } catch (err) {
    updateItem(item.id, { status: "expired", rationale: `generation failed` });
    await api.sendMessage(
      config.telegramUserId,
      `generation failed for the ${opts.slotLabel} slot: ${String(err)}`,
    );
    return;
  }

  item = applyGeneration(item, gen);
  const sent = await api.sendMessage(config.telegramUserId, renderPostCard(item, gen.guardProblems), {
    parse_mode: "MarkdownV2",
    reply_markup: cardKeyboard(item),
  });
  updateItem(item.id, { tg_message_id: sent.message_id });
}
