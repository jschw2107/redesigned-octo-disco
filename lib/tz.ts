// Converting between UTC instants and wall-clock times in a named time zone,
// so the admin schedule is always edited in the business's time zone (not the browser's).

function parts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function offsetMs(ms: number, tz: string) {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** ISO instant → "YYYY-MM-DDTHH:mm" as seen in `tz` (for <input type="datetime-local">). */
export function isoToLocalInput(iso: string, tz: string) {
  const p = parts(Date.parse(iso), tz);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** "YYYY-MM-DDTHH:mm" wall-clock time in `tz` → ISO instant. */
export function localInputToIso(local: string, tz: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz); // second pass handles DST boundaries
  return new Date(t).toISOString();
}

/** Adds whole days keeping the same wall-clock time in `tz` (so 8:00 PM stays 8:00 PM across DST changes). */
export function addDaysInTz(iso: string, days: number, tz: string) {
  const local = isoToLocalInput(iso, tz);
  const [date, time] = local.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, mo - 1, d + days));
  const z = (n: number) => String(n).padStart(2, "0");
  return localInputToIso(`${shifted.getUTCFullYear()}-${z(shifted.getUTCMonth() + 1)}-${z(shifted.getUTCDate())}T${time}`, tz)!;
}
