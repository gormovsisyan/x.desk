import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { logEvent } from "../db/index.js";
import type { Writer } from "./types.js";

// Fable 5 first-party rates, USD per MTok.
const PRICE = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * Messages API backend (WRITER=api). voice+facts system block is cached with
 * cache_control; thinking is always on for Fable 5 so no `thinking` param;
 * server-side refusal fallback to claude-opus-4-8 keeps a rare safety decline
 * from killing a slot.
 */
export const apiWriter: Writer = {
  async write({ system, prompt, model, schema, itemId, kind }) {
    const response = await getClient().beta.messages.create({
      model,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(schema) },
    });

    const usage = response.usage;
    const costUsd =
      ((usage.input_tokens ?? 0) * PRICE.input +
        (usage.output_tokens ?? 0) * PRICE.output +
        (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
        (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) /
      1_000_000;

    logEvent(
      kind ?? "gen",
      itemId ?? null,
      {
        writer: "api",
        model: response.model,
        stop_reason: response.stop_reason,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read: usage.cache_read_input_tokens,
        cache_write: usage.cache_creation_input_tokens,
      },
      costUsd,
    );

    if (response.stop_reason === "refusal") {
      const detail = response.stop_details?.explanation ?? "no explanation";
      throw new Error(`model declined the request (refusal): ${detail}`);
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { data: schema.parse(JSON.parse(text)), costUsd };
  },
};
