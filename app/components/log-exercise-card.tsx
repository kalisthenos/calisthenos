import { Icons } from "~/components/icons";
import { VideoUploadField, type VideoUploadState } from "~/components/video-upload-field";
import type { SetDraft } from "~/lib/log-draft";
import type { LogEntry } from "~/lib/workouts";

type SetState = SetDraft;

/**
 * Sufit serii na ćwiczenie z reguły domenowej BE (N15, `WORKOUT_LOG_LIMITS
 * .setsPerExercise`). Kontrakt go NIE deklaruje, więc nie jest to walidacja —
 * pole nie dostaje `max`, a akcja trasy niczego po nim nie odrzuca. Gaśnie
 * wyłącznie PRZYCISK „Dodaj serię": odmowa `400` po wypełnieniu 51 wiersza
 * byłaby karą za pracę, którą podopieczny już wykonał. Gdyby limit po tamtej
 * stronie się zmienił, tutaj zrobi się co najwyżej przycisk gasnący za wcześnie
 * albo za późno — nigdy utracony zapis.
 */
const MAX_SETS_PER_ENTRY = 50;

/**
 * Karta jednego ćwiczenia na ekranie logowania. Od „sesji poza planem" wpis nie
 * jest już odbiciem pozycji planu, tylko STANEM formularza: może być zamiennikiem
 * (`origin: "substitute"`), może pochodzić spoza planu (`"extra"`) i może mieć
 * WIĘCEJ wierszy, niż planowano.
 *
 * Dwie rzeczy, które łatwo tu zepsuć:
 *
 * 1. **„–" zdejmuje wyłącznie wiersze PONAD plan.** Wiersz planowany zostaje —
 *    pusty znaczy „seria pominięta", a dziura w `ordinal` jest informacją, którą
 *    czyta szczegół treningu i delta plan↔wykonanie. Dla wpisu `extra` podłogą
 *    jest jeden wiersz; całość zdejmuje się przyciskiem „Usuń".
 * 2. **Wpisu `planned`/`substitute` NIE wolno usunąć.** Pominięcie ćwiczenia
 *    wyraża się pustymi seriami, nie zniknięciem karty.
 */
