import { config } from "../config.js";
import { getSetting, setSetting, deleteSetting } from "../db/index.js";

/**
 * Known models, cheapest-effort last. `aliases` are what the user (and the
 * claude CLI) may type; `id` is what gets sent. Unknown ids are accepted with
 * a warning rather than rejected — new models ship faster than this list.
 */
export const KNOWN_MODELS: { id: string; aliases: string[]; note: string }[] = [
  { id: "claude-fable-5", aliases: ["fable", "fable-5"], note: "most capable, heaviest on the allowance" },
  { id: "claude-opus-5", aliases: ["opus", "opus-5"], note: "strong, lighter than fable" },
  { id: "claude-sonnet-5", aliases: ["sonnet", "sonnet-5"], note: "good voice, much lighter — the allowance-saver" },
  { id: "claude-haiku-4-5-20251001", aliases: ["haiku", "haiku-4-5"], note: "cheapest; fine for filtering, thin for posts" },
];

export function resolveModel(input: string): { id: string; known: boolean } {
  const q = input.trim().toLowerCase();
  for (const m of KNOWN_MODELS) {
    if (m.id === q || m.aliases.includes(q)) return { id: m.id, known: true };
  }
  return { id: input.trim(), known: false };
}

/** The model used for posts, plan, and recap — settings override, then env. */
export function getWriteModel(): string {
  return getSetting("model_write") ?? config.modelWrite;
}

export function setWriteModel(id: string): void {
  setSetting("model_write", id);
}

export function resetWriteModel(): void {
  deleteSetting("model_write");
}

/**
 * Models the cli writer may fall back to when the primary is overloaded or
 * the subscription allowance is exhausted. Defaults to the next-lighter
 * known model after the active one, so a bad allowance day degrades to a
 * post instead of an error.
 */
export function getFallbackModels(): string[] {
  const stored = getSetting("model_fallbacks");
  if (stored !== undefined) {
    return stored.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const active = getWriteModel();
  const idx = KNOWN_MODELS.findIndex((m) => m.id === active);
  if (idx === -1) return ["claude-sonnet-5"];
  return KNOWN_MODELS.slice(idx + 1).map((m) => m.id);
}

export function setFallbackModels(ids: string[]): void {
  setSetting("model_fallbacks", ids.join(","));
}

export function describeModels(): string {
  const active = getWriteModel();
  const overridden = getSetting("model_write") !== undefined;
  const fallbacks = getFallbackModels();
  const lines = [
    `model: ${active}${overridden ? " (override)" : " (from .env)"}`,
    `fallback: ${fallbacks.length ? fallbacks.join(" → ") : "none"}`,
    "",
    "options:",
  ];
  for (const m of KNOWN_MODELS) {
    lines.push(`  ${m.aliases[0]} — ${m.note}${m.id === active ? "  ← active" : ""}`);
  }
  lines.push("", "/model sonnet — switch · /model reset — back to .env");
  return lines.join("\n");
}
