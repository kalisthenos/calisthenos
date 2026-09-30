import { Link } from "react-router";
import { Icons } from "~/components/icons";
import { type BarSegment, SegmentedBar, SegmentedBarLegend } from "~/components/stat-widgets";
import { daysAgo } from "~/lib/format";
// Kształty przeglądu klienta przychodzą z kontraktu (`stats.ts` je re-eksportuje).
// Karta mapy aktywności zniknęła stąd razem z `getActivityHeatmap` — mapy nie ma
// w `TraineeOverviewView` (luka L S5-1), a wersja z pulpitu podopiecznego żyje
// w `trainee-stats.tsx`.
import type {
  ActivePlanUsageView,
  BodyPhotoCoverageView,
  HealthView,
  PlateauItemView,
  TagShareView,
  VideoCoverageView,
} from "~/lib/stats";

// ============================================================
// Local helpers
// ============================================================

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div className="row between" style={{ alignItems: "baseline", marginBottom: 12 }}>
        <h2 style={{ fontSize: 17 }}>{title}</h2>
        {icon != null && <span style={{ color: "var(--muted)" }}>{icon}</span>}
      </div>
      {children}
    </section>
  );
}

function trendArrow(trend: HealthView["rpeTrend"]): string {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  return "→";
}

function isoFromDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ============================================================
// HealthTilesCard
// ============================================================

function Tile({
  label,
  valueLine,
  sub,
  tone,
}: {
  label: string;
  valueLine: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.1,
          color: tone,
        }}
      >
        {valueLine}
      </div>
      <div className="text-xs muted" style={{ marginTop: 6 }}>
        {sub}
      </div>
    </div>
  );
}

export function HealthTilesCard({ health }: { health: HealthView }) {
  const activityTone =
    health.daysSinceLastSession == null
      ? "var(--muted)"
      : health.daysSinceLastSession <= 7 && health.sessionsLast7 >= 2
        ? "var(--ok)"
        : health.daysSinceLastSession <= 14
          ? "var(--warn)"
          : "var(--danger)";

  const rpeTone =
    health.rpeTrend === "up"
      ? "var(--danger)"
      : health.rpeTrend === "down"
        ? "var(--ok)"
        : "var(--muted)";

  const redTone =
    health.redZonePct > 40
      ? "var(--danger)"
      : health.redZonePct < 5 && health.hasAnyLog30d
        ? "var(--warn)"
        : "var(--ink)";

  const adTone = health.allDonePct < 70 && health.hasAnyLog30d ? "var(--warn)" : "var(--ink)";

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 14,
        marginBottom: 28,
      }}
    >
      <Tile
        label="Aktywność"
        valueLine={
          health.daysSinceLastSession == null
            ? "brak sesji"
            : daysAgo(isoFromDaysAgo(health.daysSinceLastSession))
        }
        sub={
          health.avgIntervalDays != null
            ? `7d: ${health.sessionsLast7} · 30d: ${health.sessionsLast30} · co ~${health.avgIntervalDays} dni`
            : `7d: ${health.sessionsLast7} · 30d: ${health.sessionsLast30}`
        }
        tone={activityTone}
      />
      <Tile
        label="Średnie RPE"
        valueLine={health.recentAvgRpe === 0 ? "—" : `${health.recentAvgRpe}/10`}
        sub={
          health.historicalAvgRpe === 0
            ? "ostatnich 5 sesji"
            : `vs ${health.historicalAvgRpe} historycznie ${trendArrow(health.rpeTrend)}`
        }
        tone={rpeTone}
      />
      <Tile
        label="Czerwona strefa"
        valueLine={health.hasAnyLog30d ? `${health.redZonePct}%` : "—"}
        sub={
          !health.hasAnyLog30d
            ? "brak sesji w 30 dni"
            : health.redZonePct > 40
              ? "plan może być za ostry"
              : health.redZonePct < 5
                ? "plan może być za lekki"
                : "RPE 9–10, 30 dni"
        }
        tone={redTone}
      />
      <Tile
        label="Ukończone w całości"
        valueLine={health.hasAnyLog30d ? `${health.allDonePct}%` : "—"}
        sub={health.hasAnyLog30d ? "sesji w 30 dni" : "brak sesji w 30 dni"}
        tone={adTone}
      />
    </div>
  );
}

