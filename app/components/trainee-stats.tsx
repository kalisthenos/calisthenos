import type {
  TraineeEffortView,
  TraineeHeroView,
  TraineeThisWeekView,
} from "@kalisthenos/api-client";
import { Link } from "react-router";
import { Icons } from "~/components/icons";
import {
  type BarSegment,
  Heatmap,
  SegmentedBar,
  SegmentedBarLegend,
} from "~/components/stat-widgets";
import { type PlForms, fmtDate, pluralizePl } from "~/lib/format";
import type { HeatmapDay } from "~/lib/stats";

// ============================================================
// Local helpers
// ============================================================

const SESJA: PlForms = { one: "sesja", few: "sesje", many: "sesji" };
const TYDZIEN: PlForms = { one: "tydzień", few: "tygodnie", many: "tygodni" };
const POWT: PlForms = { one: "powtórzenie", few: "powtórzenia", many: "powtórzeń" };

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

// ============================================================
// HeroStatsCard
// ============================================================

function HeroStat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          opacity: 0.6,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          lineHeight: 1,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: accent ? "var(--accent)" : "var(--bg)",
        }}
      >
        {value}
      </div>
      <div className="mono" style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
        {suffix}
      </div>
    </div>
  );
}

export function HeroStatsCard({ hero }: { hero: TraineeHeroView }) {
  return (
    <div
      className="card"
      style={{
        marginBottom: 20,
        padding: 24,
        background: "var(--ink)",
        color: "var(--bg)",
        border: 0,
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
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 20,
          position: "relative",
        }}
      >
        <HeroStat
          label="Sesji łącznie"
          value={hero.totalSessions.toLocaleString("pl-PL")}
          suffix={pluralizePl(hero.totalSessions, SESJA)}
        />
        <HeroStat
          label="Streak"
          value={hero.streakWeeks.toString()}
          suffix={pluralizePl(hero.streakWeeks, TYDZIEN)}
          accent={hero.streakWeeks > 0}
        />
        <HeroStat
          label="Najdłuższy streak"
          value={hero.longestStreakWeeks.toString()}
          suffix={pluralizePl(hero.longestStreakWeeks, TYDZIEN)}
        />
        <HeroStat
          label="Dzień podróży"
          value={hero.journeyDayNumber === 0 ? "—" : `#${hero.journeyDayNumber}`}
          suffix={hero.firstSessionOn ? `od ${fmtDate(hero.firstSessionOn)}` : "od pierwszej sesji"}
        />
        <HeroStat
          label="Łączne powtórzenia"
          value={hero.totalReps.toLocaleString("pl-PL")}
          suffix={pluralizePl(hero.totalReps, POWT)}
        />
        <HeroStat
          label="Sekund pod tension"
          value={hero.totalSecondsUnderTension.toLocaleString("pl-PL")}
          suffix="ćwiczenia czasowe"
        />
      </div>
    </div>
  );
}

// ============================================================
// ThisWeekCard
// ============================================================

export function ThisWeekCard({ thisWeek }: { thisWeek: TraineeThisWeekView }) {
  const aboveAvg = thisWeek.sessions >= thisWeek.avgPerWeek;
  const message =
    thisWeek.avgPerWeek === 0
      ? `${thisWeek.sessions} ${pluralizePl(thisWeek.sessions, SESJA)} w tym tygodniu — dobry początek!`
      : aboveAvg
        ? `${thisWeek.sessions} ${pluralizePl(thisWeek.sessions, SESJA)} w tym tygodniu — twoja średnia to ${thisWeek.avgPerWeek}. ✓`
        : `${thisWeek.sessions} ${pluralizePl(thisWeek.sessions, SESJA)} w tym tygodniu — średnio robisz ${thisWeek.avgPerWeek}. Dasz radę nadrobić?`;

  return (
    <div
      className="card"
      style={{
        marginBottom: 22,
        padding: "16px 20px",
        borderLeft: `3px solid ${aboveAvg ? "var(--ok)" : "var(--accent)"}`,
      }}
    >
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
        Ten tydzień
      </div>
      <div style={{ fontSize: 14, color: "var(--ink)" }}>{message}</div>
    </div>
  );
}

// ============================================================
// ActivityHeatmapCard
// ============================================================

export function ActivityHeatmapCard({ days }: { days: HeatmapDay[] }) {
  return (
    <Section title="Twój rok" icon={<Icons.Calendar />}>
      <Heatmap days={days} />
      <div className="text-xs muted" style={{ marginTop: 8 }}>
        Każdy kwadrat to dzień. Im jaśniej, tym więcej sesji tego dnia.
      </div>
    </Section>
  );
}

// ============================================================
// EffortBalanceCard
// ============================================================

export function EffortBalanceCard({ effort }: { effort: TraineeEffortView }) {
  if (effort.total === 0) return null;

  const segments: BarSegment[] = [
    { label: "Lekkie (RPE ≤ 4)", value: effort.easy, color: "var(--ok)" },
    { label: "Umiarkowane (5-7)", value: effort.mid, color: "var(--accent)" },
    { label: "Ciężkie (≥ 8)", value: effort.hard, color: "var(--danger)" },
  ];

  const verdictMsg =
    effort.verdict === "balanced"
      ? "Trenujesz mądrze — różnorodność intensywności."
      : effort.verdict === "too-hard"
        ? "Większość sesji była ciężka. Może warto czasem zwolnić."
        : effort.verdict === "too-easy"
          ? "Większość sesji była lekka. Próbujesz przesunąć granicę?"
          : "";

  return (
    <Section title="Balans intensywności (30 dni)" icon={<Icons.Trend />}>
      <div className="card" style={{ padding: 18 }}>
        <SegmentedBar segments={segments} height={12} />
        <SegmentedBarLegend segments={segments} />
        {verdictMsg && (
          <div className="text-xs muted" style={{ marginTop: 10, fontStyle: "italic" }}>
            {verdictMsg}
          </div>
        )}
      </div>
    </Section>
  );
}

// ============================================================
// WrappedListRow
// ============================================================

export function WrappedListRow({
  months,
}: {
  months: Array<{ ym: string; label: string; sessions: number }>;
}) {
  if (months.length === 0) return null;
  return (
    <Section title="Twoje wrappedy" icon={<Icons.Sparkle />}>
      <div className="text-xs muted" style={{ marginBottom: 10 }}>
        Każdego 1. dnia miesiąca odblokowuje się retrospektywa poprzedniego.
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        {months.map((m, idx) => (
          <Link
            key={m.ym}
            to={`/podopieczny/wrapped/${m.ym}`}
            className="card card-hover"
            style={{
              padding: 14,
              textDecoration: "none",
              display: "block",
              background: idx === 0 ? "var(--ink)" : "var(--surface)",
              color: idx === 0 ? "var(--bg)" : "inherit",
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                opacity: idx === 0 ? 0.65 : 0.5,
                marginBottom: 6,
              }}
            >
              Wrapped
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
            <div className="text-xs" style={{ opacity: idx === 0 ? 0.7 : undefined }}>
              {m.sessions} {m.sessions === 1 ? "sesja" : "sesji"}
            </div>
          </Link>
        ))}
      </div>
    </Section>
  );
}
