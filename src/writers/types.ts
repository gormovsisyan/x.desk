import type { z } from "zod";

/** cli-backend overrides for repo-grounded runs (ignored by the api backend). */
export interface CliOverrides {
  cwd?: string;
  /** allowlist replaces the default tool blocklist, e.g. ["Bash(git log:*)", "Read"] */
  allowedTools?: string[];
  maxTurns?: number;
}

export interface WriteInput<T> {
  system: string;
  prompt: string;
  model: string;
  schema: z.ZodType<T>;
  /** for event logging */
  itemId?: string | null;
  kind?: string;
  cliOptions?: CliOverrides;
}

export interface WriteResult<T> {
  data: T;
  /** billed cost — 0 for the cli backend (subscription allowance) */
  costUsd: number;
}

export interface Writer {
  write<T>(input: WriteInput<T>): Promise<WriteResult<T>>;
}
