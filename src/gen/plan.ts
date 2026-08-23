import { z } from "zod";
import { config } from "../config.js";
import { getPlan, openNotes, savePlan, type PlanEntry } from "../db/index.js";
import { buildDataBlock, lastPosts } from "../data/history.js";
import { getWriter } from "../writers/index.js";
import { buildSystemText } from "./posts.js";
import { datePlusDays } from "../util.js";

const PlanEntryOut = z.object({
  day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  time: z.string(),
  pillar: z.string(),
  angle: z.string(),
  source: z.string().nullable(),
  format: z.enum(["single", "thread", "question"]),
});
const PlanOut = z.object({ slots: z.array(PlanEntryOut) });
type PlanOutT = z.infer<typeof PlanOut>;

const MIX_SPEC =
  "the weekly mix, exactly: 4 building in public, 2 leadership, 3 claude code, 3 life, " +
  "1 question post (format question), 1 thread (format thread) — 14 slots total, " +
  `two per day at ${config.slots.join(" and ")}. ` +
  "spread building in public across the week, never two product posts in a row on the same day. " +
  "posts outside building in public do not mention the side projects. " +
  `the friday ${config.slots[0]} slot is the weekly recap: pillar building in public, ` +
  'angle "friday recap: downloads / shipped / broke / learned / next week", source "git + week notes". ' +
  "each angle is one concrete line; source names the material (a note, npm weekly, a fact, or null if none needed).";

async function contextBlock(): Promise<string> {
  const notes = openNotes(7);
  const history = lastPosts(60);
  const lines: string[] = [];
  if (notes.length > 0) {
    lines.push("open notes (material to plan around):");
    for (const n of notes) lines.push(`- [${n.created_at.slice(0, 10)}] ${n.text}`);
  } else {
    lines.push("open notes: none.");
  }
  lines.push("");
  lines.push(await buildDataBlock());
  if (history.length > 0) {
    lines.push("");
    lines.push("recent posts (don't plan repeats):");
    for (const h of history.slice(0, 30)) lines.push(`- ${h.text}`);
  }
  return lines.join("\n");
}

/** Generate and save the plan for the week starting `week` (a Monday date). */
export async function generateWeeklyPlan(week: string): Promise<PlanEntry[]> {
  const prompt =
    `plan the 14 posting slots for the week of ${week} (monday) through ${datePlusDays(week, 6)} (sunday).\n\n` +
    `${MIX_SPEC}\n\n${await contextBlock()}`;
  const result = await getWriter().write<PlanOutT>({
    system: buildSystemText(),
    prompt,
    model: config.modelWrite,
    schema: PlanOut,
    kind: "gen_plan",
  });
  savePlan(week, result.data.slots);
  return getPlan(week);
}

/** Apply a free-text edit ("swap tue 22:00 for a product post") to a saved plan. */
export async function applyPlanEdit(week: string, instruction: string): Promise<PlanEntry[]> {
  const current = getPlan(week);
  const prompt =
    `here is the current plan for the week of ${week} as JSON:\n` +
    `${JSON.stringify({ slots: current.map(({ week: _w, ...e }) => e) })}\n\n` +
    `apply this edit and return the full updated plan (all 14 slots): ${instruction}\n\n` +
    MIX_SPEC;
  const result = await getWriter().write<PlanOutT>({
    system: buildSystemText(),
    prompt,
    model: config.modelWrite,
    schema: PlanOut,
    kind: "gen_plan_edit",
  });
  savePlan(week, result.data.slots);
  return getPlan(week);
}

export function renderPlanDigest(week: string, entries: PlanEntry[]): string {
  const lines = [`plan for the week of ${week}`];
  let lastDay = "";
  for (const e of entries) {
    if (e.day !== lastDay) {
      lines.push("");
      lastDay = e.day;
    }
    const format = e.format !== "single" ? ` · ${e.format}` : "";
    lines.push(`${e.day} ${e.time} · ${e.pillar}${format}`);
    lines.push(`   ${e.angle}${e.source ? ` (${e.source})` : ""}`);
  }
  lines.push("");
  lines.push('reply to this message to edit ("swap tue 22:00 for a product post")');
  return lines.join("\n");
}
