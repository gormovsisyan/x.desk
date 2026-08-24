import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { z } from "zod";
import { config } from "../config.js";
import { logEvent } from "../db/index.js";
import { getFallbackModels } from "../gen/model.js";
import type { CliOverrides, Writer } from "./types.js";

const execFileP = promisify(execFile);

const TIMEOUT_MS = 120_000;
// --json-schema delivers the output via a structured-output tool call, which
// consumes a turn of its own — 1 turn is a guaranteed error_max_turns.
const MAX_TURNS = "3";

interface Envelope {
  type?: string;
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  num_turns?: number;
  session_id?: string;
  errors?: string[];
}

/** Fallback when structured_output is absent: pull the JSON object out of `result`. */
export function extractJson(raw: string): unknown {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in CLI result");
  return JSON.parse(stripped.slice(start, end + 1));
}

async function invoke(
  system: string,
  prompt: string,
  model: string,
  schemaJson: unknown,
  fallbacks: string[],
  overrides?: CliOverrides,
): Promise<Envelope> {
  fs.mkdirSync(config.cliSandboxDir, { recursive: true });
  const args = [
    "-p",
    prompt,
    "--system-prompt",
    system,
    "--model",
    model,
    "--output-format",
    "json",
    "--max-turns",
    String(overrides?.maxTurns ?? MAX_TURNS),
    // no hooks, MCP servers, CLAUDE.md, skills, or plugins — a plain writer.
    // (the empty sandbox cwd alone would not stop user-level hooks/MCP.)
    "--safe-mode",
    "--json-schema",
    JSON.stringify(schemaJson),
    // degrade to a lighter model when the primary is overloaded or the
    // subscription allowance is exhausted, rather than losing the slot
    ...(fallbacks.length > 0 ? ["--fallback-model", fallbacks.join(",")] : []),
    ...(overrides?.allowedTools
      ? ["--allowedTools", overrides.allowedTools.join(",")]
      : ["--disallowedTools", "Bash,Edit,Write,WebFetch,WebSearch"]),
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    // stdin must be closed: with a dangling pipe, claude -p stalls 3 s waiting for it
    const child = spawn(config.claudeBin, args, {
      cwd: overrides?.cwd ?? config.cliSandboxDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      if (signal) reject(new Error(`claude -p killed (${signal}, timeout ${TIMEOUT_MS}ms)`));
      else if (exitCode !== 0 && out.trim() === "")
        reject(new Error(`claude -p exit ${exitCode}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
  });
  return JSON.parse(stdout.trim().split("\n")[0]) as Envelope;
}

/**
 * `claude -p` on the Max subscription. Requires `claude auth status` to pass
 * and refuses to coexist with ANTHROPIC_API_KEY (asserted in config).
 */
export const cliWriter: Writer = {
  async write({ system, prompt, model, schema, itemId, kind, cliOptions }) {
    // the CLI's validator rejects zod's 2020-12 "$schema" marker
    const { $schema: _, ...schemaJson } = z.toJSONSchema(schema);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      const effectivePrompt =
        attempt === 0
          ? prompt
          : `${prompt}\n\nyour previous reply was not valid against the schema (${String(
              lastError,
            ).slice(0, 200)}). respond with a single JSON object matching the schema.`;
      let envelope: Envelope;
      try {
        envelope = await invoke(
          system,
          effectivePrompt,
          model,
          schemaJson,
          getFallbackModels().filter((m) => m !== model),
          cliOptions,
        );
      } catch (err) {
        lastError = err;
        logEvent(kind ?? "gen", itemId ?? null, { writer: "cli", model, spawn_error: String(err) }, 0);
        continue;
      }
      logEvent(
        kind ?? "gen",
        itemId ?? null,
        {
          writer: "cli",
          model,
          subtype: envelope.subtype,
          num_turns: envelope.num_turns,
          reported_cost_usd: envelope.total_cost_usd, // covered by the subscription
          duration_ms: Date.now() - started,
          session_id: envelope.session_id,
        },
        0,
      );
      if (envelope.is_error) {
        lastError = new Error(
          `claude -p error (${envelope.subtype}): ${envelope.errors?.join("; ") ?? envelope.result ?? "unknown"}`,
        );
        continue;
      }
      try {
        const raw = envelope.structured_output ?? extractJson(envelope.result ?? "");
        return { data: schema.parse(raw), costUsd: 0 };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  },
};

/** `claude auth status` must exit 0 under this user/PATH before scheduled runs. */
export async function assertCliAuth(): Promise<void> {
  try {
    const { stdout } = await execFileP(config.claudeBin, ["auth", "status"], {
      timeout: 30_000,
    });
    const status = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string };
    if (!status.loggedIn) throw new Error("claude CLI is not logged in");
    console.log(`claude auth ok (${status.authMethod ?? "unknown method"})`);
  } catch (err) {
    throw new Error(
      `WRITER=cli but \`${config.claudeBin} auth status\` failed — run \`claude auth login\` ` +
        `under the same user and PATH that launchd uses. cause: ${String(err)}`,
    );
  }
}
