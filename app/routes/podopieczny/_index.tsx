import { useEffect, useState } from "react";
import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import {
  ActivityHeatmapCard,
  EffortBalanceCard,
  HeroStatsCard,
  ThisWeekCard,
  WrappedListRow,
} from "~/components/trainee-stats";
import { requireUser } from "~/lib/api/auth";
import { daysAgo, fmtDateShort } from "~/lib/format";
import { loadTraineeDashboard } from "~/lib/views";
import { latestWrappedMonth } from "~/lib/wrapped";

// ============================================================
// Wrapped banner — appears when the previous month's wrapped is fresh and
// hasn't been viewed yet (`localStorage.wrapped-viewed-YYYY-MM`). Hidden on
// SSR/initial-render to avoid hydration mismatch + a flash for repeat viewers.
// ============================================================

function WrappedBanner({
  wrapped,
}: {
  wrapped: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>["latestWrapped"]>;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const viewed = localStorage.getItem(`wrapped-viewed-${wrapped.ym}`);
      const dismissed = localStorage.getItem(`wrapped-dismissed-${wrapped.ym}`);
      if (!viewed && !dismissed) setShow(true);
    } catch {
      // localStorage blocked → just show; clicking through marks it server-side
      // on the wrapped page itself anyway.
      setShow(true);
    }
  }, [wrapped.ym]);

  const dismiss = () => {
    try {
      localStorage.setItem(`wrapped-dismissed-${wrapped.ym}`, "1");
    } catch {
      // ignored
    }
    setShow(false);
  };

  if (!show) return null;
  return (
    <div
      className="card"
      style={{
        background: "var(--ink)",
        color: "var(--bg)",
        border: 0,
        padding: 18,
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background: "var(--accent)",
          opacity: 0.18,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: ".12em",
            color: "var(--accent)",
            marginBottom: 6,
          }}
        >
          ✨ Świeży wrapped
        </div>
        <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>
          Twój {wrapped.label} jest gotowy.
        </div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          {wrapped.sessions} {wrapped.sessions === 1 ? "sesja" : "sesji"} do obejrzenia w klimacie
          Spotify Wrapped.
        </div>
      </div>
      <div className="row" style={{ gap: 8, position: "relative", flexShrink: 0 }}>
        <button
          type="button"
          onClick={dismiss}
          className="btn"
          style={{
            background: "transparent",
            color: "var(--bg)",
            borderColor: "rgba(255,255,255,.18)",
          }}
        >
          Później
        </button>
        <Link to={`/podopieczny/wrapped/${wrapped.ym}`} className="btn btn-primary">
          Otwórz wrapped <Icons.Chev />
        </Link>
      </div>
    </div>
  );
}

export async function loader(args: LoaderFunctionArgs) {
  const { api, user } = requireUser(args.context, { role: "trainee" });

  // Jedno wywołanie na ekran (B5): do integracji ten loader składał pulpit
  // z ośmiu zapytań trzech modułów. `activePlan` niesie liczbę wykonań per
  // sesja, `recentLogs` pięć ostatnich treningów, `wrappedMonths` listę
  // podsumowań; baner „świeży wrapped" bierze z niej najpóźniejszy miesiąc,
  // a klient sam wycisza go po obejrzeniu albo odrzuceniu (localStorage).
  const home = await loadTraineeDashboard(api);

  return {
    user,
    activePlan: home.activePlan,
    recent: home.recentLogs,
    hero: home.hero,
    thisWeek: home.thisWeek,
    heatmap: home.heatmap,
    effort: home.effort,
    wrappedMonths: home.wrappedMonths,
    latestWrapped: latestWrappedMonth(home.wrappedMonths),
  };
}

