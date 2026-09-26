import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { ComparisonChart, ComparisonChartLegend } from "~/components/progression-charts";
import { requireUser } from "~/lib/api/auth";
import { comparisonSkipReasonLabel, loadMyProgressionComparison } from "~/lib/progression";
import type { ProgressionRange } from "~/lib/progression-math";

const RANGES: ProgressionRange[] = ["4w", "3m", "6m", "all"];

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  const url = new URL(args.request.url);
  // Kontrakt przyjmuje 2–8 ćwiczeń i odrzuca duplikat (`400`): zestaw jest
  // deduplikowany i przycięty do ośmiu PRZED wywołaniem, a poniżej dwóch nie ma
  // czego pytać — ręcznie zedytowany adres ma skończyć się podpowiedzią, nie
  // ekranem błędu.
  const ids = [
    ...new Set(
      (url.searchParams.get("ex") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 8);
  const raw = url.searchParams.get("zakres");
  const range: ProgressionRange = (RANGES as string[]).includes(raw ?? "")
    ? (raw as ProgressionRange)
    : "3m";
  const comparison = ids.length >= 2 ? await loadMyProgressionComparison(api, ids, range) : null;
  return { comparison, range, ids };
}

const RANGE_LABELS: Array<{ value: ProgressionRange; label: string }> = [
  { value: "4w", label: "4 tyg" },
  { value: "3m", label: "3 mies" },
  { value: "6m", label: "6 mies" },
  { value: "all", label: "cały" },
];

export default function PodopiecznyRozwojPorownanie() {
  const { comparison, range, ids } = useLoaderData<typeof loader>();

  // Defense in depth: the list disables Compare under 2, but a hand-edited URL
  // could land here with too few exercises — the loader then skips the call.
  if (ids.length < 2 || comparison == null) {
    return (
      <div>
        <div className="crumbs">
          <Link to="/podopieczny/rozwoj">Rozwój</Link>
          <span className="sep">›</span>
          <span className="current">Porównanie</span>
        </div>
        <div className="card" style={{ padding: 22, textAlign: "center" }}>
          <div className="sub" style={{ marginBottom: 14 }}>
            Wybierz co najmniej 2 ćwiczenia na liście Rozwoju, aby je porównać.
          </div>
          <Link to="/podopieczny/rozwoj" className="btn">
            Wróć do Rozwoju
          </Link>
        </div>
      </div>
    );
  }

  const exParam = ids.join(",");

  return (
    <div>
      <div className="crumbs">
        <Link to="/podopieczny/rozwoj">Rozwój</Link>
        <span className="sep">›</span>
        <span className="current">Porównanie</span>
      </div>

      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Podopieczny · Rozwój
          </div>
          <h1>Porównanie progresji</h1>
          <div className="sub">
            Każda linia to o ile % urósł rekord od początku okresu — wspólna oś % zestawia różne
            jednostki (powt. i sek.).
          </div>
        </div>
      </div>

      {/* Range switcher — loader-driven via ?zakres=, preserving ?ex= */}
      <div
        className="row"
        style={{ gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}
      >
        <span
          className="text-xs muted"
          style={{ textTransform: "uppercase", letterSpacing: ".04em" }}
        >
          Okres
        </span>
        <div className="row wrap" style={{ gap: 6 }}>
          {RANGE_LABELS.map((r) => {
            const active = r.value === range;
            return (
              <Link
                key={r.value}
                to={`?ex=${exParam}&zakres=${r.value}`}
                preventScrollReset
                className="btn btn-sm"
                aria-pressed={active}
                style={
                  active
                    ? {
                        background: "var(--accent-soft)",
                        color: "var(--accent-ink)",
                        borderColor: "transparent",
                        fontWeight: 600,
                        textDecoration: "none",
                      }
                    : { textDecoration: "none" }
                }
              >
                {r.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Chart card */}
      <section style={{ marginBottom: 22 }}>
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Zmiana od startu okresu</h2>
          {comparison.series.length >= 1 ? (
            <>
              <ComparisonChart series={comparison.series} />
              <ComparisonChartLegend series={comparison.series} />
            </>
          ) : (
            <div className="muted text-sm">Za mało danych, aby wykreślić porównanie.</div>
          )}
        </div>
      </section>

      {/* Raw start→now values per exercise */}
      {comparison.series.length >= 1 && (
        <div className="card" style={{ padding: "12px 16px", marginBottom: 16 }}>
          <div className="k" style={{ marginBottom: 8 }}>
            Konkretnie w tym okresie
          </div>
          <div className="col" style={{ gap: 4 }}>
            {comparison.series.map((s) => {
              const pct =
                s.startValue === 0 ? null : Math.round((s.endValue / s.startValue - 1) * 100);
              const u = s.unit === "SEC" ? " s" : "";
              const color =
                pct == null
                  ? "var(--muted)"
                  : pct > 0
                    ? "var(--ok)"
                    : pct < 0
                      ? "var(--danger)"
                      : "var(--muted)";
              return (
                <div key={s.exerciseId} className="row between" style={{ fontSize: 13 }}>
                  <span>{s.name}</span>
                  <span className="muted">
                    {s.startValue}
                    {u} → {s.endValue}
                    {u}{" "}
                    <b className="mono" style={{ color }}>
                      {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
                    </b>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Skipped exercises note */}
      {comparison.skipped.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="k" style={{ marginBottom: 8 }}>
            Pominięte
          </div>
          <ul className="text-xs muted" style={{ margin: 0, paddingLeft: 18 }}>
            {comparison.skipped.map((s) => (
              // `name` jest `null` przy `NO_DATA` (cudze albo nieistniejące ma być
              // nieodróżnialne) — wtedy, jak dotąd, pokazujemy identyfikator z adresu.
              <li key={s.exerciseId}>
                {s.name ?? s.exerciseId}: {comparisonSkipReasonLabel(s.reason)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
