import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import { ListControls } from "~/components/list-controls";
import { Pagination, parsePage } from "~/components/pagination";
import { requireUser } from "~/lib/api/auth";
import { type PlForms, fmtDate, pluralizePl } from "~/lib/format";
import { type ListControlsSpec, parseListControls } from "~/lib/list-params";
import { type LogSort, type VideoFilter, listMyLogs } from "~/lib/workouts";

const SESJA: PlForms = { one: "sesja", few: "sesje", many: "sesji" };

const spec: ListControlsSpec = {
  sortOptions: [
    { key: "date_desc", label: "Najnowsze" },
    { key: "date_asc", label: "Najstarsze" },
    { key: "hardest", label: "Najtrudniejsze" },
    { key: "easiest", label: "Najłatwiejsze" },
    { key: "sets_desc", label: "Najwięcej serii" },
  ],
  defaultSort: "date_desc",
  filterGroups: [
    {
      param: "video",
      label: "Wideo",
      options: [
        { value: "all", label: "Wszystkie" },
        { value: "with", label: "Z wideo" },
        { value: "without", label: "Bez wideo" },
      ],
      defaultValue: "all",
    },
  ],
  searchable: true,
};

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  const url = new URL(args.request.url);
  const page = parsePage(url.searchParams);
  const controls = parseListControls(url.searchParams, spec);

  // Jedno żądanie zamiast dwóch: strona przychodzi razem z `total`, a `page`
  // spoza zakresu przycina BE — dawne `safePage` nie ma już czego liczyć.
  const result = await listMyLogs(api, {
    page,
    sort: controls.sort as LogSort,
    q: controls.q,
    video: (controls.filters.video ?? "all") as VideoFilter,
  });

  return {
    logs: result.items,
    spec,
    controls,
    page: result.page,
    totalPages: result.totalPages,
    total: result.total,
  };
}

export default function TraineeHistoryList() {
  const { logs, spec, controls, page, totalPages, total } = useLoaderData<typeof loader>();

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Podopieczny
          </div>
          <h1>Historia treningów</h1>
          <div className="sub">
            {total === 0
              ? "Jeszcze nic nie zarejestrowano."
              : `${total} ${pluralizePl(total, SESJA)} łącznie.`}
          </div>
        </div>
      </div>

      <ListControls spec={spec} state={controls} searchPlaceholder="Szukaj po nazwie sesji…" />

      {total === 0 ? (
        <div className="empty">
          <h3>Brak sesji</h3>
          <div>Zarejestruj pierwszą z pulpitu.</div>
        </div>
      ) : (
        <div className="list">
          {logs.map((log) => (
            <Link
              key={log.id}
              to={`/podopieczny/historia/${log.id}`}
              className="list-row"
              style={{ gridTemplateColumns: "76px 1fr auto", gap: 14 }}
            >
              <div className="mono text-xs muted">{fmtDate(log.performedOn)}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{log.sessionName}</div>
                <div className="text-xs muted" style={{ marginTop: 2 }}>
                  <span className="mono">{log.exerciseCount}</span> ćwiczeń ·{" "}
                  <span className="mono">{log.setCount}</span> serii · śr.{" "}
                  {log.avgDifficulty == null ? (
                    "—"
                  ) : (
                    <>
                      <span className="mono">{log.avgDifficulty}</span>/10
                    </>
                  )}
                  {log.hasVideo && " · video"}
                </div>
              </div>
              <Icons.Chev style={{ color: "var(--muted-2)" }} />
            </Link>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        totalLabel={pluralizePl(total, SESJA)}
      />
    </div>
  );
}
