import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
export const VOICE_PATH = path.join(ROOT, "voice.md");
export const FACTS_PATH = path.join(ROOT, "facts.md");

export function readVoice(): string {
  return fs.existsSync(VOICE_PATH) ? fs.readFileSync(VOICE_PATH, "utf8") : "";
}

export function readFacts(): string {
  return fs.existsSync(FACTS_PATH) ? fs.readFileSync(FACTS_PATH, "utf8") : "";
}

export function appendFact(fact: string): void {
  const current = readFacts();
  const next = current.trimEnd() + `\n- ${fact}\n`;
  fs.writeFileSync(FACTS_PATH, next);
}

/**
 * Guardable phrases from the "## banned" (or "## banned phrases") section.
 * Bullets may hold comma-separated lists ("game changer, insane, wild.");
 * sentence-length bullets are rules for the prompt, not literal phrases —
 * anything over 4 words is skipped (the model still sees the full section).
 */
export function bannedPhrases(): string[] {
  const voice = readVoice();
  const match = voice.match(/## banned(?: phrases)?\n([\s\S]*?)(?:\n## |$)/);
  if (!match) return [];
  const phrases: string[] = [];
  for (const line of match[1].split("\n")) {
    if (!line.trim().startsWith("- ")) continue;
    for (let piece of line.trim().slice(2).split(",")) {
      piece = piece.trim().replace(/\.$/, "").replace(/^and (the )?/, "").replace(/^"|"$/g, "");
      if (!piece || piece.length < 3) continue;
      if (piece.split(/\s+/).length > 4) continue; // a rule, not a phrase
      if (/^any /.test(piece) || piece.includes("more than")) continue;
      phrases.push(piece.toLowerCase());
    }
  }
  return [...new Set(phrases)];
}

/** `/voice ban <phrase>` — appends to the banned list, effective immediately. */
export function addBannedPhrase(phrase: string): void {
  const voice = readVoice();
  const heading = voice.includes("## banned phrases") ? "## banned phrases" : "## banned";
  if (voice.includes(heading)) {
    const next = voice.replace(`${heading}\n`, `${heading}\n- ${phrase}\n`);
    fs.writeFileSync(VOICE_PATH, next);
  } else {
    fs.writeFileSync(VOICE_PATH, voice.trimEnd() + `\n\n## banned\n- ${phrase}\n`);
  }
}
