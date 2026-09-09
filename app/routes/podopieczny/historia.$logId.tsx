import type { WorkoutLogExerciseView } from "@kalisthenos/api-client";
import { useEffect, useRef } from "react";
import { Link, type LoaderFunctionArgs, useLoaderData, useSearchParams } from "react-router";
import { Icons } from "~/components/icons";
import { useToast } from "~/components/toast-provider";
import { requireUser } from "~/lib/api/auth";
import { daysAgo, fmtDate } from "~/lib/format";
import { draftKey } from "~/lib/log-draft";
import { loadMyLog } from "~/lib/workouts";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  const log = await loadMyLog(api, args.params.logId ?? "");
  if (!log) throw new Response("not found", { status: 404 });
  return { log };
}

export default function TraineeLogDetail() {
  const { log } = useLoaderData<typeof loader>();
  const exercises = log.exercises;
  const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0);
  const allDiff = exercises
    .flatMap((e) => e.sets.map((s) => s.difficulty))
    .filter((d): d is number => d !== null);
  const avgDiff =
    allDiff.length === 0
      ? null
      : Math.round((allDiff.reduce((a, b) => a + b, 0) / allDiff.length) * 10) / 10;

  usePRToasts(exercises);

  return (
    <div>
      <div className="crumbs">
        <Link to="/podopieczny/historia">Historia</Link>
        <span className="sep">›</span>
        <span className="current">{log.sessionName}</span>
      </div>

      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {fmtDate(log.performedOn)} · {daysAgo(log.performedOn)}
          </div>
          <h1>{log.sessionName}</h1>
          <div className="sub">
            <span className="mono">{exercises.length}</span> ćwiczeń ·{" "}
            <span className="mono">{totalSets}</span> serii
            {!log.allDone && (
              <>
                {" · "}
                <strong style={{ color: "var(--warn)" }}>nie wszystkie serie wykonane</strong>
              </>
            )}
            {avgDiff != null && (
              <>
                {" · śr. trudność "}
                <strong style={{ color: "var(--ink)" }} className="mono">
                  {avgDiff}/10
                </strong>
              </>
            )}
          </div>
        </div>
      </div>

      {log.note != null && log.note.length > 0 && (
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--accent)",
            fontSize: 13,
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {log.note}
        </div>
      )}

      <div className="col" style={{ gap: 12 }}>
        {exercises.map((ex, eIdx) => (
          <ExerciseLogCard key={`${ex.exerciseId}-${eIdx}`} exercise={ex} index={eIdx} />
        ))}
      </div>
    </div>
  );
}

function usePRToasts(exercises: Array<{ exerciseId: string; exerciseName: string }>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const firedRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once on first render with ?pr=… / ?saved=…
  useEffect(() => {
    if (firedRef.current) return;
    const raw = searchParams.get("pr");
    const saved = searchParams.get("saved");
    if (!raw && !saved) return;
    firedRef.current = true;

    if (raw) {
      const ids = raw.split(",").filter(Boolean);
      const byId = new Map(exercises.map((e) => [e.exerciseId, e.exerciseName]));
      const names = ids.map((id) => byId.get(id)).filter((n): n is string => !!n);

      if (names.length === 1) {
        toast(`🏆 Nowy rekord w ${names[0]}!`, { durationMs: 5000 });
      } else if (names.length > 1) {
        toast(`🏆 Nowe rekordy: ${names.join(", ")}`, { durationMs: 6000 });
      }
    }

    // Zapis się powiódł — szkic tej sesji w sessionStorage jest już zbędny.
    if (saved) {
      try {
        sessionStorage.removeItem(draftKey(saved));
      } catch {
        // ignore — brak storage nic nie psuje.
      }
    }

    // Strip the params so a refresh doesn't refire.
    const next = new URLSearchParams(searchParams);
    next.delete("pr");
    next.delete("saved");
    setSearchParams(next, { replace: true });
  }, []);
}

