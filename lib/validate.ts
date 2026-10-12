import { one } from "./db";
import { OFF_CAMPUS_LABEL, EMAIL_RE, type Hall, type University } from "./data";

export class InputError extends Error {}

export function str(v: unknown, field: string, { max = 200, required = true } = {}): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new InputError(`${field} is required`);
  if (s.length > max) throw new InputError(`${field} is too long`);
  return s;
}

export function email(v: unknown): string {
  const s = str(v, "Email", { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw new InputError("Enter a valid email address");
  return s;
}

/**
 * Validates a university + residence choice. `hall_id` must be one of the university's halls,
 * unless `off_campus` is true (then the student lives in an off-campus apartment).
 */
export async function location(body: Record<string, unknown>) {
  const uniId = Number(body.university_id);
  if (!Number.isInteger(uniId)) throw new InputError("Choose your university");
  const uni = await one<University>("SELECT * FROM universities WHERE id=? AND active=1", [uniId]);
  if (!uni) throw new InputError("Choose your university");
  const offCampus = body.off_campus === true;
  if (offCampus) {
    const apartment = str(body.apartment, "Apartment", { required: false, max: 120 });
    return { uni, hall: null as Hall | null, offCampus, hallName: OFF_CAMPUS_LABEL, apartment };
  }
  const hallId = Number(body.hall_id);
  const hall = Number.isInteger(hallId)
    ? await one<Hall>("SELECT * FROM halls WHERE id=? AND university_id=?", [hallId, uni.id])
    : null;
  if (!hall) throw new InputError("Choose your residence hall (or off-campus apartment)");
  return { uni, hall, offCampus, hallName: hall.name, apartment: "" };
}

export function newOrderId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return "GB-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
