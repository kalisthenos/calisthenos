import type { PlanTreeSessionView } from "@kalisthenos/api-client";
import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import { requireUser } from "~/lib/api/auth";
import { fmtDate } from "~/lib/format";
import { loadMyActivePlan } from "~/lib/workouts";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  const plan = await loadMyActivePlan(api);
  return { plan };
}

export default function TraineeSessionsList() {
  const { plan } = useLoaderData<typeof loader>();

  if (plan == null) {
    return (
      <div>
        <div className="pagehead">
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Sesje
            </div>
            <h1>Brak aktywnego planu</h1>
            <div className="sub">Trener przygotuje go wkrótce.</div>
          </div>
        </div>
        <div className="empty">
          <h3>Nic do pokazania</h3>
          <div>Gdy trener opublikuje plan, sesje pojawią się tutaj.</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Aktywny plan · v{plan.version}
            {plan.publishedAt && <> · od {fmtDate(plan.publishedAt)}</>}
          </div>
          <h1>{plan.name}</h1>
          <div className="sub">{plan.sessions.length} sesji do wyboru</div>
        </div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}
      >
        {plan.sessions.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session }: { session: PlanTreeSessionView }) {
  const blocks = session.blocks;
  const totalExercises = blocks.reduce((a, b) => a + b.items.length, 0);
  const supersetCount = blocks.filter((b) => b.kind === "superset").length;
  const dropsetCount = blocks.filter((b) => b.kind === "dropset").length;

  return (
    <div className="card card-hover" style={{ padding: 18, position: "relative" }}>
      <Link
        to={`/podopieczny/sesje/${session.id}`}
        aria-label={`Otwórz sesję ${session.name}`}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          borderRadius: "inherit",
        }}
      />
      <div
        className="row between"
        style={{ marginBottom: 12, alignItems: "flex-start", position: "relative", zIndex: 0 }}
      >
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 4 }}>{session.name}</h3>
          <div className="text-xs muted">
            <span className="mono">{totalExercises}</span> ćwiczeń
            {supersetCount > 0 && (
              <>
                {" "}
                · <span className="mono">{supersetCount}</span> supersetów
              </>
            )}
            {dropsetCount > 0 && (
              <>
                {" "}
                · <span className="mono">{dropsetCount}</span> dropsetów
              </>
            )}
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: 6, position: "relative", zIndex: 0 }}>
        {blocks.slice(0, 4).map((b, bi) => {
          const first = b.items[0];
          return (
            <div key={b.id} className="row" style={{ gap: 8, fontSize: 13 }}>
              <span className="mono muted" style={{ fontSize: 11, width: 22, textAlign: "center" }}>
                {String.fromCharCode(65 + bi)}
              </span>
              {b.kind === "superset" && (
                <Icons.Link style={{ color: "var(--muted)", fontSize: 13 }} />
              )}
              {b.kind === "dropset" && (
                <Icons.Drop
                  style={{
                    color: "var(--accent-ink)",
                    background: "var(--accent)",
                    padding: 2,
                    borderRadius: 3,
                    fontSize: 11,
                  }}
                />
              )}
              <span style={{ flex: 1, color: "var(--ink-2)" }}>
                {b.items.map((r) => r.exerciseName).join(b.kind === "dropset" ? " → " : " + ")}
              </span>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {b.kind === "dropset"
                  ? `${b.sets ?? 0}×${b.items.length}drop`
                  : `${first?.sets ?? 0}×${first?.reps ?? 0}${first?.unit === "SEC" ? "s" : ""}`}
              </span>
            </div>
          );
        })}
        {blocks.length > 4 && (
          <div className="text-xs muted" style={{ marginTop: 4 }}>
            + {blocks.length - 4} kolejnych bloków…
          </div>
        )}
      </div>

      <div
        className="row"
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px dashed var(--line)",
          alignItems: "center",
          justifyContent: "flex-end",
          position: "relative",
          zIndex: 2,
        }}
      >
        <Link to={`/podopieczny/loguj/${session.id}`} className="btn btn-primary btn-sm">
          <Icons.Plus /> Zarejestruj
        </Link>
      </div>
    </div>
  );
}
