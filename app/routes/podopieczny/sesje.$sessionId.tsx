import type { SessionBlockView, SessionItemView } from "@kalisthenos/api-client";
import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import { VideoButton } from "~/components/video-modal";
import { requireUser } from "~/lib/api/auth";
import { loadSessionForLogging } from "~/lib/workouts";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  // Sesja przychodzi z podpisanym demo per pozycja; cudza albo nieistniejąca to
  // `null` (404), sesja szkicu — `409` z BE do granicy błędu.
  const session = await loadSessionForLogging(api, args.params.sessionId ?? "");
  if (!session) throw new Response("not found", { status: 404 });
  return { session };
}

export default function TraineeSessionDetail() {
  const { session } = useLoaderData<typeof loader>();
  const blocks = session.blocks;
  const totalSets = blocks.reduce((a, b) => {
    if (b.kind === "dropset") return a + (b.sets ?? 0);
    return a + b.items.reduce((aa, it) => aa + (it.sets ?? 0), 0);
  }, 0);

  return (
    <div>
      <div className="crumbs">
        <Link to="/podopieczny/sesje">Sesje</Link>
        <span className="sep">›</span>
        <span className="current">{session.name}</span>
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
            Sesja
          </div>
          <h1 style={{ fontSize: 26 }}>{session.name}</h1>
          <div
            className="row"
            style={{ gap: 14, marginTop: 6, color: "var(--muted)", fontSize: 13.5 }}
          >
            <span>
              <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
                {blocks.length}
              </span>{" "}
              bloków
            </span>
            <span>·</span>
            <span>
              <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
                {blocks.reduce((a, b) => a + b.items.length, 0)}
              </span>{" "}
              ćwiczeń
            </span>
            <span>·</span>
            <span>
              <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
                {totalSets}
              </span>{" "}
              serii zaplanowanych
            </span>
          </div>
        </div>
        <Link to={`/podopieczny/loguj/${session.id}`} className="btn btn-primary btn-lg">
          <Icons.Plus /> Zarejestruj wykonanie
        </Link>
      </div>

      <div className="col" style={{ gap: 14 }}>
        {blocks.map((b, bi) => (
          <BlockView key={b.id} bi={bi} block={b} />
        ))}
      </div>

      <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--line)" }}>
        <Link
          to={`/podopieczny/loguj/${session.id}`}
          className="btn btn-primary btn-lg"
          style={{ width: "100%", justifyContent: "center" }}
        >
          <Icons.Plus /> Zarejestruj wykonanie tej sesji
        </Link>
      </div>
    </div>
  );
}

function BlockView({
  bi,
  block: b,
}: {
  bi: number;
  block: SessionBlockView;
}) {
  return (
    <div className="card card-padless">
      <div
        className="row"
        style={{
          padding: "12px 18px",
          gap: 14,
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--line)",
          alignItems: "center",
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: ".06em",
          }}
        >
          Blok {String.fromCharCode(65 + bi)}
        </div>
        {b.kind === "superset" && (
          <span className="badge">
            <Icons.Link /> Superset · naprzemiennie
          </span>
        )}
        {b.kind === "dropset" && (
          <span
            className="badge"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent-ink)",
              borderColor: "transparent",
            }}
          >
            <Icons.Drop /> Drop set · {b.items.length} dropów bez przerwy
          </span>
        )}
      </div>

      {b.kind === "dropset" ? (
        <div style={{ padding: 18 }}>
          <div
            className="row"
            style={{
              gap: 18,
              marginBottom: 14,
              paddingBottom: 12,
              borderBottom: "1px dashed var(--line)",
            }}
          >
            <div>
              <div
                className="mono muted"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}
              >
                Serie
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                {b.sets ?? 0}
              </div>
            </div>
            <div>
              <div
                className="mono muted"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}
              >
                Przerwa po serii
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                {b.restSeconds != null ? `${b.restSeconds}s` : "—"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {b.items.map((it, di) => (
              <DropRow key={it.id} it={it} di={di} total={b.items.length} />
            ))}
          </div>
        </div>
      ) : (
        <div className="col" style={{ padding: 18, gap: 14 }}>
          {b.items.map((it, ei) => (
            <ExerciseRow key={it.id} it={it} ei={ei} kind={b.kind} />
          ))}
        </div>
      )}
    </div>
  );
}

function DropRow({
  it,
  di,
  total,
}: {
  it: SessionItemView;
  di: number;
  total: number;
}) {
  return (
    <div>
      <div className="row" style={{ gap: 14, alignItems: "flex-start", padding: "10px 0" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 6,
            background: di === 0 ? "var(--ink)" : "var(--surface-2)",
            color: di === 0 ? "var(--bg)" : "var(--ink)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {di + 1}
        </div>
        <div style={{ flex: 1 }}>
          <div
            className="row"
            style={{ gap: 10, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}
          >
            <h3 style={{ fontSize: 14.5, margin: 0 }}>{it.exerciseName}</h3>
            <span className={`badge${it.unit === "REPS" ? " active" : ""}`}>{it.unit}</span>
            {it.demoUrl && <VideoButton src={it.demoUrl} title={it.exerciseName} size="sm" />}
          </div>
          <div className="row" style={{ gap: 14, alignItems: "center" }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
              {it.reps} {it.unit === "SEC" ? "sek" : "powt."}
            </div>
          </div>
        </div>
      </div>
      {di < total - 1 && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            color: "var(--accent-ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            background: "var(--accent-soft)",
            borderRadius: 4,
            marginLeft: 44,
            marginBottom: 4,
          }}
        >
          <Icons.ChevDown style={{ fontSize: 12 }} />
          bez przerwy
        </div>
      )}
    </div>
  );
}

function ExerciseRow({
  it,
  ei,
  kind,
}: {
  it: SessionItemView;
  ei: number;
  kind: "single" | "superset" | "dropset";
}) {
  return (
    <div style={{ flex: 1 }}>
      <div
        className="row"
        style={{ gap: 10, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}
      >
        <h3 style={{ fontSize: 16, margin: 0 }}>{it.exerciseName}</h3>
        <span className={`badge${it.unit === "REPS" ? " active" : ""}`}>{it.unit}</span>
        {kind === "superset" && (
          <span
            className="mono muted"
            style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}
          >
            część {ei === 0 ? "A" : "B"}
          </span>
        )}
        {it.demoUrl && <VideoButton src={it.demoUrl} title={it.exerciseName} />}
      </div>
      <div style={{ flex: 1 }}>
        <div className="row" style={{ gap: 18, marginBottom: 8 }}>
          <Stat label="Serie" value={String(it.sets ?? 0)} />
          <Stat label={it.unit === "REPS" ? "Powtórzenia" : "Sekundy"} value={String(it.reps)} />
          <Stat label="Przerwa" value={it.restSeconds != null ? `${it.restSeconds}s` : "—"} />
        </div>
        {it.note && (
          <div
            className="muted"
            style={{
              fontSize: 12.5,
              fontStyle: "italic",
              marginTop: 6,
              paddingLeft: 10,
              borderLeft: "2px solid var(--accent)",
            }}
          >
            „{it.note}"
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="mono muted"
        style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}
      >
        {label}
      </div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}