export default function TraineeDashboard() {
  const {
    user,
    activePlan,
    recent,
    hero,
    thisWeek,
    heatmap,
    effort,
    wrappedMonths,
    latestWrapped,
  } = useLoaderData<typeof loader>();

  const firstName = user.displayName.split(" ")[0] ?? user.displayName;

  return (
    <div>
      {latestWrapped && <WrappedBanner wrapped={latestWrapped} />}

      <div
        className="row between"
        style={{
          paddingBottom: 22,
          marginBottom: 22,
          borderBottom: "1px solid var(--line)",
          alignItems: "flex-end",
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Cześć, {firstName}
          </div>
          <h1 style={{ fontSize: 30 }}>Twój trening</h1>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
            Twoje sesje i historia treningów.
          </div>
        </div>
        {activePlan != null && activePlan.sessions.length > 0 && (
          <Link to="/podopieczny/sesje" className="btn btn-primary btn-lg">
            <Icons.Plus /> Zarejestruj sesję
          </Link>
        )}
      </div>

      {hero.totalSessions > 0 && <HeroStatsCard hero={hero} />}

      {activePlan == null ? (
        <div className="empty" style={{ marginBottom: 22 }}>
          <h3>Brak aktywnego planu</h3>
          <div>Trener przygotuje go wkrótce.</div>
        </div>
      ) : (
        <div
          className="card"
          style={{
            background: "var(--ink)",
            color: "var(--bg)",
            border: 0,
            marginBottom: 20,
            padding: 24,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -40,
              right: -40,
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: "var(--accent)",
              opacity: 0.15,
              pointerEvents: "none",
            }}
          />
          <div className="row between" style={{ alignItems: "flex-start", position: "relative" }}>
            <div>
              <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
                <span
                  className="badge"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--accent)",
                    color: "var(--accent)",
                  }}
                >
                  <span className="badge-dot" style={{ background: "var(--accent)" }} />
                  aktywny plan
                </span>
              </div>
              <h2 style={{ fontSize: 24, color: "var(--bg)", margin: 0 }}>{activePlan.name}</h2>
              <div className="mono" style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                {activePlan.sessions.length} sesji do wyboru
              </div>
            </div>
            <Link
              to="/podopieczny/sesje"
              className="btn"
              style={{
                background: "transparent",
                color: "var(--bg)",
                borderColor: "rgba(255,255,255,.15)",
              }}
            >
              Lista sesji <Icons.Chev />
            </Link>
          </div>
        </div>
      )}

      {hero.totalSessions > 0 && (
        <>
          <ThisWeekCard thisWeek={thisWeek} />
          <ActivityHeatmapCard days={heatmap} />
          <EffortBalanceCard effort={effort} />
        </>
      )}

      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}
      >
        {activePlan != null && activePlan.sessions.length > 0 && (
          <section>
            <div className="row between" style={{ alignItems: "baseline", marginBottom: 10 }}>
              <h2 style={{ fontSize: 16 }}>Sesje w planie</h2>
              <Link to="/podopieczny/sesje" className="btn btn-ghost btn-sm">
                Szczegóły <Icons.Chev />
              </Link>
            </div>
            <div className="list">
              {activePlan.sessions.map((s, idx) => (
                <div
                  key={s.id}
                  className="list-row"
                  style={{
                    gridTemplateColumns: "32px 1fr auto auto",
                    gap: 12,
                    padding: "12px 16px",
                  }}
                >
                  <div className="mono text-xs muted" style={{ textAlign: "center" }}>
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{s.name}</div>
                    <div className="text-xs muted" style={{ marginTop: 2 }}>
                      {s.logCount === 0
                        ? "jeszcze nie wykonana"
                        : `×${s.logCount}${
                            s.lastPerformedOn ? ` · ostatnio ${daysAgo(s.lastPerformedOn)}` : ""
                          }`}
                    </div>
                  </div>
                  <Link to={`/podopieczny/loguj/${s.id}`} className="btn btn-primary btn-sm">
                    <Icons.Plus /> Zarejestruj
                  </Link>
                  <Link
                    to={`/podopieczny/sesje/${s.id}`}
                    className="btn btn-ghost btn-sm btn-icon"
                    aria-label="Szczegóły sesji"
                  >
                    <Icons.Chev />
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="row between" style={{ alignItems: "baseline", marginBottom: 10 }}>
            <h2 style={{ fontSize: 16 }}>Twoja historia</h2>
            {recent.length > 0 && (
              <Link to="/podopieczny/historia" className="btn btn-ghost btn-sm">
                Wszystkie <Icons.Chev />
              </Link>
            )}
          </div>
          {recent.length === 0 ? (
            <div className="empty">
              <h3>Brak treningów</h3>
              <div>Jeszcze nic nie zarejestrowano.</div>
            </div>
          ) : (
            <div className="list">
              {recent.map((log) => (
                <Link
                  key={log.id}
                  to={`/podopieczny/historia/${log.id}`}
                  className="list-row"
                  style={{ gridTemplateColumns: "60px 1fr auto", gap: 12, padding: "12px 16px" }}
                >
                  <div className="mono text-xs muted">{fmtDateShort(log.performedOn)}</div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{log.sessionName}</div>
                  </div>
                  <Icons.Chev style={{ color: "var(--muted-2)" }} />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <WrappedListRow months={wrappedMonths} />
    </div>
  );
}
