/** MarkdownV2 escaping for text outside code spans. */
export function esc(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/** Tap-to-copy code span; inside code entities only ` and \ are escaped. */
export function code(s: string): string {
  return "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}
