import twitter from "twitter-text";

export interface GuardContext {
  /** Normalized number strings allowed to appear in a post (from data block + notes + facts). */
  allowedNumbers: Set<string>;
  /** Texts of the last ~60 approved posts (dedupe target). */
  recentPosts: string[];
  bannedPhrases: string[];
  /** true for the weekly question post; otherwise a trailing "?" is a violation */
  allowQuestions?: boolean;
}

export function weightedLength(text: string): number {
  return twitter.parseTweet(text).weightedLength;
}

/** All numeric tokens in a string, commas stripped ("1,400" -> "1400"). */
export function extractNumbers(s: string): string[] {
  const matches = s.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((n) => n.replace(/,/g, ""));
}

function trigrams(s: string): Set<string> {
  const normalized = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const padded = `  ${normalized} `;
  const set = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) set.add(padded.slice(i, i + 3));
  return set;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / (ta.size + tb.size - intersection);
}

/** Returns a list of guard violations; empty array = the text passes. */
export function runGuards(text: string, ctx: GuardContext): string[] {
  const problems: string[] = [];

  const parsed = twitter.parseTweet(text);
  if (!parsed.valid || parsed.weightedLength > 280) {
    problems.push(`too long: ${parsed.weightedLength}/280 weighted chars`);
  }
  if (/[A-Z]/.test(text)) {
    problems.push("contains uppercase letters; the register is lowercase only");
  }
  if (twitter.extractHashtags(text).length > 0 || /#\w/.test(text)) {
    problems.push("contains a hashtag");
  }
  if (/\p{Extended_Pictographic}/u.test(text)) {
    problems.push("contains an emoji");
  }
  if (twitter.extractUrls(text).length > 0) {
    problems.push("contains a url in text; links go in link_reply");
  }
  if (text.includes("@")) {
    problems.push("contains an @mention");
  }
  if (text.includes("!")) {
    problems.push("contains an exclamation mark; the register bans them");
  }
  if (!ctx.allowQuestions && /\?["']?\s*$/.test(text.trim())) {
    problems.push(
      "ends with a question; questions to the reader are only for the weekly question post",
    );
  }
  for (const phrase of ctx.bannedPhrases) {
    if (phrase && text.toLowerCase().includes(phrase.toLowerCase())) {
      problems.push(`contains banned phrase: "${phrase}"`);
    }
  }
  for (const num of extractNumbers(text)) {
    if (!ctx.allowedNumbers.has(num)) {
      problems.push(`number ${num} does not appear in the data block or any note`);
    }
  }
  for (const past of ctx.recentPosts) {
    const sim = trigramSimilarity(text, past);
    if (sim >= 0.6) {
      problems.push(
        `too similar (${sim.toFixed(2)}) to a recent post: "${past.slice(0, 60)}…"`,
      );
      break;
    }
  }
  return problems;
}