export function LogExerciseCard({
  entry,
  eIdx,
  totalEntries,
  maxVideoBytes,
  onUpdateSet,
  onVideoStateChange,
  onSkipSet,
  onUnskipSet,
  onCopyFromFirst,
  onAddSet,
  onRemoveSet,
  onSwap,
  onUndoSwap,
  onRemoveEntry,
}: {
  entry: LogEntry;
  eIdx: number;
  totalEntries: number;
  maxVideoBytes: number;
  onUpdateSet: (sIdx: number, patch: Partial<SetState>) => void;
  onVideoStateChange: (sIdx: number, state: VideoUploadState) => void;
  onSkipSet: (sIdx: number) => void;
  onUnskipSet: (sIdx: number) => void;
  onCopyFromFirst: () => void;
  onAddSet: () => void;
  onRemoveSet: (sIdx: number) => void;
  onSwap: () => void;
  onUndoSwap: () => void;
  onRemoveEntry: () => void;
}) {
  const sets = entry.sets;
  const isExtra = entry.origin === "extra";
  // Wiersze do tego indeksu należą do planu i są NIEUSUWALNE. Wpis spoza planu
  // planu nie ma, więc podłogą jest jeden wiersz — inaczej dałoby się zostawić
  // kartę bez ani jednego miejsca na wpisanie czegokolwiek.
  const lockedRows = entry.plannedSets ?? 1;
  const showCopyButton = sets.length > 1;
  const firstFilled =
    sets.length > 0 &&
    !sets[0]?.skipped &&
    (sets[0]?.reps?.trim() !== "" || sets[0]?.difficulty !== "");
  const atSetCeiling = sets.length >= MAX_SETS_PER_ENTRY;

  return (
    <div className="card card-padless">
      <div
        className="row between"
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--line)",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span className="mono text-xs muted">
              Ćwiczenie {eIdx + 1}/{totalEntries}
            </span>
            {entry.isDropsetItem && <span className="badge">dropset</span>}
            {entry.origin === "substitute" && (
              <span className="badge">zamiast: {entry.substitutedExerciseName}</span>
            )}
            {isExtra && <span className="badge">spoza planu</span>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{entry.exerciseName}</div>
          {/* Dwa warunki, nie jeden: zamiennik ZACHOWUJE liczbę serii z planu, ale
              traci cel powtórzeń (patrz `rehydrateEntries` i `swapEntry` — cel po
              starym ćwiczeniu wpisywałby się w pole przy kliknięciu trudności).
              Sklejone w jeden warunek dawałyby przy zamienniku „Bez celu z planu",
              co jest nieprawdą: liczba serii nadal obowiązuje. */}
          {entry.plannedSets != null ? (
            <div className="text-xs muted" style={{ marginTop: 3 }}>
              Cel:{" "}
              <strong className="mono" style={{ color: "var(--ink)" }}>
                {entry.plannedSets}
              </strong>{" "}
              seria(e)
              {entry.expectedReps != null && (
                <>
                  {" × "}
                  <strong className="mono" style={{ color: "var(--ink)" }}>
                    {entry.expectedReps}
                  </strong>{" "}
                  {entry.unit === "SEC" ? "sek." : "powt."}
                </>
              )}
            </div>
          ) : (
            <div className="text-xs muted" style={{ marginTop: 3 }}>
              Bez celu z planu — wpisz tyle serii, ile zrobiłeś.
            </div>
          )}
          {entry.note != null && entry.note.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-2)",
                marginTop: 6,
                fontStyle: "italic",
              }}
            >
              „{entry.note}"
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
          {showCopyButton && (
            <button
              type="button"
              onClick={onCopyFromFirst}
              disabled={!firstFilled}
              className="btn btn-sm"
              title="Skopiuj liczby i trudność z serii #1 do pozostałych pustych"
            >
              Wypełnij jak #1
            </button>
          )}
          {!isExtra && (
            <button
              type="button"
              onClick={onSwap}
              className="btn btn-sm"
              title="Zaloguj inne ćwiczenie z biblioteki zamiast tego"
            >
              <Icons.Edit /> Wymień
            </button>
          )}
          {entry.origin === "substitute" && (
            <button
              type="button"
              onClick={onUndoSwap}
              className="btn btn-sm btn-ghost"
              title="Wróć do ćwiczenia z planu (wpisane serie znikną)"
            >
              Cofnij wymianę
            </button>
          )}
          {isExtra && (
            <button
              type="button"
              onClick={onRemoveEntry}
              className="btn btn-sm btn-ghost"
              title="Usuń to ćwiczenie z formularza"
            >
              <Icons.Trash /> Usuń
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: 12, display: "grid", gap: 10 }}>
        {sets.map((set, sIdx) =>
          set.skipped ? (
            <SkippedSetRow
              // biome-ignore lint/suspicious/noArrayIndexKey: pozycja JEST tożsamością wiersza (jedzie jako `ordinal`), a zdjęcie wiersza przemontowuje całą kartę (`videoFieldsEpoch` w trasie), więc stan pola wideo nie przykleja się do cudzego indeksu.
              key={sIdx}
              sIdx={sIdx}
              onUnskip={() => onUnskipSet(sIdx)}
              onRemove={sIdx >= lockedRows ? () => onRemoveSet(sIdx) : undefined}
            />
          ) : (
            <SetRow
              // biome-ignore lint/suspicious/noArrayIndexKey: jak wyżej — pozycja jest tożsamością wiersza, a zdjęcie wiersza przemontowuje kartę.
              key={sIdx}
              eIdx={eIdx}
              sIdx={sIdx}
              unit={entry.unit}
              expectedReps={entry.expectedReps}
              tracksRpe={entry.tracksRpe}
              set={set}
              maxVideoBytes={maxVideoBytes}
              onChange={(patch) => onUpdateSet(sIdx, patch)}
              onSkip={() => onSkipSet(sIdx)}
              onRemove={sIdx >= lockedRows ? () => onRemoveSet(sIdx) : undefined}
              onVideoStateChange={(state) => onVideoStateChange(sIdx, state)}
            />
          ),
        )}
        <div>
          <button
            type="button"
            onClick={onAddSet}
            disabled={atSetCeiling}
            className="btn btn-sm btn-ghost"
            title={
              atSetCeiling
                ? `Więcej niż ${MAX_SETS_PER_ENTRY} serii na ćwiczenie nie da się zapisać.`
                : "Dołóż serię ponad plan"
            }
          >
            <Icons.Plus /> Dodaj serię
          </button>
        </div>
      </div>
    </div>
  );
}

function tierFor(value: number): "easy" | "mid" | "hard" {
  if (value <= 4) return "easy";
  if (value <= 7) return "mid";
  return "hard";
}

