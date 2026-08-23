import { config } from "../config.js";
import type { Writer } from "./types.js";
import { cliWriter } from "./cli.js";
import { apiWriter } from "./api.js";

export function getWriter(): Writer {
  return config.writer === "api" ? apiWriter : cliWriter;
}

export type { Writer, WriteInput, WriteResult } from "./types.js";