function ExerciseLogCard({
  exercise: ex,
  index,
}: {
  exercise: WorkoutLogExerciseView;
  index: number;
}) {
  const totalReps = ex.sets.reduce((a, s) => a + s.reps, 0);
  const avgReps = ex.sets.length === 0 ? 0 : Math.round((totalReps / ex.sets.length) * 10) / 10;
  // Czy ten wpis ma jakąkolwiek ocenę RPE (data-driven) — ćwiczenia bez RPE
  // nie pokazują pigułki trudności przy seriach; historyczne z RPE nadal tak.
  const hasRpe = ex.sets.some((s) => s.difficulty !== null);

  // Bez liczby oczekiwanych serii (kontrakt jej nie niesie) wiersze idą od 0 do
  // najwyższego zalogowanego `ordinal` — luka w środku to seria pominięta. Ogona
  // nie widać; mówi o nim `allDone` w nagłówku strony.
  const setsByOrdinal = new Map(ex.sets.map((s) => [s.ordinal, s]));
  const lastLoggedOrdinal = ex.sets.length > 0 ? Math.max(...ex.sets.map((s) => s.ordinal)) : -1;
  const rows = Array.from({ length: lastLoggedOrdinal + 1 }, (_, ordinal) => ({
    ordinal,
    logged: setsByOrdinal.get(ordinal) ?? null,
  }));

  return (
    <div className="card card-padless">
      <div
        className="row between"
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--line)",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div className="row" style={{ gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span className="mono text-xs muted">#{String(index + 1).padStart(2, "0")}</span>
            {ex.origin === "substitute" && (
              <span className="badge">zamiast: {ex.substitutedExerciseName}</span>
            )}
            {ex.origin === "extra" && <span className="badge">spoza planu</span>}
          </div>
          <h3 style={{ margin: "2px 0 0" }}>{ex.exerciseName}</h3>
        </div>
        <div className="mono text-xs muted" style={{ textAlign: "right" }}>
          śr. {avgReps} {ex.unit === "SEC" ? "s" : "rep"}
        </div>
      </div>
      <div style={{ padding: 12, display: "grid", gap: 6 }}>
        {rows.map(({ ordinal, logged }) =>
          logged == null ? (
            <SkippedSetRow key={`skip-${ordinal}`} ordinal={ordinal} />
          ) : (
            <SetRowDisplay
              key={`set-${ordinal}`}
              ordinal={ordinal}
              reps={logged.reps}
              difficulty={logged.difficulty}
              hasRpe={hasRpe}
              unit={ex.unit}
              videoUrl={logged.videoUrl}
            />
          ),
        )}
      </div>
    </div>
  );
}

function SkippedSetRow({ ordinal }: { ordinal: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr",
        gap: 10,
        alignItems: "center",
        padding: "8px 10px",
        background: "var(--surface-2)",
        border: "1px dashed var(--line-2)",
        borderRadius: 8,
      }}
    >
      <span className="mono text-xs muted">#{ordinal + 1}</span>
      <span
        className="mono"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          color: "var(--warn)",
          fontWeight: 600,
        }}
      >
        Pominięta
      </span>
    </div>
  );
}

function SetRowDisplay({
  ordinal,
  reps,
  difficulty,
  hasRpe,
  unit,
  videoUrl,
}: {
  ordinal: number;
  reps: number;
  difficulty: number | null;
  hasRpe: boolean;
  unit: "REPS" | "SEC";
  videoUrl: string | null;
}) {
  const tone =
    difficulty === null
      ? "var(--muted)"
      : difficulty <= 4
        ? "var(--ok)"
        : difficulty <= 7
          ? "var(--warn)"
          : "var(--danger)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: hasRpe ? "32px 1fr auto auto" : "32px 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "8px 10px",
        background: "var(--bg)",
        border: "1px solid var(--line)",
        borderRadius: 8,
      }}
    >
      <span className="mono text-xs muted">#{ordinal + 1}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }} className="mono">
        {reps}
        <span
          style={{
            fontSize: 11,
            fontWeight: 400,
            color: "var(--muted)",
            marginLeft: 4,
            fontFamily: "var(--font-body)",
          }}
        >
          {unit === "SEC" ? "s" : "rep"}
        </span>
      </span>
      {hasRpe && (
        <span
          className="mono"
          style={{
            fontSize: 12,
            color: tone,
            fontWeight: 600,
            background: "var(--surface-2)",
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          {difficulty !== null ? `${difficulty}/10` : "—"}
        </span>
      )}
      {videoUrl ? (
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm"
          style={{ height: 26, padding: "0 8px", fontSize: 11 }}
        >
          <Icons.Play /> video
        </a>
      ) : (
        <span style={{ width: 1 }} />
      )}
    </div>
  );
}
