import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { handle, body } from "@/lib/http";
import { InputError, email } from "@/lib/validate";

/** "I'd join this": adds a supporter to an approved request. One per email. */
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const id = Number(b.request_id);
  const mail = email(b.email);
  const r = await one<{ id: number }>("SELECT id FROM requests WHERE id=? AND status='approved'", [id]);
  if (!r) throw new InputError("This request isn't open for votes.");
  await run("INSERT OR IGNORE INTO request_votes (request_id, email, created_at) VALUES (?,?,?)", [id, mail, new Date().toISOString()]);
  const n = await one<{ n: number }>("SELECT COUNT(*) AS n FROM request_votes WHERE request_id=?", [id]);
  return NextResponse.json({ ok: true, votes: (n?.n ?? 0) + 1 });
});
