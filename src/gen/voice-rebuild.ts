import fs from "node:fs";
import path from "node:path";
import { recentRejected, topVoiceExamples } from "../db/index.js";
import { readVoice, VOICE_PATH } from "./voice.js";
import { dateInTz } from "../util.js";
import { config } from "../config.js";

const MIN_KEPT_EXAMPLES = 15;
const MAX_EXAMPLES = 40;

export interface RebuildResult {
  skipped: boolean;
  approved: number;
  edited: number;
  padded: number;
  rejectedUsed: number;
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " / ").trim();

function currentExampleBullets(voice: string): string[] {
  const match = voice.match(/## examples[^\n]*\n([\s\S]*?)(?=\n## |$)/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .filter((l) => l.trim().startsWith("- ") && !l.includes("<!--"))
    .map((l) => l.trim().slice(2).trim())
    .filter((t) => t.length > 0);
}

/**
 * Sunday 19:00: regenerate the examples section from approved posts (edited
 * first — the strongest signal) and the avoid section from recent rejections.
 * While approved history is thin, existing examples pad the list so the seed
 * register isn't wiped by the first few real posts.
 */
export function rebuildVoiceSections(voicePath: string = VOICE_PATH): RebuildResult {
  const approved = topVoiceExamples(MAX_EXAMPLES);
  if (approved.length === 0) {
    return { skipped: true, approved: 0, edited: 0, padded: 0, rejectedUsed: 0 };
  }

  const voice = fs.readFileSync(voicePath, "utf8");

  // keep a dated backup — voice.md is gitignored, so git can't restore it
  const backupDir = path.join(path.dirname(voicePath), "data", "voice-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  fs.writeFileSync(path.join(backupDir, `voice-${stamp}.md`), voice);

  const bullets = approved.map((e) => oneLine(e.text));
  const seen = new Set(bullets);
  let padded = 0;
  if (bullets.length < MIN_KEPT_EXAMPLES) {
    for (const existing of currentExampleBullets(voice)) {
      if (bullets.length >= MIN_KEPT_EXAMPLES) break;
      if (seen.has(existing)) continue;
      seen.add(existing);
      bullets.push(existing);
      padded++;
    }
  }

  const today = dateInTz(new Date(), config.tz);
  const examplesSection =
    `## examples — rebuilt ${today} from approved posts, edited first\n` +
    bullets.map((b) => `- ${b}`).join("\n");

  const rejected = recentRejected(10);
  const avoidSection =
    `## avoid patterns like — rejected, maintained by the bot\n` +
    (rejected.length > 0
      ? rejected.map((r) => `- ${oneLine(r.text).slice(0, 200)}`).join("\n")
      : "(empty)");

  let next = voice.replace(/## examples[^\n]*\n[\s\S]*?(?=\n## |\s*$)/, `${examplesSection}\n`);
  next = next.replace(
    /## avoid patterns like[^\n]*\n[\s\S]*?(?=\n## |\s*$)/,
    `${avoidSection}\n`,
  );
  if (!next.includes("## avoid patterns like")) next = `${next.trimEnd()}\n\n${avoidSection}\n`;
  fs.writeFileSync(voicePath, next);

  return {
    skipped: false,
    approved: approved.length,
    edited: approved.filter((e) => e.was_edited === 1).length,
    padded,
    rejectedUsed: rejected.length,
  };
}