function SetRow({
  eIdx,
  sIdx,
  unit,
  expectedReps,
  tracksRpe,
  set,
  maxVideoBytes,
  onChange,
  onSkip,
  onRemove,
  onVideoStateChange,
}: {
  eIdx: number;
  sIdx: number;
  unit: "REPS" | "SEC";
  /** `null` dla wpisu spoza planu — nie ma celu, z którego dałoby się podpowiedzieć. */
  expectedReps: number | null;
  tracksRpe: boolean;
  set: SetState;
  maxVideoBytes: number;
  onChange: (patch: Partial<SetState>) => void;
  onSkip: () => void;
  /** Podane wyłącznie dla wiersza PONAD plan — brak znaczy „nie do zdjęcia". */
  onRemove?: () => void;
  onVideoStateChange: (state: VideoUploadState) => void;
}) {
  const diffName = `e_${eIdx}_s_${sIdx}_diff`;

  // Picking a difficulty implies "I did this set" — backfill reps with the
  // target so the trainee doesn't have to type a number they hit on plan.
  // They can still override afterwards. Wpis spoza planu celu nie ma, więc nie
  // ma czym uzupełniać — zostaje sama trudność.
  const onDifficultyChange = (v: string) => {
    if (!set.reps.trim() && expectedReps != null) {
      onChange({ difficulty: v, reps: String(expectedReps) });
    } else {
      onChange({ difficulty: v });
    }
  };

  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 10,
        display: "grid",
        gap: 8,
      }}
    >
      <div className="row between" style={{ alignItems: "center", marginBottom: -2 }}>
        <span className="mono text-xs muted">Seria #{sIdx + 1}</span>
        <div className="row" style={{ gap: 4, alignItems: "center" }}>
          <button
            type="button"
            onClick={onSkip}
            className="btn btn-sm btn-ghost"
            style={{
              fontSize: 11,
              color: "var(--muted)",
              padding: "2px 8px",
              height: 24,
            }}
            title="Oznacz tę serię jako pominiętą (nie wlicza się do statystyk)"
          >
            <Icons.X style={{ fontSize: 11 }} /> Pomiń
          </button>
          {onRemove != null && (
            <button
              type="button"
              onClick={onRemove}
              className="btn btn-sm btn-ghost"
              style={{ fontSize: 11, color: "var(--muted)", padding: "2px 8px", height: 24 }}
              title="Zdejmij ten wiersz (seria ponad plan)"
              aria-label={`Zdejmij serię #${sIdx + 1}`}
            >
              –
            </button>
          )}
        </div>
      </div>
      <div
        className="row"
        style={{
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <div className="field" style={{ minWidth: 0, flex: 1 }}>
          <label
            className="uppercase-label"
            htmlFor={`reps-${eIdx}-${sIdx}`}
            style={{ fontSize: 10 }}
          >
            {unit === "SEC" ? "Sekundy" : "Powtórzenia"}
          </label>
          <input
            id={`reps-${eIdx}-${sIdx}`}
            name={`e_${eIdx}_s_${sIdx}_reps`}
            type="number"
            min={1}
            max={1000}
            inputMode="numeric"
            value={set.reps}
            placeholder={expectedReps != null ? String(expectedReps) : "—"}
            onChange={(e) => onChange({ reps: e.target.value })}
            className="input input-num"
          />
        </div>
        <VideoUploadField
          name={`e_${eIdx}_s_${sIdx}_video_id`}
          idSuffix={`${eIdx}-${sIdx}`}
          label="Video"
          maxBytes={maxVideoBytes}
          initialFileId={set.videoFileId}
          onStateChange={onVideoStateChange}
        />
      </div>
      {tracksRpe ? (
        <div>
          <div className="uppercase-label" style={{ fontSize: 10, marginBottom: 4 }}>
            Trudność 1–10
          </div>
          <div className="diff-radio">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
              <div key={v}>
                <input
                  id={`${diffName}-${v}`}
                  name={diffName}
                  type="radio"
                  value={v}
                  checked={set.difficulty === String(v)}
                  onChange={() => onDifficultyChange(String(v))}
                />
                <label htmlFor={`${diffName}-${v}`} data-tier={tierFor(v)}>
                  {v}
                </label>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-xs muted" style={{ fontStyle: "italic" }}>
          To ćwiczenie nie zbiera oceny trudności.
        </div>
      )}
    </div>
  );
}

/**
 * Compact placeholder for a set that the trainee explicitly marked as skipped.
 * Renders no form inputs — the action's "row left blank" path already treats
 * missing fields as skipped (no DB row, doesn't pollute stats).
 */
function SkippedSetRow({
  sIdx,
  onUnskip,
  onRemove,
}: {
  sIdx: number;
  onUnskip: () => void;
  /** Jak w `SetRow` — tylko wiersz ponad plan da się zdjąć. */
  onRemove?: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px dashed var(--line-2)",
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <span className="mono text-xs muted">Seria #{sIdx + 1}</span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            color: "var(--muted)",
            fontWeight: 600,
          }}
        >
          Pominięta
        </span>
        <span className="text-xs muted" style={{ fontStyle: "italic" }}>
          nie wlicza się do statystyk
        </span>
      </div>
      <div className="row" style={{ gap: 4, alignItems: "center" }}>
        <button
          type="button"
          onClick={onUnskip}
          className="btn btn-sm btn-ghost"
          style={{ fontSize: 11, padding: "2px 8px", height: 24 }}
        >
          Cofnij
        </button>
        {onRemove != null && (
          <button
            type="button"
            onClick={onRemove}
            className="btn btn-sm btn-ghost"
            style={{ fontSize: 11, padding: "2px 8px", height: 24 }}
            title="Zdejmij ten wiersz (seria ponad plan)"
            aria-label={`Zdejmij serię #${sIdx + 1}`}
          >
            –
          </button>
        )}
      </div>
    </div>
  );
}
