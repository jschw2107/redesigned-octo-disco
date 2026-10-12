import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { sendEmail, waitlistEmail } from "@/lib/email";
import { siteUrl } from "@/lib/fulfill";
import { handle, body } from "@/lib/http";
import { email, location, str } from "@/lib/validate";

export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const mail = email(b.email);
  let uniId: number | null = null;
  let uniName: string;
  let hallName = "";
  let offCampus = 0;

  if (b.university_id === "other") {
    // School not listed yet: capture it so you can see demand from new campuses.
    uniName = str(b.other_university, "University name", { max: 120 });
    hallName = str(b.other_residence, "Residence", { required: false, max: 120 });
  } else {
    const loc = await location(b);
    uniId = loc.uni.id;
    uniName = loc.uni.name;
    hallName = loc.hallName;
    offCampus = loc.offCampus ? 1 : 0;
  }

  const existing = await one("SELECT 1 FROM waitlist WHERE email=? AND university_name=?", [mail, uniName]);
  await run(
    `INSERT INTO waitlist (created_at, email, university_id, university_name, hall_name, off_campus)
     VALUES (?,?,?,?,?,?) ON CONFLICT(email, university_name) DO UPDATE SET hall_name=excluded.hall_name, off_campus=excluded.off_campus`,
    [new Date().toISOString(), mail, uniId, uniName, hallName, offCampus]
  );
  if (!existing) await sendEmail(waitlistEmail({ email: mail, university: uniName, url: await siteUrl(req) }));
  return NextResponse.json({ ok: true, alreadyJoined: !!existing });
});
