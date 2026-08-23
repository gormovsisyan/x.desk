import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";
import { notesConsumedSince } from "../db/index.js";
import { generatePost, type GeneratedPost } from "./posts.js";
import { getProductPillar } from "./mix.js";
import { weekStartIso } from "../util.js";

const RepoSummary = z.object({
  shipped: z.array(z.string()),
  broke: z.array(z.string()),
  learned: z.array(z.string()),
  commit_count: z.number(),
});
type RepoSummaryT = z.infer<typeof RepoSummary>;

/**
 * Repo-grounded mode (cli writer only): claude -p inside the repo with
 * read-only git tools, deriving the week's shipped / broke / learned from
 * commits since Monday. Git-derived numbers become legal in the post.
 */
async function repoWeekSummary(repoPath: string, sinceDate: string): Promise<string | null> {
  if (config.writer !== "cli") return null;
  if (!fs.existsSync(path.join(repoPath, ".git"))) return null;
  const { getWriter } = await import("../writers/index.js");
  try {
    const result = await getWriter().write<RepoSummaryT>({
      system:
        "you summarize one git repository's week for its own author. " +
        "use only what the git history and files actually show; empty lists are fine.",
      prompt:
        `summarize this repo's week from commits since ${sinceDate} (use git log/shortlog/diff --stat). ` +
        "shipped: user-visible things that landed. broke: what broke or was reverted. " +
        "learned: one line per real lesson, only if the history shows one. " +
        "commit_count: commits since that date. keep every line short and concrete.",
      model: config.modelWrite,
      schema: RepoSummary,
      kind: "gen_repo_summary",
      cliOptions: {
        cwd: repoPath,
        allowedTools: [
          "Bash(git log:*)",
          "Bash(git diff --stat:*)",
          "Bash(git shortlog:*)",
          "Read",
        ],
        maxTurns: 8,
      },
    });
    const name = path.basename(repoPath);
    const lines = [`${name} (${result.data.commit_count} commits this week):`];
    for (const s of result.data.shipped) lines.push(`- shipped: ${s}`);
    for (const b of result.data.broke) lines.push(`- broke: ${b}`);
    for (const l of result.data.learned) lines.push(`- learned: ${l}`);
    return lines.join("\n");
  } catch (err) {
    console.error(`repo summary failed for ${repoPath}:`, err);
    return null;
  }
}

/**
 * The Friday recap: built from the week's consumed notes, live numbers, and
 * (in cli mode) git history of the configured repos. Missing lines are
 * dropped, never invented — that instruction rides in the angle.
 */
export async function generateRecap(opts: {
  slotLabel: string;
  itemId?: string | null;
}): Promise<GeneratedPost> {
  const sinceIso = weekStartIso(config.tz);
  const sinceDate = sinceIso.slice(0, 10);

  const material: string[] = [];
  for (const repo of config.repoPaths) {
    const summary = await repoWeekSummary(repo, sinceDate);
    if (summary) material.push(summary);
  }
  const consumed = notesConsumedSince(sinceIso);
  if (consumed.length > 0) {
    material.push("notes already used in this week's posts (recap may reuse them):");
    for (const n of consumed) material.push(`- ${n.text}`);
  }

  return generatePost({
    slotLabel: opts.slotLabel,
    pillar: getProductPillar(),
    format: "recap",
    angle:
      "friday recap of the week: downloads / shipped / broke / learned / next week. " +
      "drop any line you have no material for — never invent one. no brackets, no placeholders.",
    extraMaterial: material.length > 0 ? `this week's material:\n${material.join("\n")}` : null,
    itemId: opts.itemId,
  });
}
