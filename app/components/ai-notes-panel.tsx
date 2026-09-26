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
 *
 * **Od `0.8.0` klienta jest ich siedem, a siódmy tej obietnicy nie spełnia.**
 * `not-booked` mówi wyłącznie, że notatki nie będzie — przyczyny NIE niesie
 * (`docs/04` §AI Notetaker). Doszedł, bo `scheduled` obiecywał bota także
 * wtedy, gdy okno zlecenia dawno minęło; obietnica fałszywa jest gorsza niż
 * odpowiedź niepełna, ale niepełna to nadal jest.
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
  // Jedyny stan, który NIE umie odpowiedzieć na pytanie z docblocku wyżej —
  // i jest to własność kontraktu, nie brak w tym komunikacie. `docs/04`
  // §AI Notetaker mówi wprost: „nie mówi, CO go zatrzymało; mówi wyłącznie,
  // że czekanie na notatkę nie ma sensu". Dopisanie tu przyczyny byłoby
  // zgadywaniem, a komunikat, który zgaduje, myli się w cudzej sprawie.
  //
  // Stąd `warn`, nie `danger`: nic się nie zepsuło — bota po prostu nie
  // zlecono, a bywa to stan całkowicie normalny (integracja wyłączona
  // globalnie, termin poza zbiorem kwalifikujących się).
  "not-booked": {
    tone: "warn",
    message:
      "Spotkanie już się zaczęło, a bota nie zlecono — notatki dla tego terminu nie będzie. Ten stan nie rozróżnia przyczyn (wyłączona integracja, brak odnośnika w chwili startu, awaria dostawcy). Jeśli powtórzy się przy kolejnych terminach, zacznij od ekranu integracji.",
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

// `whiteSpace: "pre-wrap"` NIE jest kosmetyką: `aiNotes` jest Markdownem z
// pięciu sekcji `## Nagłówek` + punkty (`notes-prompt.ts` w BE), a bez tego
// przeglądarka zwija każdy `\n` do spacji i skleja wszystko w jeden akapit.
// Ten sam poziom co `summary`/`traineeNote` w trasie konsultacji obok
// (`podopieczni.$traineeId.konsultacje.$konsultacjaId.tsx:290,379`).
const TEXT_STYLE: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  margin: 0,
  whiteSpace: "pre-wrap",
};

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
