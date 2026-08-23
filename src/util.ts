export const nowIso = () => new Date().toISOString();

export const addMinutes = (d: Date, min: number) =>
  new Date(d.getTime() + min * 60_000);

export const minutesFromNowIso = (min: number) =>
  addMinutes(new Date(), min).toISOString();

/** "18:00" in a tz -> hh:mm label, minus offset minutes, as a cron expression. */
export function cronAtOffset(slot: string, offsetMin: number): string {
  const [h, m] = slot.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`bad slot time: ${slot}`);
  const total = (h * 60 + m + offsetMin + 1440) % 1440;
  return `${total % 60} ${Math.floor(total / 60)} * * *`;
}

/** Format a Date as HH:MM in the given timezone. */
export function hhmmInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
}

/** Format a Date as YYYY-MM-DD in the given timezone. */
export function dateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

/** "mon".."sun" for a Date in the given timezone. */
export function dayKeyInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz })
    .format(d)
    .toLowerCase()
    .slice(0, 3);
}

/** The Monday date "YYYY-MM-DD" of the week containing today (the plan key). */
export function weekKey(tz: string): string {
  return weekStartIso(tz).slice(0, 10);
}

/** A "YYYY-MM-DD" date plus n days. */
export function datePlusDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** ISO string of the most recent Monday 00:00 (approx, tz-based date arithmetic). */
export function weekStartIso(tz: string): string {
  const now = new Date();
  // walk back day by day until the tz-local weekday is Monday
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: tz,
    }).format(d);
    if (weekday === "Mon") {
      return `${dateInTz(d, tz)}T00:00:00`;
    }
  }
  return `${dateInTz(now, tz)}T00:00:00`;
}
