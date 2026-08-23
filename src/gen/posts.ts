import { z } from "zod";
import { config } from "../config.js";
import { getSetting, openNotes, postItemsSince, recentRejected, type Note } from "../db/index.js";
import { buildDataBlock, lastPosts } from "../data/history.js";
import { getWriter } from "../writers/index.js";
import { bannedPhrases, readFacts, readVoice } from "./voice.js";
import { getProductPillar, getWeeklyMix } from "./mix.js";
import { extractNumbers, runGuards, type GuardContext } from "./guards.js";
import { weekStartIso } from "../util.js";

export const PostOutput = z.object({
  text: z.string(),
  link_reply: z.string().nullable(),
  rationale: z.string(),
  sources: z.array(z.string()),
  parts: z.array(z.string()).nullable(),
  alt: z.string().nullable(),
});
export type PostOutputT = z.infer<typeof PostOutput>;

export interface GeneratedPost {
  output: PostOutputT;
  guardProblems: string[]; // empty when the final draft passed all guards
  costUsd: number;
  notesUsed: Note[];
}

const MAX_SILENT_REGENS = 2;

/**
 * Fallback pillar picker for slots with no plan entry. Proportional fill
 * (count/quota) with a least-recently-used tie-break, so pillars rotate
 * instead of the product pillar front-loading the week.
 */
export function pickPillar(): string {
  const since = weekStartIso(config.tz);
  const mix = getWeeklyMix();
  const counts: Record<string, number> = {};
  const lastUsed: Record<string, string> = {};
  for (const item of postItemsSince(since)) {
    if (item.status === "skipped" || item.status === "expired") continue;
    const p = item.pillar ?? "";
    counts[p] = (counts[p] ?? 0) + 1;
    lastUsed[p] = item.created_at;
  }
  let best = Object.keys(mix.pillars)[0];
  let bestFill = Infinity;
  let bestLast = "";
  for (const [pillar, quota] of Object.entries(mix.pillars)) {
    const fill = (counts[pillar] ?? 0) / quota;
    const last = lastUsed[pillar] ?? "";
    if (fill < bestFill || (fill === bestFill && last < bestLast)) {
      bestFill = fill;
      bestLast = last;
      best = pillar;
    }
  }
  return best;
}

/** voice.md + facts.md as the system prompt (cached by the api writer / by Claude Code). */
export function buildSystemText(): string {
  const preamble =
    "you ghost-write x posts for one person. you may only say things grounded in " +
    "the voice file, the facts file, the notes, and the live numbers you are given — " +
    "never invent events, opinions you haven't seen them express, or numbers. " +
    "write exactly in their register.";
  return `${preamble}\n\n# voice file\n\n${readVoice()}\n\n# facts file\n\n${readFacts()}`;
}

function buildUserPrompt(opts: {
  slotLabel: string;
  pillar: string;
  format: string;
  angle?: string | null;
  source?: string | null;
  extraMaterial?: string | null;
  notes: Note[];
  dataBlock: string;
  history: { text: string; date: string; pillar: string | null }[];
  avoidTexts: string[];
}): string {
  const lines: string[] = [];
  lines.push(`write one post for the ${opts.slotLabel} slot today.`);
  lines.push("");
  lines.push(`pillar: ${opts.pillar}`);
  lines.push(`format: ${opts.format}`);
  if (opts.angle) lines.push(`angle: ${opts.angle}`);
  if (opts.source) lines.push(`planned material: ${opts.source}`);
  lines.push(
    `launch status: ${getSetting("launch.status") ?? "pre-launch"} — any STATUS RULE in the facts file applies.`,
  );
  if (opts.pillar !== getProductPillar()) {
    lines.push(
      "this is not a product post: do not mention the side projects. " +
        "the pillar's own material carries it.",
    );
  }
  lines.push("");

  if (opts.notes.length > 0) {
    lines.push("open notes (raw material; cite used ones in sources as note:<id>):");
    for (const n of opts.notes) {
      lines.push(`- [${n.created_at.slice(0, 10)}] ${n.text} (note:${n.id})`);
    }
  } else {
    lines.push("open notes: none.");
  }
  lines.push("");
  lines.push(opts.dataBlock);
  lines.push("");
  if (opts.extraMaterial) {
    lines.push(opts.extraMaterial);
    lines.push("");
  }

  if (opts.history.length > 0) {
    lines.push("recent posts, newest first (continuity is good; repeating them is not):");
    for (const h of opts.history) {
      lines.push(`- [${h.date.slice(0, 10)}${h.pillar ? ` · ${h.pillar}` : ""}] ${h.text}`);
    }
    lines.push("");
  }

  if (opts.avoidTexts.length > 0) {
    lines.push("do not resemble these rejected drafts:");
    for (const t of opts.avoidTexts) lines.push(`- ${t}`);
    lines.push("");
  }

  lines.push(
    "hard rules: at most 280 weighted chars; all lowercase; no hashtags; no emoji; " +
      "no urls in text (a link belongs in link_reply); no @; every number in the text " +
      "must appear in the live numbers block or in a note. " +
      "cite what the post is built on in sources (note:<id>, npm:<pkg>, github:<repo>, fact). " +
      "rationale is one short line shown to the author, e.g. \"built on tue note + npm weekly\". " +
      "parts is only for threads, alt only for a/b posts; otherwise null.",
  );
  return lines.join("\n");
}

