"use client";

import { useId } from "react";

export type Uni = { id: number; name: string; pickup_location: string; halls: { id: number; name: string }[] };

export type Location = {
  university_id: number | "" | "other";
  hall_id: number | null;
  off_campus: boolean;
  apartment: string;
  room: string;
  other_university: string;
  other_residence: string;
};

export const emptyLocation = (universities: Uni[], preferred?: number | null): Location => ({
  university_id:
    preferred && universities.some((u) => u.id === preferred) ? preferred : universities.length === 1 ? universities[0].id : "",
  hall_id: null,
  off_campus: false,
  apartment: "",
  room: "",
  other_university: "",
  other_residence: "",
});

export function locationComplete(l: Location) {
  if (l.university_id === "other") return l.other_university.trim().length > 0;
  return l.university_id !== "" && (l.off_campus || l.hall_id != null);
}

/**
 * University dropdown, then a multiple-choice list of that university's residence halls,
 * always ending with an "Off-campus apartment" option.
 */
export function LocationPicker({
  universities, value, onChange, allowOther = false, compact = false, showRoom = true,
}: {
  universities: Uni[];
  value: Location;
  onChange: (l: Location) => void;
  allowOther?: boolean;
  compact?: boolean;
  /** Optional room number once a residence hall is chosen. */
  showRoom?: boolean;
}) {
  const id = useId();
  const uni = typeof value.university_id === "number" ? universities.find((u) => u.id === value.university_id) : undefined;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="field">
        <label htmlFor={`${id}-uni`}>University</label>
        <select
          id={`${id}-uni`}
          value={value.university_id}
          required
          onChange={(e) => {
            const v = e.target.value;
            onChange({ ...value, university_id: v === "" ? "" : v === "other" ? "other" : Number(v), hall_id: null, off_campus: false });
          }}
        >
          <option value="">Select your university…</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
          {allowOther && <option value="other">My school isn’t listed</option>}
        </select>
      </div>

      {value.university_id === "other" && (
        <div className="choices" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label htmlFor={`${id}-ou`}>University name</label>
            <input id={`${id}-ou`} className="input" required value={value.other_university}
              onChange={(e) => onChange({ ...value, other_university: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-or`}>Dorm or apartment (optional)</label>
            <input id={`${id}-or`} className="input" value={value.other_residence}
              onChange={(e) => onChange({ ...value, other_residence: e.target.value })} />
          </div>
        </div>
      )}

      {uni && (
        <fieldset>
          <legend>Where do you live?</legend>
          <div className="choices" style={compact ? { gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" } : undefined}>
            {uni.halls.map((h) => (
              <label key={h.id} className="choice">
                <input
                  type="radio"
                  name={`${id}-res`}
                  required
                  checked={!value.off_campus && value.hall_id === h.id}
                  onChange={() => onChange({ ...value, hall_id: h.id, off_campus: false })}
                />
                {h.name}
              </label>
            ))}
            <label className="choice offcampus">
              <input
                type="radio"
                name={`${id}-res`}
                required
                checked={value.off_campus}
                onChange={() => onChange({ ...value, hall_id: null, off_campus: true })}
              />
              Off-campus apartment
            </label>
          </div>
          {showRoom && !value.off_campus && value.hall_id != null && (
            <div className="field" style={{ marginTop: 12, maxWidth: 220 }}>
              <label htmlFor={`${id}-room`}>Room # <span className="muted">(optional)</span></label>
              <input id={`${id}-room`} className="input" maxLength={20} placeholder="e.g. 412" autoComplete="off" value={value.room}
                onChange={(e) => onChange({ ...value, room: e.target.value })} />
            </div>
          )}
          {value.off_campus && (
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor={`${id}-apt`}>Apartment or building name <span className="muted">(optional)</span></label>
              <input id={`${id}-apt`} className="input" placeholder="e.g. The Standard, Unit 4B" value={value.apartment}
                onChange={(e) => onChange({ ...value, apartment: e.target.value })} />
            </div>
          )}
          {uni.pickup_location && (
            <p className="small muted" style={{ marginTop: 10 }}>Pickup for {uni.name}: <strong>{uni.pickup_location}</strong></p>
          )}
        </fieldset>
      )}
    </div>
  );
}
