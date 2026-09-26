import { useState } from "react";
import { Icons } from "~/components/icons";

export interface ConsultationFormItem {
  body: string;
  status: "open" | "resolved";
}

export interface ConsultationFormDefaultValue {
  scheduledAt: string;
  durationMin?: number;
  meetingUrl?: string | null;
  summary: string;
  items: ConsultationFormItem[];
}

interface ConsultationFormProps {
  defaultValue?: ConsultationFormDefaultValue;
  /** Domyślny moment spotkania (datetime-local "YYYY-MM-DDTHH:MM"). */
  defaultScheduledAt?: string;
  /**
   * **Które pola ten formularz naprawdę wyśle** (D-FE-5).
   *
   * `dokumentacja` woła `POST /v1/consultations/{id}/document`, a to DTO niesie
   * wyłącznie podsumowanie i punkty — termin, czas trwania i odnośnik zmienia
   * osobna operacja (`reschedule`). Do 2026-09-21 formularz pokazywał je mimo
   * to, przyjmował edycję i **cicho ją gubił**: trener poprawiał link do
   * spotkania, zapisywał i nic się nie działo.
   *
   * `nowy` woła `POST /v1/consultations`, które te pola niesie — tam są żywe.
   */
  tryb?: "nowy" | "dokumentacja";
}

/**
 * Formularz konsultacji (pola + dynamiczna lista punktów „do poprawy").
 * Nie renderuje własnego <Form> — rodzic owija go w <Form method="post">
 * i dodaje własny przycisk submit + hidden intent.
 */
export function ConsultationForm({
  defaultValue,
  defaultScheduledAt,
  tryb = "nowy",
}: ConsultationFormProps) {
  const terminEdytowalny = tryb === "nowy";
  const [items, setItems] = useState<ConsultationFormItem[]>(defaultValue?.items ?? []);

  function addItem() {
    setItems((prev) => [...prev, { body: "", status: "open" }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItemBody(idx: number, body: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, body } : it)));
  }

  const scheduledAtDefault = defaultValue?.scheduledAt ?? defaultScheduledAt ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {terminEdytowalny && (
        <>
          {/* Termin spotkania + czas trwania */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              maxWidth: 460,
            }}
          >
            <div className="field">
              <label htmlFor="cf-scheduledAt">Termin spotkania</label>
              <input
                id="cf-scheduledAt"
                className="input"
                type="datetime-local"
                name="scheduledAt"
                required
                defaultValue={scheduledAtDefault}
              />
            </div>
            <div className="field">
              <label htmlFor="cf-durationMin">Czas trwania (min)</label>
              <input
                id="cf-durationMin"
                className="input"
                type="number"
                name="durationMin"
                min={1}
                max={600}
                defaultValue={defaultValue?.durationMin ?? 45}
              />
            </div>
          </div>

          {/* Link spotkania */}
          <div className="field">
            <label htmlFor="cf-meetingUrl">Link spotkania (opcjonalnie)</label>
            <input
              id="cf-meetingUrl"
              className="input"
              type="url"
              name="meetingUrl"
              maxLength={500}
              defaultValue={defaultValue?.meetingUrl ?? ""}
              placeholder="https://meet.google.com/…"
            />
          </div>
        </>
      )}

      {/* Podsumowanie */}
      <div className="field">
        <label htmlFor="cf-summary">Podsumowanie</label>
        <textarea
          id="cf-summary"
          className="textarea"
          name="summary"
          maxLength={10000}
          defaultValue={defaultValue?.summary ?? ""}
          placeholder="Notatki z konsultacji, obserwacje, plan na kolejny okres..."
          rows={5}
        />
      </div>

      {/* Punkty do poprawy */}
      <div>
        <div className="field-label" style={{ marginBottom: 10 }}>
          Do poprawy
        </div>

        {items.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 10,
            }}
          >
            {items.map((item, idx) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: controlled list, no stable IDs
                key={idx}
                className="card"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                {/* Hidden status field — carries the item's current status */}
                <input type="hidden" name="itemStatus" value={item.status} />
                <div
                  className="mono text-xs muted"
                  style={{
                    paddingTop: 10,
                    width: 20,
                    flexShrink: 0,
                    textAlign: "right",
                  }}
                >
                  {idx + 1}.
                </div>
                <input
                  className="input"
                  type="text"
                  name="itemBody"
                  value={item.body}
                  onChange={(e) => updateItemBody(idx, e.target.value)}
                  placeholder="Treść punktu do poprawy..."
                  maxLength={2000}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-icon btn-ghost"
                  style={{ color: "var(--muted)", flexShrink: 0 }}
                  onClick={() => removeItem(idx)}
                  aria-label={`Usuń punkt ${idx + 1}`}
                >
                  <Icons.X />
                </button>
              </div>
            ))}
          </div>
        )}

        <button type="button" className="btn btn-ghost" onClick={addItem} style={{ fontSize: 13 }}>
          <Icons.Plus /> Dodaj punkt
        </button>
      </div>
    </div>
  );
}
