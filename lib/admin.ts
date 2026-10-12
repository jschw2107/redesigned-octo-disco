import { run } from "./db";
import { InputError } from "./validate";

type FieldType = "text" | "int" | "money" | "bool" | "nullable_money";

/** Converts admin form input into column values. Money comes in as dollars ("7.50"), stored as cents. */
export function coerce(v: unknown, t: FieldType, field: string): string | number | null {
  switch (t) {
    case "text": {
      const s = typeof v === "string" ? v.trim() : "";
      if (s.length > 500) throw new InputError(`${field} is too long`);
      return s;
    }
    case "int": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new InputError(`${field} must be a whole number`);
      return n;
    }
    case "bool":
      return v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
    case "money":
    case "nullable_money": {
      if ((v === "" || v == null) && t === "nullable_money") return null;
      const n = Number(String(v).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new InputError(`${field} must be a price like 7.50`);
      return Math.round(n * 100);
    }
  }
}

export async function updateRow(table: string, id: unknown, b: Record<string, unknown>, fields: Record<string, FieldType>) {
  const rowId = Number(id);
  if (!Number.isInteger(rowId)) throw new InputError("Missing id");
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, t] of Object.entries(fields)) {
    if (k in b) {
      sets.push(`${k}=?`);
      args.push(coerce(b[k], t, k));
    }
  }
  if (!sets.length) throw new InputError("Nothing to update");
  await run(`UPDATE ${table} SET ${sets.join(", ")} WHERE id=?`, [...args, rowId]);
}

export async function insertRow(table: string, b: Record<string, unknown>, fields: Record<string, FieldType>) {
  const cols = Object.keys(fields).filter((k) => k in b);
  const args = cols.map((k) => coerce(b[k], fields[k], k));
  const r = await run(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, args);
  return Number(r.lastInsertRowid);
}

export function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // avoid spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
