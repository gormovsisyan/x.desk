import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { nowIso } from "../util.js";

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, lane TEXT, status TEXT,
  scheduled_for TEXT, remind_at TEXT, snoozes INTEGER DEFAULT 0,
  pillar TEXT, format TEXT, plan_angle TEXT, plan_source TEXT,
  text TEXT, parts TEXT, alt TEXT, link_reply TEXT, rationale TEXT, sources TEXT,
  source_post_id TEXT, source_author TEXT, source_text TEXT, source_url TEXT, source_created_at TEXT,
  score INTEGER, angle TEXT, variants TEXT, expires_at TEXT,
  regen_count INTEGER DEFAULT 0, tg_message_id INTEGER,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS notes          (id TEXT PRIMARY KEY, text TEXT, created_at TEXT, consumed_by TEXT);
CREATE TABLE IF NOT EXISTS plan           (week TEXT, day TEXT, time TEXT, pillar TEXT, angle TEXT, source TEXT, format TEXT, PRIMARY KEY (week, day, time));
CREATE TABLE IF NOT EXISTS metrics_cache  (key TEXT PRIMARY KEY, value TEXT, fetched_at TEXT);
CREATE TABLE IF NOT EXISTS voice_examples (id TEXT PRIMARY KEY, text TEXT, kind TEXT, was_edited INTEGER, engagement INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS rejected       (id TEXT PRIMARY KEY, text TEXT, reason TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS seen_posts     (post_id TEXT PRIMARY KEY, seen_at TEXT);
CREATE TABLE IF NOT EXISTS events         (id TEXT PRIMARY KEY, kind TEXT, item_id TEXT, payload TEXT, cost_usd REAL, created_at TEXT);
CREATE TABLE IF NOT EXISTS settings       (key TEXT PRIMARY KEY, value TEXT);
`);

export type ItemStatus = "pending" | "snoozed" | "done" | "skipped" | "expired";

export interface Item {
  id: string;
  lane: string;
  status: ItemStatus;
  scheduled_for: string | null;
  remind_at: string | null;
  snoozes: number;
  pillar: string | null;
  format: string | null;
  plan_angle: string | null;
  plan_source: string | null;
  text: string | null;
  parts: string | null; // JSON string[]
  alt: string | null;
  link_reply: string | null;
  rationale: string | null;
  sources: string | null; // JSON string[]
  regen_count: number;
  tg_message_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  text: string;
  created_at: string;
  consumed_by: string | null;
}

// ---- items ----

export function createItem(partial: Partial<Item> & { lane: string }): Item {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO items (id, lane, status, scheduled_for, remind_at, snoozes, pillar, format,
       plan_angle, plan_source, text, parts, alt, link_reply, rationale, sources,
       regen_count, tg_message_id, created_at, updated_at)
     VALUES (@id, @lane, @status, @scheduled_for, @remind_at, 0, @pillar, @format,
       @plan_angle, @plan_source, @text, @parts, @alt, @link_reply, @rationale, @sources,
       0, NULL, @created_at, @updated_at)`,
  ).run({
    id,
    lane: partial.lane,
    status: partial.status ?? "pending",
    scheduled_for: partial.scheduled_for ?? null,
    remind_at: partial.remind_at ?? null,
    pillar: partial.pillar ?? null,
    format: partial.format ?? "single",
    plan_angle: partial.plan_angle ?? null,
    plan_source: partial.plan_source ?? null,
    text: partial.text ?? null,
    parts: partial.parts ?? null,
    alt: partial.alt ?? null,
    link_reply: partial.link_reply ?? null,
    rationale: partial.rationale ?? null,
    sources: partial.sources ?? null,
    created_at: now,
    updated_at: now,
  });
  return getItem(id)!;
}

export function getItem(id: string): Item | undefined {
  return db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as Item | undefined;
}

export function updateItem(id: string, fields: Partial<Item>): void {
  const keys = Object.keys(fields).filter((k) => k !== "id");
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE items SET ${sets}, updated_at = @__now WHERE id = @id`).run({
    ...fields,
    id,
    __now: nowIso(),
  });
}

export function itemsDueForReminder(): Item[] {
  return db
    .prepare(
      `SELECT * FROM items
       WHERE lane = 'post' AND status IN ('pending','snoozed')
         AND remind_at IS NOT NULL AND remind_at <= ?`,
    )
    .all(nowIso()) as Item[];
}

export function todaysPostItems(dayPrefixUtc: string): Item[] {
  return db
    .prepare(
      `SELECT * FROM items WHERE lane = 'post' AND scheduled_for LIKE ?
       ORDER BY scheduled_for`,
    )
    .all(`${dayPrefixUtc}%`) as Item[];
}

export function getItemByMessageId(messageId: number): Item | undefined {
  return db.prepare(`SELECT * FROM items WHERE tg_message_id = ?`).get(messageId) as
    | Item
    | undefined;
}

export function sumCostSince(sinceIso: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS c FROM events WHERE created_at >= ?`)
    .get(sinceIso) as { c: number };
  return row.c;
}

export function postItemsSince(sinceIso: string): Item[] {
  return db
    .prepare(`SELECT * FROM items WHERE lane = 'post' AND created_at >= ? ORDER BY created_at`)
    .all(sinceIso) as Item[];
}