// ============================================================
// PlateauCard
// ============================================================

export function PlateauCard({ plateau }: { plateau: PlateauItemView[] }) {
  if (plateau.length === 0) return null;
  return (
    <Section title="Plateau — uważne oko" icon={<Icons.Sparkle />}>
      <div className="card" style={{ padding: 14 }}>
        <div className="text-xs muted" style={{ marginBottom: 10 }}>
          Powtórzenia stoją w miejscu, a RPE nie spada — kandydaci do regresji lub zmiany wariantu.
        </div>
        <div className="col" style={{ gap: 8 }}>
          {plateau.map((p) => (
            <div
              key={p.exerciseId}
              className="row between"
              style={{
                gap: 10,
                padding: "8px 12px",
                background: "var(--surface)",
                border: "1px solid var(--warn)",
                borderRadius: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</div>
                <div className="text-xs muted" style={{ marginTop: 2 }}>
                  {p.sessionsConsidered} sesji obserwacji · PR <span className="mono">{p.pr}</span>{" "}
                  · {p.unit}
                </div>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <div style={{ textAlign: "right" }}>
                  {/*
                    Kontrakt oddaje `recentBest` — NAJLEPSZY wynik z okna obserwacji,
                    nie średnią, którą liczył dawny `getPlateauExercises`. Etykieta
                    idzie za nim, żeby liczba nie kłamała o tym, czym jest.
                  */}
                  <div className="mono muted text-xs">ost. best</div>
                  <div className="mono" style={{ fontWeight: 600 }}>
                    {p.recentBest}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono muted text-xs">śr. RPE</div>
                  <div className="mono" style={{ fontWeight: 600, color: "var(--warn)" }}>
                    {p.recentAvgRpe}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ============================================================
// PlanUsageCard
// ============================================================

function PlanRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="row between" style={{ fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span className="mono" style={{ fontWeight: 600 }}>
        {value.toLocaleString("pl-PL")}
      </span>
    </div>
  );
}

export function PlanUsageCard({ plan }: { plan: ActivePlanUsageView | null }) {
  if (plan == null) return null;
  // Liczba sesji odbytych na planie nie ma osobnego pola: `PlanTotals` niesie
  // wyłącznie serie, powtórzenia i sekundy (luka L S5-3). Sumujemy `doneCount`
  // z tej samej odpowiedzi — bez dodatkowego żądania i bez zmyślania danych.
  const sessionsDone = plan.sessions.reduce((sum, s) => sum + s.doneCount, 0);
  return (
    <Section title={`Aktywny plan — ${plan.name}`} icon={<Icons.Plans />}>
      <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            Wykorzystanie sesji
          </div>
          {plan.sessions.length === 0 ? (
            <div className="text-xs muted">Plan bez sesji.</div>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              {plan.sessions.map((s) => (
                <div key={s.sessionId} className="row" style={{ gap: 10, alignItems: "center" }}>
                  <span
                    className="mono muted"
                    style={{ fontSize: 11, width: 24, textAlign: "right" }}
                  >
                    #{String(s.ordinal + 1).padStart(2, "0")}
                  </span>
                  <div style={{ flex: 1, fontSize: 13 }}>{s.name}</div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: s.doneCount === 0 ? "var(--muted)" : "var(--ink)",
                    }}
                  >
                    ×{s.doneCount}
                  </span>
                  <span className="mono text-xs muted" style={{ minWidth: 80, textAlign: "right" }}>
                    {s.lastPerformedOn ? daysAgo(s.lastPerformedOn) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            Łącznie na tym planie
          </div>
          <div className="col" style={{ gap: 6 }}>
            <PlanRow label="Sesji" value={sessionsDone} />
            <PlanRow label="Serii" value={plan.totals.sets} />
            <PlanRow label="Powtórzeń" value={plan.totals.reps} />
            {plan.totals.seconds > 0 && (
              <PlanRow label="Sekund pod tension" value={plan.totals.seconds} />
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ============================================================
// CoverageCard
// ============================================================

function ViewChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className="badge"
      style={{
        background: on ? "var(--accent-soft)" : "var(--surface-2)",
        color: on ? "var(--accent-ink)" : "var(--muted)",
        borderColor: "transparent",
      }}
    >
      {on ? <Icons.Check /> : <Icons.X />} {label}
    </span>
  );
}

export function CoverageCard({
  video,
  photos,
  traineeId,
}: {
  video: VideoCoverageView;
  photos: BodyPhotoCoverageView;
  traineeId: string;
}) {
  return (
    <Section title="Coverage" icon={<Icons.Camera />}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "var(--muted)",
              marginBottom: 6,
            }}
          >
            Wideo serii (30 dni)
          </div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
            {video.total === 0 ? "—" : `${video.pct}%`}
          </div>
          <div className="text-xs muted" style={{ marginTop: 4 }}>
            {video.total === 0
              ? "brak serii w 30 dni"
              : `${video.withVideo} z ${video.total} serii z nagraniem`}
          </div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="row between" style={{ alignItems: "flex-start", marginBottom: 6 }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                color: "var(--muted)",
              }}
            >
              Sylwetka
            </div>
            <Link
              to={`/trener/podopieczni/${traineeId}/sylwetka`}
              className="text-xs"
              style={{ color: "var(--muted)" }}
            >
              Zobacz <Icons.Chev />
            </Link>
          </div>
          {/*
            `shared` czytane PIERWSZE (ADR-0047 BE): bez zgody na dane o zdrowiu pozostałe
            pola są neutralne — `0` i trzy „brak ujęcia" — i NIE znaczą „zero zdjęć".
          */}
          {photos.shared ? (
            <>
              <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                {photos.daysSinceLast == null ? "—" : daysAgo(isoFromDaysAgo(photos.daysSinceLast))}
              </div>
              <div className="text-xs muted" style={{ marginTop: 4 }}>
                ostatnie zdjęcie · {photos.totalPhotos} łącznie
              </div>
              <div className="row" style={{ gap: 6, marginTop: 10 }}>
                <ViewChip label="Przód" on={photos.views.front} />
                <ViewChip label="Bok" on={photos.views.side} />
                <ViewChip label="Tył" on={photos.views.back} />
              </div>
            </>
          ) : (
            <>
              <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                —
              </div>
              <div className="text-xs muted" style={{ marginTop: 4 }}>
                podopieczny nie udostępnia zdjęć
              </div>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

// ============================================================
// TagDistributionCard
// ============================================================

export function TagDistributionCard({
  shares,
  untagged,
  total,
}: {
  shares: TagShareView[];
  untagged: number;
  total: number;
}) {
  if (total === 0) return null;
  const PALETTE = ["var(--accent)", "var(--ok)", "var(--warn)", "var(--danger)", "var(--muted)"];
  const segments: BarSegment[] = shares.map((s, i) => ({
    label: s.tag,
    value: s.count,
    color: PALETTE[i % PALETTE.length]!,
  }));
  if (untagged > 0) {
    segments.push({
      label: "bez kategorii",
      value: untagged,
      color: "var(--surface-2)",
    });
  }
  return (
    <Section title="Rozkład kategorii (30 dni)" icon={<Icons.Filter />}>
      <div className="card" style={{ padding: 14 }}>
        {shares.length === 0 && untagged > 0 ? (
          <div className="text-xs muted">
            Ćwiczenia bez tagów — dodaj kategorie w bibliotece, by zobaczyć balans.
          </div>
        ) : (
          <>
            <SegmentedBar segments={segments} height={12} />
            <SegmentedBarLegend segments={segments} />
          </>
        )}
      </div>
    </Section>
  );
}
