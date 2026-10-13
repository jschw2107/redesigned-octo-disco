import { db } from "@/lib/db";

/** Serves an uploaded product picture. Each upload gets a new id, so it can be cached forever. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return new Response("Not found", { status: 404 });
  const r = await (await db()).execute({ sql: "SELECT mime, data FROM images WHERE id=?", args: [id] });
  if (!r.rows.length) return new Response("Not found", { status: 404 });
  const mime = String(r.rows[0][0]);
  const data = r.rows[0][1] as ArrayBuffer;
  return new Response(new Uint8Array(data), {
    headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
  });
}