function buildGuardContext(notes: Note[], dataBlock: string, extraMaterial?: string | null): GuardContext {
  const allowed = new Set<string>();
  for (const n of extractNumbers(dataBlock)) allowed.add(n);
  if (extraMaterial) for (const n of extractNumbers(extraMaterial)) allowed.add(n);
  for (const note of notes) for (const n of extractNumbers(note.text)) allowed.add(n);
  // facts.md is user-maintained truth; its numbers (e.g. "18:00 = 10am ET") are fair game
  for (const n of extractNumbers(readFacts())) allowed.add(n);
  return {
    allowedNumbers: allowed,
    recentPosts: lastPosts(60).map((p) => p.text),
    bannedPhrases: bannedPhrases(),
    allowQuestions: false,
  };
}

function guardAll(output: PostOutputT, ctx: GuardContext): string[] {
  const texts = output.parts && output.parts.length > 0 ? output.parts : [output.text];
  const problems: string[] = [];
  texts.forEach((t, i) => {
    const label = output.parts ? `part ${i + 1}: ` : "";
    for (const p of runGuards(t, ctx)) problems.push(label + p);
  });
  return problems;
}

/**
 * Generate one post through the configured Writer (claude -p or Messages API).
 * Guard failures are folded back into a fresh single-shot prompt and silently
 * regenerated up to MAX_SILENT_REGENS times; if the final draft still fails,
 * it is returned with `guardProblems` set so the card can flag it instead of
 * dropping the slot.
 */
export async function generatePost(opts: {
  slotLabel: string;
  pillar: string;
  format?: string;
  angle?: string | null;
  source?: string | null;
  extraMaterial?: string | null;
  itemId?: string | null;
  extraAvoid?: string[];
}): Promise<GeneratedPost> {
  const notes = openNotes(7);
  const dataBlock = await buildDataBlock();
  const history = lastPosts(60);
  const avoidTexts = [
    ...(opts.extraAvoid ?? []),
    ...recentRejected(10).map((r) => r.text),
  ].filter((t) => t && t.length > 0);

  const writer = getWriter();
  const system = buildSystemText();
  const guardCtx = buildGuardContext(notes, dataBlock, opts.extraMaterial);
  guardCtx.allowQuestions = (opts.format ?? "single") === "question";
  const basePrompt = buildUserPrompt({
    slotLabel: opts.slotLabel,
    pillar: opts.pillar,
    format: opts.format ?? "single",
    angle: opts.angle,
    source: opts.source,
    extraMaterial: opts.extraMaterial,
    notes,
    dataBlock,
    history,
    avoidTexts,
  });

  let prompt = basePrompt;
  let totalCost = 0;
  let last: PostOutputT | null = null;
  let lastProblems: string[] = [];

  for (let attempt = 0; attempt <= MAX_SILENT_REGENS; attempt++) {
    const result = await writer.write({
      system,
      prompt,
      model: config.modelWrite,
      schema: PostOutput,
      itemId: opts.itemId ?? null,
      kind: "gen_post",
    });
    totalCost += result.costUsd;
    last = result.data;
    lastProblems = guardAll(result.data, guardCtx);
    if (lastProblems.length === 0) break;

    prompt =
      basePrompt +
      `\n\nyour previous draft:\n${JSON.stringify(result.data)}\n\n` +
      `it failed these checks:\n` +
      lastProblems.map((p) => `- ${p}`).join("\n") +
      `\nrewrite the post so every check passes. keep the same idea unless a check forces a change.`;
  }

  if (!last) throw new Error("generation produced no output");

  const notesUsed = notes.filter((n) => last!.sources.includes(`note:${n.id}`));
  return { output: last, guardProblems: lastProblems, costUsd: totalCost, notesUsed };
}
