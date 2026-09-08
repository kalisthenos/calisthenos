import { Icons } from "~/components/icons";
import { VideoUploadField, type VideoUploadState } from "~/components/video-upload-field";
import type { SetDraft } from "~/lib/log-draft";

type SetState = SetDraft;

export function LogExerciseCard({
  entry,
  eIdx,
  totalEntries,
  sets,
  maxVideoBytes,
  onUpdateSet,
  onVideoStateChange,
  onSkipSet,
  onUnskipSet,
  onCopyFromFirst,
}: {
  entry: import("~/lib/workouts").LoggingEntry;
  eIdx: number;
  totalEntries: number;
  sets: SetState[];
  maxVideoBytes: number;
  onUpdateSet: (sIdx: number, patch: Partial<SetState>) => void;
  onVideoStateChange: (sIdx: number, state: VideoUploadState) => void;
  onSkipSet: (sIdx: number) => void;
  onUnskipSet: (sIdx: number) => void;
  onCopyFromFirst: () => void;
}) {
  const showCopyButton = entry.expectedSets > 1;
  const firstFilled =
    sets.length > 0 &&
    !sets[0]?.skipped &&
    (sets[0]?.reps?.trim() !== "" || sets[0]?.difficulty !== "");

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
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{entry.exerciseName}</div>
          <div className="text-xs muted" style={{ marginTop: 3 }}>
            Cel:{" "}
            <strong className="mono" style={{ color: "var(--ink)" }}>
              {entry.expectedSets}
            </strong>{" "}
            seria(e) ×{" "}
            <strong className="mono" style={{ color: "var(--ink)" }}>
              {entry.expectedReps}
            </strong>{" "}
            {entry.unit === "SEC" ? "sek." : "powt."}
          </div>
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
        {showCopyButton && (
          <button
            type="button"
            onClick={onCopyFromFirst}
            disabled={!firstFilled}
            className="btn btn-sm"
            title="Skopiuj liczby i trudność z serii #1 do pozostałych pustych"
            style={{ flexShrink: 0 }}
          >
            Wypełnij jak #1
          </button>
        )}
      </div>

      <div style={{ padding: 12, display: "grid", gap: 10 }}>
        {sets.map((set, sIdx) =>
          set.skipped ? (
            <SkippedSetRow
              // biome-ignore lint/suspicious/noArrayIndexKey: deterministic enumeration; rows never reorder.
              key={sIdx}
              sIdx={sIdx}
              onUnskip={() => onUnskipSet(sIdx)}
            />
          ) : (
            <SetRow
              // biome-ignore lint/suspicious/noArrayIndexKey: deterministic enumeration; rows never reorder.
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
              onVideoStateChange={(state) => onVideoStateChange(sIdx, state)}
            />
          ),
        )}
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
  onVideoStateChange,
}: {
  eIdx: number;
  sIdx: number;
  unit: "REPS" | "SEC";
  expectedReps: number;
  tracksRpe: boolean;
  set: SetState;
  maxVideoBytes: number;
  onChange: (patch: Partial<SetState>) => void;
  onSkip: () => void;
  onVideoStateChange: (state: VideoUploadState) => void;
}) {
  const diffName = `e_${eIdx}_s_${sIdx}_diff`;

  // Picking a difficulty implies "I did this set" — backfill reps with the
  // target so the trainee doesn't have to type a number they hit on plan.
  // They can still override afterwards.
  const onDifficultyChange = (v: string) => {
    if (!set.reps.trim()) {
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
            placeholder={String(expectedReps)}
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
}: {
  sIdx: number;
  onUnskip: () => void;
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
      <button
        type="button"
        onClick={onUnskip}
        className="btn btn-sm btn-ghost"
        style={{ fontSize: 11, padding: "2px 8px", height: 24 }}
      >
        Cofnij
      </button>
    </div>
  );
}