/** Last N approved (done) posts, newest first: the history used for continuity + dedupe. */
export function recentDonePosts(n: number): { text: string; date: string; pillar: string | null }[] {
  const rows = db
    .prepare(
      `SELECT text, updated_at AS date, pillar FROM items
       WHERE lane = 'post' AND status = 'done' AND text IS NOT NULL
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(n) as { text: string; date: string; pillar: string | null }[];
  return rows;
}

// ---- notes ----

export function addNote(text: string): Note {
  const id = randomUUID();
  db.prepare(`INSERT INTO notes (id, text, created_at, consumed_by) VALUES (?, ?, ?, NULL)`).run(
    id,
    text,
    nowIso(),
  );
  return { id, text, created_at: nowIso(), consumed_by: null };
}

/** Open (unconsumed) notes from the last `days` days, oldest first. */
export function openNotes(days = 7): Note[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db
    .prepare(
      `SELECT * FROM notes WHERE consumed_by IS NULL AND created_at >= ? ORDER BY created_at`,
    )
    .all(cutoff) as Note[];
}

export function removeNote(id: string): void {
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
}

export function consumeNote(id: string, itemId: string): void {
  db.prepare(`UPDATE notes SET consumed_by = ? WHERE id = ?`).run(itemId, id);
}

/** Notes consumed by posts since a date — the Friday recap's raw material. */
export function notesConsumedSince(sinceIso: string): Note[] {
  return db
    .prepare(
      `SELECT * FROM notes WHERE consumed_by IS NOT NULL AND created_at >= ? ORDER BY created_at`,
    )
    .all(sinceIso) as Note[];
}

// ---- weekly plan ----

export interface PlanEntry {
  week: string; // Monday date YYYY-MM-DD
  day: string; // mon..sun
  time: string; // HH:MM slot
  pillar: string;
  angle: string;
  source: string | null;
  format: string; // single | thread | question
}

export function savePlan(week: string, entries: Omit<PlanEntry, "week">[]): void {
  const insert = db.prepare(
    `INSERT INTO plan (week, day, time, pillar, angle, source, format)
     VALUES (@week, @day, @time, @pillar, @angle, @source, @format)
     ON CONFLICT(week, day, time) DO UPDATE SET
       pillar = excluded.pillar, angle = excluded.angle,
       source = excluded.source, format = excluded.format`,
  );
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM plan WHERE week = ?`).run(week);
    for (const e of entries) insert.run({ ...e, week });
  });
  tx();
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function getPlan(week: string): PlanEntry[] {
  const rows = db.prepare(`SELECT * FROM plan WHERE week = ?`).all(week) as PlanEntry[];
  return rows.sort(
    (a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.time.localeCompare(b.time),
  );
}

export function getPlanEntry(week: string, day: string, time: string): PlanEntry | undefined {
  return db.prepare(`SELECT * FROM plan WHERE week = ? AND day = ? AND time = ?`).get(week, day, time) as
    | PlanEntry
    | undefined;
}

// ---- metrics cache ----

export function getMetric(key: string): { value: string; fetched_at: string } | undefined {
  return db.prepare(`SELECT value, fetched_at FROM metrics_cache WHERE key = ?`).get(key) as
    | { value: string; fetched_at: string }
    | undefined;
}

export function setMetric(key: string, value: string): void {
  db.prepare(
    `INSERT INTO metrics_cache (key, value, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
  ).run(key, value, nowIso());
}

// ---- quality loop ----

export function addVoiceExample(text: string, kind: string, wasEdited: boolean): void {
  db.prepare(
    `INSERT INTO voice_examples (id, text, kind, was_edited, engagement, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(randomUUID(), text, kind, wasEdited ? 1 : 0, nowIso());
}

/** Approved examples for the weekly voice rebuild: edited first, then newest. */
export function topVoiceExamples(n: number): { text: string; was_edited: number }[] {
  return db
    .prepare(
      `SELECT text, was_edited FROM voice_examples
       ORDER BY was_edited DESC, created_at DESC LIMIT ?`,
    )
    .all(n) as { text: string; was_edited: number }[];
}

export function addRejected(text: string, reason: string): void {
  db.prepare(`INSERT INTO rejected (id, text, reason, created_at) VALUES (?, ?, ?, ?)`).run(
    randomUUID(),
    text,
    reason,
    nowIso(),
  );
}

export function recentRejected(n: number): { text: string; reason: string }[] {
  return db
    .prepare(`SELECT text, reason FROM rejected ORDER BY created_at DESC LIMIT ?`)
    .all(n) as { text: string; reason: string }[];
}

// ---- events ----

export function logEvent(kind: string, itemId: string | null, payload: unknown, costUsd = 0): void {
  db.prepare(
    `INSERT INTO events (id, kind, item_id, payload, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), kind, itemId, JSON.stringify(payload ?? null), costUsd, nowIso());
}

export function countEvents(kind: string, itemId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = ? AND item_id = ?`)
    .get(kind, itemId) as { n: number };
  return row.n;
}

// ---- settings ----

export function getSetting(key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function deleteSetting(key: string): void {
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}
