import { Icons } from "~/components/icons";
import type { ConsultationDetail } from "~/lib/consultations";

/**
 * Stan notatki AI Notetakera dla konsultacji — `ConsultationDetail.aiNotesState`.
 * Znaczenie każdej wartości: `calisthenos-be/docs/04-kontrakt-api.md`, §AI Notetaker.
 *
 * **Pułapka nazewnicza zapisana tam wprost:** stan zlecenia `ready` U DOSTAWCY
 * (transkrypt czeka pod presigned URL-em, jeszcze nie odebrany) i `aiNotesState:
 * 'ready'` U NAS (notatka już odebrana i stoi w `aiNotes`) to DWA RÓŻNE zdarzenia
 * mimo tej samej etykiety. Ten komponent zna wyłącznie drugie znaczenie — to
 * jedyne, jakie dostaje z kontraktu.
 */
export type AiNotesState = ConsultationDetail["aiNotesState"];

type Tone = "muted" | "warn" | "danger";

const TONE_COLOR: Record<Tone, string> = {
  muted: "var(--muted)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

/**
 * Komunikat dla każdego stanu poza `ready` — `ready` renderuje samą treść
 * `aiNotes`, patrz `renderBody`. Sześć stanów zamiast pojedynczej flagi
 * „jest/nie ma": cisza przy braku notatki jest defektem, który te komunikaty
 * mają zamknąć — trener ma się dowiedzieć DLACZEGO notatki nie ma.
 */
const STATE_COPY: Record<Exclude<AiNotesState, "ready">, { tone: Tone; message: string }> = {
  disabled: {
    tone: "muted",
    message:
      "Integracja AI Notetaker jest wyłączona — bot nie dołączy do spotkania i notatka nie powstanie. Włącz ją w ustawieniach integracji, jeśli chcesz automatyczne notatki ze spotkań.",
  },
  "no-meeting-url": {
    tone: "warn",
    message:
      "Integracja jest włączona, ale ten termin nie ma odnośnika do spotkania — bot nie ma dokąd dołączyć. Uzupełnij pole „Link spotkania” w dokumentacji terminu.",
  },
  scheduled: {
    tone: "muted",
    message:
      "Bot ma dołączyć do tego spotkania. Notatka pojawi się tutaj automatycznie po jego zakończeniu.",
  },
  pending: {
    tone: "muted",
    message:
      "Spotkanie się zakończyło, trwa przygotowywanie notatki z transkryptu. Zwykle to kwestia minut — wróć tu za chwilę.",
  },
  failed: {
    tone: "danger",
    message:
      "Nagranie albo transkrypcja spotkania się nie udały — notatki nie będzie dla tego terminu.",
  },
};

const TEXT_STYLE = { fontSize: 14, lineHeight: 1.6, margin: 0 };

function renderBody(
  state: AiNotesState,
  notes: ConsultationDetail["aiNotes"],
): { content: React.ReactNode; borderColor?: string } {
  if (state === "ready") {
    if (notes) {
      return { content: <p style={{ ...TEXT_STYLE, color: "var(--ink-2)" }}>{notes}</p> };
    }
    // Kontrakt gwarantuje `aiNotes` przy `aiNotesState: 'ready'`, ale cisza przy
    // niespełnionym założeniu jest dokładnie tym, przed czym broni ten komponent
    // — więc i TU dostaje własny, widoczny komunikat, a nie pustkę.
    return {
      content: (
        <p style={{ ...TEXT_STYLE, color: TONE_COLOR.warn }}>
          Notatka miała być gotowa, ale nie udało się jej wczytać. Odśwież stronę za chwilę.
        </p>
      ),
      borderColor: TONE_COLOR.warn,
    };
  }

  const copy = STATE_COPY[state];
  return {
    content: <p style={{ ...TEXT_STYLE, color: TONE_COLOR[copy.tone] }}>{copy.message}</p>,
    borderColor: copy.tone === "muted" ? undefined : TONE_COLOR[copy.tone],
  };
}

/**
 * Notatka konsultacji wygenerowana przez AI Notetakera. Sześć stanów
 * `aiNotesState`, każdy z widocznym komunikatem po polsku — `no-meeting-url`
 * jest najważniejszy, bo to jedyny tryb porażki, którego trener nie zobaczy
 * nigdzie indziej (nie ma go w BE-owym `409` ani w mailu, tylko tutaj).
 *
 * `aiNotes` jest Markdown, ale renderuje się jako zwykły preformatowany tekst
 * (`white-space: pre-wrap`) — tak samo jak `summary`/`traineeNote` w trasie
 * konsultacji obok. W drzewie nie ma dziś parsera Markdown.
 *
 * Bez własnych wywołań backendu: `state`/`notes` przychodzą propsami
 * z `ConsultationDetail` (loader trasy).
 */
export function AiNotesPanel({
  state,
  notes,
}: {
  state: AiNotesState;
  notes: ConsultationDetail["aiNotes"];
}) {
  const body = renderBody(state, notes);

  return (
    <div
      className="card"
      style={{
        marginBottom: 18,
        maxWidth: 760,
        ...(body.borderColor
          ? { borderColor: body.borderColor, borderStyle: "dashed" as const }
          : null),
      }}
    >
      <div
        className="field-label"
        style={{ marginBottom: 10, display: "flex", gap: 6, alignItems: "center" }}
      >
        <Icons.Sparkle style={{ width: 14, height: 14 }} />
        AI Notetaker
      </div>
      {body.content}
    </div>
  );
}
