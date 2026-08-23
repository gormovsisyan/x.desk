import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const Env = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_USER_ID: z.coerce.number().int(),
  WRITER: z.enum(["cli", "api"]).default("cli"),
  ANTHROPIC_API_KEY: z.string().optional(),
  MODEL_WRITE: z.string().default("claude-fable-5"),
  CLAUDE_BIN: z.string().default("claude"),
  CLI_SANDBOX_DIR: z.string().default(path.join(os.homedir(), "xdesk", "sandbox")),
  NPM_PACKAGES: z.string().default(""),
  GITHUB_REPOS: z.string().default(""),
  REPO_PATHS: z.string().default(""),
  TZ: z.string().default("UTC"),
  SLOTS: z.string().default("18:00,22:00"),
  DB_PATH: z.string().default("./data/xdesk.sqlite"),
});

const parsed = Env.parse(process.env);

// With WRITER=cli, a stray API credential makes `claude -p` silently bill the
// API account instead of drawing on the Max subscription. Refuse to start.
if (parsed.WRITER === "cli") {
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    if (process.env[name]) {
      throw new Error(
        `WRITER=cli but ${name} is set — claude -p would silently bill the API account. ` +
          `unset it, or switch to WRITER=api deliberately.`,
      );
    }
  }
}

const splitCsv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && !x.startsWith("<"));

export const config = {
  telegramToken: parsed.TELEGRAM_BOT_TOKEN,
  telegramUserId: parsed.TELEGRAM_USER_ID,
  writer: parsed.WRITER,
  modelWrite: parsed.MODEL_WRITE,
  claudeBin: parsed.CLAUDE_BIN,
  cliSandboxDir: parsed.CLI_SANDBOX_DIR,
  npmPackages: splitCsv(parsed.NPM_PACKAGES),
  githubRepos: splitCsv(parsed.GITHUB_REPOS),
  repoPaths: splitCsv(parsed.REPO_PATHS),
  tz: parsed.TZ,
  slots: splitCsv(parsed.SLOTS),
  dbPath: parsed.DB_PATH,
};

export type Config = typeof config;
