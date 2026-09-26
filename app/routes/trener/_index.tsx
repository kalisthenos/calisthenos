import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import { requireUser } from "~/lib/api/auth";
import { type PlForms, daysAgo, pluralizePl } from "~/lib/format";
import { loadTrainerDashboard } from "~/lib/views";

const OSOBA_AKTYWNA: PlForms = {
  one: "osoba aktywna",
  few: "osoby aktywne",
  many: "osób aktywnych",
};

export async function loader(args: LoaderFunctionArgs) {
  const { api, user } = requireUser(args.context, { role: "trainer" });

  // Jedno wywołanie na ekran (B5): klienci, sześć ostatnich treningów i trzy
  // liczniki przychodzą razem. Okno „sesje w 7 dni" liczy BE — od `dziś − 7 dni`
  // włącznie, dokładnie jak liczył `countLogsForTrainerSince`.
  const dashboard = await loadTrainerDashboard(api);

  return {
    user,
    clients: dashboard.clients,
    recentLogs: dashboard.recentLogs,
    stats: {
      activePlans: dashboard.activePlans,
      drafts: dashboard.drafts,
      weekSessions: dashboard.weekSessions,
    },
  };
}

export default function TrenerPulpit() {
  const { user, clients, recentLogs, stats } = useLoaderData<typeof loader>();
  const greeting = user.displayName.split(" ")[0] ?? user.displayName;
  const noClients = clients.length === 0;

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1>Cześć, {greeting}</h1>
          <div className="sub">
            {noClients
              ? "Zaproś pierwszego podopiecznego, by zacząć."
              : `${clients.length} ${pluralizePl(clients.length, OSOBA_AKTYWNA)}.`}
          </div>
        </div>
        {noClients ? (
          <Link to="/trener/podopieczni" className="btn btn-primary">
            <Icons.Plus /> Zaproś podopiecznego
          </Link>
        ) : (
          <Link to="/trener/plany/nowy" className="btn btn-primary">
            <Icons.Plus /> Nowy plan
          </Link>
        )}
      </div>

      {!noClients && (
        <div
          className="card"
          style={{
            display: "flex",
            gap: 28,
            padding: "16px 20px",
            marginBottom: 22,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            to="/trener/plany?status=active"
            className="stat"
            style={{ textDecoration: "none" }}
          >
            <div className="v">{stats.activePlans}</div>
            <div className="k">aktywnych planów</div>
          </Link>
          <span className="vdiv" style={{ height: 36 }} />
          <div className="stat">
            <div className="v">{stats.weekSessions}</div>
            <div className="k">sesji w 7 dni</div>
          </div>
          <span className="vdiv" style={{ height: 36 }} />
          <Link
            to="/trener/plany?status=draft"
            className="stat"
            style={{
              textDecoration: "none",
              color: stats.drafts > 0 ? "var(--warn)" : undefined,
            }}
          >
            <div className="v">{stats.drafts}</div>
            <div className="k">draftów</div>
          </Link>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", gap: 22 }}>
        <section>
          <div className="row between" style={{ alignItems: "baseline", marginBottom: 12 }}>
            <h2 style={{ fontSize: 17 }}>Podopieczni</h2>
            {clients.length > 0 && (
              <Link to="/trener/podopieczni" className="btn btn-ghost btn-sm">
                Wszyscy <Icons.Chev />
              </Link>
            )}
          </div>
          {clients.length === 0 ? (
            <div className="empty">
              <h3>Brak podopiecznych</h3>
              <div>Wygeneruj pierwsze zaproszenie w zakładce „Podopieczni".</div>
            </div>
          ) : (
            <div className="list">
              {clients.slice(0, 6).map((c) => (
                <Link
                  key={c.id}
                  to={`/trener/podopieczni/${c.id}`}
                  className="list-row"
                  style={{
                    gridTemplateColumns: "auto 1fr auto auto",
                    gap: 12,
                    padding: "12px 16px",
                  }}
                >
                  <span className="avatar sm">{initialsOf(c.displayName)}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{c.displayName}</div>
                    <div className="text-xs muted" style={{ marginTop: 2 }}>
                      {c.hasActivePlan ? "aktywny plan" : "brak planu"}
                    </div>
                  </div>
                  <div className="mono text-xs muted">
                    {c.lastSessionOn ? daysAgo(c.lastSessionOn) : "brak sesji"}
                  </div>
                  <Icons.Chev style={{ color: "var(--muted-2)" }} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="row between" style={{ alignItems: "baseline", marginBottom: 12 }}>
            <h2 style={{ fontSize: 17 }}>Ostatnie sesje</h2>
            <Icons.History style={{ color: "var(--muted)" }} />
          </div>
          {recentLogs.length === 0 ? (
            <div className="empty">
              <h3>Brak sesji</h3>
              <div>Nikt jeszcze nie zarejestrował treningu.</div>
            </div>
          ) : (
            <div className="list">
              {recentLogs.map((log) => (
                <Link
                  key={log.id}
                  to={`/trener/podopieczni/${log.traineeId}/log/${log.id}`}
                  className="list-row"
                  style={{ gridTemplateColumns: "auto 1fr auto", gap: 12, padding: "12px 16px" }}
                >
                  <span className="avatar sm">{initialsOf(log.traineeName)}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{log.traineeName}</div>
                    <div className="text-xs muted" style={{ marginTop: 2 }}>
                      {log.sessionName}
                    </div>
                  </div>
                  <div className="mono text-xs muted">{daysAgo(log.performedOn)}</div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <div style={{ marginTop: 22 }}>
        <Link to="/trener/plany" className="muted text-xs">
          Plany ›
        </Link>
        <span className="muted text-xs" style={{ margin: "0 10px" }}>
          ·
        </span>
        <Link to="/trener/biblioteka" className="muted text-xs">
          Biblioteka ćwiczeń ›
        </Link>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}
