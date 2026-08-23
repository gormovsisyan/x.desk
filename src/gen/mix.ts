import { config } from "../config.js";
import { getSetting, setSetting } from "../db/index.js";

/** The weekly mix: pillar quotas plus the question/thread format slots. */
export interface WeeklyMix {
  pillars: Record<string, number>;
  question: number;
  thread: number;
}

const DEFAULT_MIX: WeeklyMix = {
  pillars: { "building in public": 4, "claude code": 3, life: 3, leadership: 2 },
  question: 1,
  thread: 1,
};

export const slotsPerWeek = () => config.slots.length * 7;

export function getWeeklyMix(): WeeklyMix {
  const raw = getSetting("weekly_mix");
  if (!raw) return DEFAULT_MIX;
  try {
    const parsed = JSON.parse(raw) as WeeklyMix;
    if (parsed && parsed.pillars && Object.keys(parsed.pillars).length > 0) return parsed;
  } catch {
    /* fall through to default */
  }
  return DEFAULT_MIX;
}

/** The pillar whose posts are about your products (recap, product-mention rule). */
export function getProductPillar(): string {
  return getSetting("product_pillar") ?? Object.keys(getWeeklyMix().pillars)[0];
}

export function describeMix(mix: WeeklyMix = getWeeklyMix()): string {
  const parts = Object.entries(mix.pillars).map(([p, n]) => `${n}× ${p}`);
  if (mix.question > 0) parts.push(`${mix.question}× question`);
  if (mix.thread > 0) parts.push(`${mix.thread}× thread`);
  return parts.join(", ");
}

/**
 * Parse "/settings mix building in public=4, claude code=3, life=3,
 * leadership=2, question=1, thread=1". Counts must fill the week exactly.
 */
export function parseAndSaveMix(input: string): { ok: true; mix: WeeklyMix } | { ok: false; error: string } {
  const mix: WeeklyMix = { pillars: {}, question: 0, thread: 0 };
  for (const piece of input.split(",")) {
    const m = /^\s*(.+?)\s*=\s*(\d+)\s*$/.exec(piece);
    if (!m) return { ok: false, error: `can't parse "${piece.trim()}" — use name=count` };
    const name = m[1].toLowerCase();
    const n = Number(m[2]);
    if (name === "question") mix.question = n;
    else if (name === "thread") mix.thread = n;
    else mix.pillars[name] = n;
  }
  if (Object.keys(mix.pillars).length === 0) {
    return { ok: false, error: "at least one pillar is required" };
  }
  const total =
    Object.values(mix.pillars).reduce((a, b) => a + b, 0) + mix.question + mix.thread;
  if (total !== slotsPerWeek()) {
    return {
      ok: false,
      error: `counts sum to ${total} but the week has ${slotsPerWeek()} slots (${config.slots.length}/day × 7)`,
    };
  }
  setSetting("weekly_mix", JSON.stringify(mix));
  return { ok: true, mix };
}
