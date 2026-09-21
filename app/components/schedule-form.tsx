import { useState } from "react";

export type Cadence = "weekly" | "biweekly" | "monthly";

export interface ScheduleFormDefaultValue {
  cadence: Cadence;
  weekday: number | null;
  dayOfMonth: number | null;
  /** "HH:MM" lub "HH:MM:SS" (z DB). */
  timeOfDay: string;
  durationMin: number;
  startsOn: string;
  defaultMeetingUrl: string | null;
}

interface ScheduleFormProps {
  defaultValue?: ScheduleFormDefaultValue | null;
  /** Domyślna data startu, gdy brak harmonogramu (np. todayISO()). */
  defaultStartsOn: string;
}

const CADENCES: { value: Cadence; label: string; hint: string }[] = [
  { value: "weekly", label: "Co tydzień", hint: "ten sam dzień tygodnia" },
  { value: "biweekly", label: "Co 2 tygodnie", hint: "co druga seria" },
  { value: "monthly", label: "Co miesiąc", hint: "ten sam dzień miesiąca" },
];

// 0=niedziela..6=sobota (zgodnie z Date.getUTCDay / schema.weekday).
const WEEKDAYS = [
  { value: 1, label: "Poniedziałek" },
  { value: 2, label: "Wtorek" },
  { value: 3, label: "Środa" },
  { value: 4, label: "Czwartek" },
  { value: 5, label: "Piątek" },
  { value: 6, label: "Sobota" },
  { value: 0, label: "Niedziela" },
];

/**
 * Formularz reguły harmonogramu konsultacji. Kontrolowany (cadence przełącza
 * widoczne pole kotwicy). Nie renderuje własnego <Form> — rodzic owija go i
 * dodaje `intent=save-schedule` oraz przycisk submit.
 */
export function ScheduleForm({ defaultValue, defaultStartsOn }: ScheduleFormProps) {
  const [cadence, setCadence] = useState<Cadence>(defaultValue?.cadence ?? "weekly");

  const time = (defaultValue?.timeOfDay ?? "18:00").slice(0, 5);
  const weekday = defaultValue?.weekday ?? 3; // domyślnie środa
  const dayOfMonth = defaultValue?.dayOfMonth ?? 1;
  const isMonthly = cadence === "monthly";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Częstotliwość — radio-pills */}
      <div>
        <div className="field-label" style={{ marginBottom: 8 }}>
          Częstotliwość
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {CADENCES.map((c) => {
            const selected = cadence === c.value;
            return (
              <label
                key={c.value}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  border: `1px solid ${selected ? "var(--ink)" : "var(--line)"}`,
                  background: selected ? "var(--accent-soft)" : "var(--surface)",
                  cursor: "pointer",
                  minWidth: 140,
                  transition: "border-color .12s, background .12s",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="radio"
                    name="cadence"
                    value={c.value}
                    checked={selected}
                    onChange={() => setCadence(c.value)}
                  />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{c.label}</span>
                </span>
                <span className="text-xs muted" style={{ paddingLeft: 24 }}>
                  {c.hint}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Kotwica: dzień tygodnia (weekly/biweekly) lub dzień miesiąca (monthly) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          maxWidth: 560,
        }}
      >
        {isMonthly ? (
          <div className="field">
            <label htmlFor="sf-dayOfMonth">Dzień miesiąca</label>
            <select
              id="sf-dayOfMonth"
              className="input"
              name="dayOfMonth"
              defaultValue={String(dayOfMonth)}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}.
                </option>
              ))}
            </select>
            <div className="text-xs muted" style={{ marginTop: 4 }}>
              Maksymalnie 28 — bezpieczne dla każdego miesiąca.
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="sf-weekday">Dzień tygodnia</label>
            <select id="sf-weekday" className="input" name="weekday" defaultValue={String(weekday)}>
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="sf-timeOfDay">Godzina</label>
          <input
            id="sf-timeOfDay"
            className="input"
            type="time"
            name="timeOfDay"
            defaultValue={time}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="sf-durationMin">Czas trwania (min)</label>
          <input
            id="sf-durationMin"
            className="input"
            type="number"
            name="durationMin"
            min={1}
            max={600}
            defaultValue={defaultValue?.durationMin ?? 45}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="sf-startsOn">Start od</label>
          <input
            id="sf-startsOn"
            className="input"
            type="date"
            name="startsOn"
            defaultValue={defaultValue?.startsOn ?? defaultStartsOn}
            required
          />
        </div>
      </div>

      {/* Link spotkania (opcjonalny) */}
      <div className="field">
        <label htmlFor="sf-meetingUrl">Stały link spotkania (opcjonalnie)</label>
        <input
          id="sf-meetingUrl"
          className="input"
          type="url"
          name="defaultMeetingUrl"
          maxLength={500}
          defaultValue={defaultValue?.defaultMeetingUrl ?? ""}
          placeholder="https://meet.google.com/…"
        />
        <div className="text-xs muted" style={{ marginTop: 4 }}>
          Trafia na każdy nowy termin tej serii. Można nadpisać na pojedynczym terminie.
        </div>
      </div>
    </div>
  );
}
