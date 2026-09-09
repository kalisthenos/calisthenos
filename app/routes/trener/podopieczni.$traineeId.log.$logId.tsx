import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import { VideoButton } from "~/components/video-modal";
import { requireUser } from "~/lib/api/auth";
import { daysAgo, fmtDate } from "~/lib/format";
import { findTraineeRef } from "~/lib/trainees";
import { loadTraineeLog } from "~/lib/workouts";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";

  // Nazwa podopiecznego do okruszków: kontrakt nie niesie jej ani w szczególe
  // logu, ani w przeglądzie klienta i nie ma trasy „jeden podopieczny" —
  // moduł składa ją ze sklejonych stron listy (luka L S5-2).
  const trainee = await findTraineeRef(api, traineeId);
  if (!trainee) throw new Response("not found", { status: 404 });

  // Parę (podopieczny, log) sprawdza BE — niezgodna to `404`, tu `null`.
  const log = await loadTraineeLog(api, traineeId, args.params.logId ?? "");
  if (!log) throw new Response("not found", { status: 404 });

  return { log, trainee };
}

function tone(diff: number | null): string {
  if (diff === null) return "var(--muted)";
  if (diff <= 4) return "var(--ok)";
  if (diff <= 7) return "var(--warn)";
  return "var(--danger)";
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export default function TrenerWorkoutLogDetail() {
  const { log, trainee } = useLoaderData<typeof loader>();
  const exercises = log.exercises;
  const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0);
  const allDiff = exercises
    .flatMap((e) => e.sets.map((s) => s.difficulty))
    .filter((d): d is number => d !== null);
  const avgDiff =
    allDiff.length === 0
      ? null
      : Math.round((allDiff.reduce((a, b) => a + b, 0) / allDiff.length) * 10) / 10;

  return (
    <div>
      <div className="crumbs">
        <Link to="/trener/podopieczni">Podopieczni</Link>
        <span className="sep">›</span>
        <Link to={`/trener/podopieczni/${trainee.id}`}>{trainee.displayName}</Link>
        <span className="sep">›</span>
        <span className="current">{log.sessionName}</span>
      </div>

      <div
        className="row between"
        style={{
          paddingBottom: 22,
          marginBottom: 24,
          borderBottom: "1px solid var(--line)",
          alignItems: "flex-end",
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {fmtDate(log.performedOn)} · {daysAgo(log.performedOn)}
          </div>
          <h1 style={{ fontSize: 24 }}>{log.sessionName}</h1>
          <div
            className="row"
            style={{ gap: 14, marginTop: 6, color: "var(--muted)", fontSize: 13.5 }}
          >
            <span>
              <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
                {exercises.length}
              </span>{" "}
              ćwiczeń
            </span>
            <span>·</span>
            <span>
              <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
                {totalSets}
              </span>{" "}
              serii
            </span>
            {!log.allDone && (
              <span style={{ color: "var(--warn)", fontWeight: 600 }}>
                · nie wszystkie serie wykonane
              </span>
            )}
            {avgDiff != null && (
              <>
                <span>·</span>
                <span>
                  śr. trudność{" "}
                  <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
                    {avgDiff}/10
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <span className="avatar">{initialsOf(trainee.displayName)}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{trainee.displayName}</div>
            <div className="mono text-xs muted">{trainee.id.slice(0, 8).toUpperCase()}</div>
          </div>
        </div>
      </div>

      {log.note != null && log.note.length > 0 && (
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--accent)",
            borderRadius: "4px 12px 12px 4px",
            fontSize: 14,
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            <Icons.Note style={{ color: "var(--muted)", marginTop: 2 }} />
            <div>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                  marginBottom: 4,
                }}
              >
                Notatka podopiecznego
              </div>
              {log.note}
            </div>
          </div>
        </div>
      )}

      <div className="col" style={{ gap: 16 }}>
        {exercises.map((ex, eIdx) => {
          const setCount = ex.sets.length;
          const totalReps = ex.sets.reduce((a, s) => a + s.reps, 0);
          const avgReps = setCount === 0 ? 0 : totalReps / setCount;
          const diffSets = ex.sets.filter((s) => s.difficulty !== null);
          const exAvgDiff =
            diffSets.length === 0
              ? null
              : diffSets.reduce((a, s) => a + (s.difficulty as number), 0) / diffSets.length;
          // Czy ten wpis ćwiczenia ma jakąkolwiek ocenę RPE (data-driven, nie wg
          // bieżącej flagi ćwiczenia) — dzięki temu historyczne logi z RPE nadal
          // pokazują trudność, a ćwiczenia bez RPE chowają kolumny Trudn./Wizualnie.
          const hasRpe = exAvgDiff != null;

          // Bez liczby oczekiwanych serii (kontrakt jej nie niesie) wiersze idą od 0 do
          // najwyższego zalogowanego `ordinal` — luka w środku to seria pominięta. Ogona
          // nie widać; mówi o nim `allDone` w nagłówku strony.
          const setsByOrdinal = new Map(ex.sets.map((s) => [s.ordinal, s]));
          const lastLoggedOrdinal =
            ex.sets.length > 0 ? Math.max(...ex.sets.map((s) => s.ordinal)) : -1;
          const rows = Array.from({ length: lastLoggedOrdinal + 1 }, (_, ordinal) => ({
            ordinal,
            logged: setsByOrdinal.get(ordinal) ?? null,
          }));

          return (
            <div key={`${ex.exerciseId}-${eIdx}`} className="card card-padless">
              <div
                className="row"
                style={{
                  padding: "14px 18px",
                  gap: 14,
                  borderBottom: "1px solid var(--line)",
                  alignItems: "center",
                }}
              >
                <div className="mono text-xs muted" style={{ width: 24 }}>
                  {String(eIdx + 1).padStart(2, "0")}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: 15.5, margin: 0 }}>{ex.exerciseName}</h3>
                    <span className={`badge${ex.unit === "REPS" ? " active" : ""}`}>{ex.unit}</span>
                    {ex.origin === "substitute" && (
                      <span className="badge">zamiast: {ex.substitutedExerciseName}</span>
                    )}
                    {ex.origin === "extra" && <span className="badge">spoza planu</span>}
                  </div>
                </div>
                <div className="row" style={{ gap: 18 }}>
                  <div style={{ textAlign: "right" }}>
                    <div
                      className="mono muted"
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: ".08em",
                      }}
                    >
                      Średnio
                    </div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                      {avgReps.toFixed(1)} {ex.unit === "SEC" ? "s" : "rep"}
                    </div>
                  </div>
                  {hasRpe && (
                    <div style={{ textAlign: "right" }}>
                      <div
                        className="mono muted"
                        style={{
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: ".08em",
                        }}
                      >
                        Trudność
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: tone(exAvgDiff),
                        }}
                      >
                        {exAvgDiff == null ? "—" : `${exAvgDiff.toFixed(1)}/10`}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div
                className="row"
                style={{
                  padding: 18,
                  gap: 18,
                  alignItems: "flex-start",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    className="set-grid"
                    style={{
                      gridTemplateColumns: hasRpe ? "44px 78px 70px 1fr 60px" : "44px 1fr 60px",
                      marginBottom: 4,
                    }}
                  >
                    <span className="label-mini">Seria</span>
                    <span className="label-mini">{ex.unit === "REPS" ? "Powt." : "Sek."}</span>
                    {hasRpe && <span className="label-mini">Trudn.</span>}
                    {hasRpe && <span className="label-mini">Wizualnie</span>}
                    <span className="label-mini">Video</span>
                  </div>
                  {rows.map(({ ordinal, logged }, rowIdx) =>
                    logged == null ? (
                      <div
                        key={`skip-${ordinal}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "44px 1fr",
                          padding: "8px 0",
                          borderTop: rowIdx > 0 ? "1px dashed var(--line)" : "none",
                          alignItems: "center",
                          color: "var(--muted)",
                          opacity: 0.75,
                        }}
                      >
                        <span className="mono" style={{ fontWeight: 600 }}>
                          #{ordinal + 1}
                        </span>
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
                    ) : (
                      <div
                        key={`set-${ordinal}`}
                        className="set-grid"
                        style={{
                          gridTemplateColumns: hasRpe ? "44px 78px 70px 1fr 60px" : "44px 1fr 60px",
                          padding: "8px 0",
                          borderTop: rowIdx > 0 ? "1px dashed var(--line)" : "none",
                          alignItems: "center",
                        }}
                      >
                        <span className="mono" style={{ fontWeight: 600 }}>
                          #{ordinal + 1}
                        </span>
                        <span className="mono">
                          <span style={{ fontWeight: 600, fontSize: 15 }}>{logged.reps}</span>{" "}
                          <span className="muted text-xs">{ex.unit === "SEC" ? "sek" : "rep"}</span>
                        </span>
                        {hasRpe && (
                          <span
                            className="mono"
                            style={{
                              color: tone(logged.difficulty),
                              fontWeight: 600,
                            }}
                          >
                            {logged.difficulty !== null ? `${logged.difficulty}/10` : "—"}
                          </span>
                        )}
                        {hasRpe && (
                          <div style={{ display: "flex", gap: 2 }}>
                            {Array.from({ length: 10 }, (_, n) => `cell-${n}`).map((cellKey, n) => (
                              <div
                                key={cellKey}
                                style={{
                                  flex: 1,
                                  height: 6,
                                  borderRadius: 2,
                                  background:
                                    logged.difficulty !== null && n < logged.difficulty
                                      ? tone(logged.difficulty)
                                      : "var(--surface-2)",
                                }}
                              />
                            ))}
                          </div>
                        )}
                        <span>
                          {logged.videoUrl ? (
                            <VideoButton
                              src={logged.videoUrl}
                              title={`${ex.exerciseName} · seria ${ordinal + 1}`}
                              label="video"
                              size="sm"
                            />
                          ) : (
                            <span className="mono text-xs muted">—</span>
                          )}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
