import { useCallback, useEffect, useState } from "react";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { Icons } from "~/components/icons";
import { requireUser } from "~/lib/api/auth";
import { fmtDate } from "~/lib/format";
import { hasPendingOnboarding } from "~/lib/onboarding-forms";
import {
  describeArchetype,
  isPastMonth,
  loadWrappedSummary,
  parseYM,
  type Archetype,
  type WrappedPrItem,
  type WrappedSummaryView,
} from "~/lib/wrapped";

// ============================================================
// Loader: validates that the requested month is in the past and has data;
// returns the full wrapped summary used to render the card sequence.
// ============================================================

export async function loader(args: LoaderFunctionArgs) {
  const { api, user } = requireUser(args.context, { role: "trainee" });

  // Wrapped żyje poza layoutem, więc bramka formularza musi tu stać osobno.
  // Jawnie, przez kontrakt (`GET /v1/me/onboarding-form`
  // jest na białej liście bramki BE): do fali 2 ta trasa nie woła żadnej innej
  // trasy kontraktu, która odpaliłaby bramkę globalną `403 ONBOARDING_FORM_PENDING`.
  if (await hasPendingOnboarding(api)) throw redirect("/podopieczny/formularz");

  const ym = args.params.ym ?? "";
  const parsed = parseYM(ym);
  if (!parsed) throw new Response("invalid month", { status: 404 });
  if (!isPastMonth(parsed.year, parsed.month)) {
    throw new Response("month not yet closed", { status: 404 });
  }
  // Całą arytmetykę miesiąca liczy BE. Miesiąc bez ani jednego treningu to po
  // tamtej stronie `404` (`docs/04`: „`404`, gdy brak danych"), tu `null` —
  // dawna flaga `hasData` nie ma już czego opisywać.
  const summary = await loadWrappedSummary(api, ym);
  if (!summary) {
    throw new Response("no data", { status: 404 });
  }
  return { user, summary };
}

// ============================================================
// Page wrapper: dark full-screen, escapes the sidenav layout entirely.
// ============================================================

export default function WrappedPage() {
  const { user, summary } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = useCallback(() => navigate("/podopieczny"), [navigate]);

  // Mark this wrapped as viewed in localStorage so the dashboard banner stops
  // nagging. Runs once per ym.
  useEffect(() => {
    try {
      localStorage.setItem(`wrapped-viewed-${summary.ym}`, "1");
    } catch {
      // localStorage can be disabled — harmless.
    }
  }, [summary.ym]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "radial-gradient(ellipse at top, #1b2030 0%, var(--ink) 60%)",
        color: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      <CardDeck
        summary={summary}
        firstName={user.displayName.split(" ")[0] ?? user.displayName}
        onClose={onClose}
      />
    </div>
  );
}

// ============================================================
// Card deck — manages current index, transitions, keyboard input.
// ============================================================

function CardDeck({
  summary,
  firstName,
  onClose,
}: {
  summary: WrappedSummaryView;
  firstName: string;
  onClose: () => void;
}) {
  const cards = buildCards(summary, firstName);
  const [index, setIndex] = useState(0);
  const current = cards[index]!;
  const isLast = index === cards.length - 1;
  const cardCount = cards.length;

  // Functional updates so the callbacks don't need to capture `index` — keeps
  // the keydown listener stable across re-renders.
  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= cardCount - 1) {
        onClose();
        return i;
      }
      return i + 1;
    });
  }, [cardCount, onClose]);
  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Keyboard nav (desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, onClose]);

  // Touch zones: left third → previous, right two-thirds → next.
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) goPrev();
    else goNext();
  };

  return (
    <>
      {/* Progress bar at top — one segment per card */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "14px 16px 0",
          flexShrink: 0,
        }}
      >
        {cards.map((c, i) => (
          <div
            key={c.key}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background:
                i < index
                  ? "var(--accent)"
                  : i === index
                    ? "rgba(199, 242, 60, 0.55)"
                    : "rgba(255, 255, 255, 0.15)",
              transition: "background .2s ease",
            }}
          />
        ))}
      </div>

      {/* Top chrome: month label + close */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px 0",
          flexShrink: 0,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: ".12em",
            color: "rgba(255,255,255,.6)",
          }}
        >
          Wrapped · {summary.label}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij"
          style={{
            background: "rgba(255,255,255,.08)",
            color: "var(--bg)",
            border: 0,
            width: 32,
            height: 32,
            borderRadius: "50%",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icons.X />
        </button>
      </div>

      {/* Card content area — clickable for advance */}
      <button
        type="button"
        onClick={handleClick}
        aria-label="Następna karta"
        style={{
          flex: 1,
          background: "transparent",
          border: 0,
          color: "inherit",
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          cursor: "pointer",
          minHeight: 0,
          font: "inherit",
        }}
      >
        <CardView card={current} keyForAnim={current.key} />
      </button>

      {/* Bottom CTA on last card: share */}
      {isLast && <ShareBar summary={summary} firstName={firstName} />}
    </>
  );
}

// ============================================================
// Card definitions
// ============================================================

type Card =
  | { key: "intro"; kind: "intro"; firstName: string; label: string; sessions: number }
  | {
      key: "volume";
      kind: "volume";
      totalReps: number;
      totalSeconds: number;
      totalSets: number;
    }
  | {
      key: "top";
      kind: "top";
      top: NonNullable<WrappedSummaryView["topExercise"]>;
    }
  | { key: "top-empty"; kind: "top-empty" }
  | { key: "prs"; kind: "prs"; prs: WrappedPrItem[] }
  | {
      key: "heaviest";
      kind: "heaviest";
      day: NonNullable<WrappedSummaryView["heaviestDay"]>;
    }
  | { key: "archetype"; kind: "archetype"; archetype: Archetype }
  | {
      key: "vs-prev";
      kind: "vs-prev";
      vs: WrappedSummaryView["vsPrevious"];
    }
  | { key: "closing"; kind: "closing"; label: string };

function buildCards(s: WrappedSummaryView, firstName: string): Card[] {
  const cards: Card[] = [];
  cards.push({ key: "intro", kind: "intro", firstName, label: s.label, sessions: s.sessions });
  cards.push({
    key: "volume",
    kind: "volume",
    totalReps: s.totalReps,
    totalSeconds: s.totalSeconds,
    totalSets: s.totalSets,
  });
  if (s.topExercise) {
    cards.push({ key: "top", kind: "top", top: s.topExercise });
  } else {
    cards.push({ key: "top-empty", kind: "top-empty" });
  }
  cards.push({ key: "prs", kind: "prs", prs: s.prs });
  if (s.heaviestDay) {
    cards.push({ key: "heaviest", kind: "heaviest", day: s.heaviestDay });
  }
  // Kontrakt oddaje `key` i `emoji`; nazwa i opis po polsku (z liczbami z tej
  // samej odpowiedzi) są prezentacją i liczy je moduł.
  cards.push({ key: "archetype", kind: "archetype", archetype: describeArchetype(s) });
  cards.push({ key: "vs-prev", kind: "vs-prev", vs: s.vsPrevious });
  cards.push({ key: "closing", kind: "closing", label: s.label });
  return cards;
}

// ============================================================
// CardView — animation wrapper + per-kind renderer.
// ============================================================

function CardView({ card, keyForAnim }: { card: Card; keyForAnim: string }) {
  // Re-key forces remount, which retriggers the fade-in animation.
  return (
    <div
      key={keyForAnim}
      style={{
        width: "100%",
        maxWidth: 520,
        animation: "wrappedFadeIn 350ms ease forwards",
      }}
    >
      <style>{KEYFRAMES_CSS}</style>
      <RenderCard card={card} />
    </div>
  );
}

const KEYFRAMES_CSS = `
@keyframes wrappedFadeIn {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes wrappedPop {
  0% { opacity: 0; transform: scale(0.85); }
  60% { opacity: 1; transform: scale(1.06); }
  100% { transform: scale(1); }
}
`;

function RenderCard({ card }: { card: Card }) {
  switch (card.kind) {
    case "intro":
      return <IntroCard firstName={card.firstName} label={card.label} sessions={card.sessions} />;
    case "volume":
      return (
        <VolumeCard
          totalReps={card.totalReps}
          totalSeconds={card.totalSeconds}
          totalSets={card.totalSets}
        />
      );
    case "top":
      return <TopExerciseCard top={card.top} />;
    case "top-empty":
      return <TopEmptyCard />;
    case "prs":
      return <PRsCard prs={card.prs} />;
    case "heaviest":
      return <HeaviestCard day={card.day} />;
    case "archetype":
      return <ArchetypeCard archetype={card.archetype} />;
    case "vs-prev":
      return <VsPrevCard vs={card.vs} />;
    case "closing":
      return <ClosingCard label={card.label} />;
  }
}

// ============================================================
// Individual cards
// ============================================================

const EYEBROW: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  opacity: 0.6,
  marginBottom: 18,
};

const HUGE: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: "clamp(64px, 18vw, 132px)",
  lineHeight: 0.95,
  letterSpacing: "-0.04em",
  color: "var(--accent)",
};

const BIG: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: "clamp(40px, 10vw, 72px)",
  lineHeight: 1.05,
  letterSpacing: "-0.02em",
};

const HEAD: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: "clamp(24px, 5vw, 32px)",
  lineHeight: 1.2,
  letterSpacing: "-0.01em",
};

const SUB: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.5,
  opacity: 0.75,
  marginTop: 18,
};

function IntroCard({
  firstName,
  label,
  sessions,
}: {
  firstName: string;
  label: string;
  sessions: number;
}) {
  return (
    <div>
      <div style={EYEBROW}>Twój miesiąc</div>
      <div style={HEAD}>Cześć, {firstName}.</div>
      <div style={{ ...HUGE, marginTop: 20 }}>{label.split(" ")[0]}</div>
      <div style={{ ...SUB, marginTop: 8 }}>
        Zrobiłeś <strong style={{ color: "var(--accent)" }}>{sessions}</strong>{" "}
        {pl(sessions, "sesję", "sesje", "sesji")}. Przewijaj dalej.
      </div>
    </div>
  );
}

function VolumeCard({
  totalReps,
  totalSeconds,
  totalSets,
}: {
  totalReps: number;
  totalSeconds: number;
  totalSets: number;
}) {
  const hero = totalReps >= totalSeconds ? totalReps : totalSeconds;
  const heroLabel = totalReps >= totalSeconds ? "powtórzeń" : "sekund pod tension";
  return (
    <div>
      <div style={EYEBROW}>Twoja praca</div>
      <CountUp value={hero} style={HUGE} />
      <div style={HEAD}>{heroLabel}</div>
      <div style={SUB}>
        Plus <strong>{totalSets.toLocaleString("pl-PL")}</strong> serii.
        {totalReps > 0 && totalSeconds > 0 && (
          <>
            {" "}
            Dla równowagi:{" "}
            <strong>
              {hero === totalReps
                ? `${totalSeconds.toLocaleString("pl-PL")} sek.`
                : `${totalReps.toLocaleString("pl-PL")} powt.`}
            </strong>
          </>
        )}
      </div>
    </div>
  );
}

function TopExerciseCard({
  top,
}: {
  top: NonNullable<WrappedSummaryView["topExercise"]>;
}) {
  return (
    <div>
      <div style={EYEBROW}>Twoje numer jeden</div>
      <div style={HEAD}>Najczęściej robiłeś</div>
      <div
        style={{
          ...BIG,
          color: "var(--accent)",
          marginTop: 16,
          marginBottom: 8,
          wordBreak: "break-word",
        }}
      >
        {top.exerciseName}
      </div>
      <div style={SUB}>
        W <strong>{top.sessionsInvolved}</strong>{" "}
        {pl(top.sessionsInvolved, "sesji", "sesjach", "sesjach")} ({top.pctOfSessions}% wszystkich).
        Jednostka: <span className="mono">{top.unit}</span>.
      </div>
    </div>
  );
}

function TopEmptyCard() {
  return (
    <div>
      <div style={EYEBROW}>Twoje numer jeden</div>
      <div style={HEAD}>Bez wyraźnego faworyta</div>
      <div style={SUB}>Rozłożyłeś wysiłek równo. Trener byłby z Ciebie dumny.</div>
    </div>
  );
}

function PRsCard({ prs }: { prs: WrappedPrItem[] }) {
  if (prs.length === 0) {
    return (
      <div>
        <div style={EYEBROW}>Rekordy</div>
        <div style={HEAD}>Tym razem bez PR.</div>
        <div style={SUB}>Nie każdy miesiąc musi pobić rekord. Konsystencja to też wynik.</div>
      </div>
    );
  }
  const top = prs[0]!;
  return (
    <div>
      <div style={EYEBROW}>Rekordy</div>
      <div style={HEAD}>Pobiłeś</div>
      <div
        style={{
          ...HUGE,
          fontSize: "clamp(72px, 22vw, 156px)",
          marginTop: 10,
          marginBottom: 6,
        }}
      >
        {prs.length}
      </div>
      <div style={HEAD}>{pl(prs.length, "nowy rekord", "nowe rekordy", "nowych rekordów")}.</div>
      <div style={{ ...SUB, marginTop: 20 }}>
        Najmocniej: <strong style={{ color: "var(--accent)" }}>{top.exerciseName}</strong> —{" "}
        <span className="mono">{top.reps}</span> {top.unit === "SEC" ? "sek." : "powt."}
        {top.previousBest > 0 && (
          <>
            {" "}
            <span className="mono" style={{ opacity: 0.55 }}>
              (poprz. {top.previousBest})
            </span>
          </>
        )}
      </div>
      {prs.length > 1 && (
        <div
          className="text-xs mono"
          style={{
            opacity: 0.55,
            marginTop: 14,
            textAlign: "left",
            maxHeight: 90,
            overflow: "hidden",
          }}
        >
          {prs
            .slice(1, 5)
            .map((p) => `${p.exerciseName} · ${p.reps}${p.unit === "SEC" ? "s" : ""}`)
            .join(" · ")}
          {prs.length > 5 && ` · +${prs.length - 5}`}
        </div>
      )}
    </div>
  );
}

function HeaviestCard({
  day,
}: {
  day: NonNullable<WrappedSummaryView["heaviestDay"]>;
}) {
  return (
    <div>
      <div style={EYEBROW}>Najmocniejszy dzień</div>
      <div style={HEAD}>{fmtDate(day.date)}</div>
      <div
        style={{
          ...BIG,
          color: "var(--accent)",
          marginTop: 16,
          marginBottom: 4,
          wordBreak: "break-word",
        }}
      >
        {day.sessionName}
      </div>
      <div style={SUB}>
        <strong>{day.totalReps.toLocaleString("pl-PL")}</strong> powt. /{" "}
        <strong>{day.setCount}</strong> {pl(day.setCount, "seria", "serie", "serii")}
        {day.avgRpe != null && (
          <>
            {" "}
            · śr. RPE <strong>{day.avgRpe}</strong>/10
          </>
        )}
      </div>
    </div>
  );
}

function ArchetypeCard({ archetype }: { archetype: Archetype }) {
  return (
    <div>
      <div style={EYEBROW}>Twój typ trenującego</div>
      <div
        style={{
          fontSize: "clamp(72px, 18vw, 120px)",
          lineHeight: 1,
          marginBottom: 14,
          animation: "wrappedPop 600ms ease forwards",
        }}
      >
        {archetype.emoji}
      </div>
      <div style={{ ...HUGE, fontSize: "clamp(40px, 12vw, 84px)", color: "var(--accent)" }}>
        {archetype.label}
      </div>
      <div style={SUB}>{archetype.description}</div>
    </div>
  );
}

function VsPrevCard({ vs }: { vs: WrappedSummaryView["vsPrevious"] }) {
  if (!vs.hasPrevious) {
    return (
      <div>
        <div style={EYEBROW}>Porównanie</div>
        <div style={HEAD}>Twój pierwszy miesiąc.</div>
        <div style={SUB}>Następny wrapped pokaże, czy idziesz w górę. Dasz radę.</div>
      </div>
    );
  }
  return (
    <div>
      <div style={EYEBROW}>Vs poprzedni miesiąc</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          marginTop: 14,
          marginBottom: 12,
        }}
      >
        <DeltaStat
          label="Sesji"
          value={`${vs.sessionsThis}`}
          delta={vs.sessionsDelta}
          deltaText={
            vs.sessionsDelta === 0
              ? "tyle co poprz."
              : `${vs.sessionsDelta > 0 ? "+" : ""}${vs.sessionsDelta} vs ${vs.sessionsPrev}`
          }
        />
        <DeltaStat
          label="Powtórzeń"
          value={vs.repsThis.toLocaleString("pl-PL")}
          delta={vs.repsDeltaPct ?? 0}
          deltaText={
            vs.repsDeltaPct == null
              ? "—"
              : vs.repsDeltaPct === 0
                ? "tyle co poprz."
                : `${vs.repsDeltaPct > 0 ? "+" : ""}${vs.repsDeltaPct}% vs poprz.`
          }
        />
      </div>
      {vs.avgRpeThis != null && vs.rpeDelta != null && vs.rpeDelta !== 0 && (
        <div style={{ ...SUB, marginTop: 8 }}>
          Średnie RPE:{" "}
          <strong>
            {vs.avgRpeThis}/10
            <span style={{ color: vs.rpeDelta > 0 ? "var(--danger)" : "var(--ok)" }}>
              {" "}
              ({vs.rpeDelta > 0 ? "+" : ""}
              {vs.rpeDelta})
            </span>
          </strong>
        </div>
      )}
    </div>
  );
}

function DeltaStat({
  label,
  value,
  delta,
  deltaText,
}: {
  label: string;
  value: string;
  delta: number;
  deltaText: string;
}) {
  const tone = delta > 0 ? "var(--accent)" : delta < 0 ? "var(--danger)" : "rgba(255,255,255,.6)";
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: ".1em",
          opacity: 0.55,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 38,
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div className="mono" style={{ fontSize: 11, marginTop: 6, color: tone }}>
        {deltaText}
      </div>
    </div>
  );
}

function ClosingCard({ label }: { label: string }) {
  return (
    <div>
      <div style={EYEBROW}>To był</div>
      <div style={{ ...HUGE, color: "var(--accent)" }}>{label.split(" ")[0]}</div>
      <div style={HEAD}>Do zobaczenia w następnym miesiącu.</div>
      <div style={SUB}>Twoja historia rośnie z każdym treningiem. Trzymaj rytm.</div>
    </div>
  );
}

// ============================================================
// CountUp — animowany licznik dla dużych liczb
// ============================================================

function CountUp({ value, style }: { value: number; style: React.CSSProperties }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const duration = 900;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic.
      const eased = 1 - (1 - t) ** 3;
      setCurrent(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <div style={style}>{current.toLocaleString("pl-PL")}</div>;
}

// ============================================================
// ShareBar — last-card CTA
// ============================================================

function ShareBar({
  summary,
  firstName,
}: {
  summary: WrappedSummaryView;
  firstName: string;
}) {
  const [copied, setCopied] = useState(false);

  const shareText = buildShareText(summary, firstName);

  const onShare = async () => {
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ text: shareText });
        return;
      }
    } catch {
      // user canceled or share failed → fall through to copy
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // last resort: nothing we can do without UI clutter
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "16px 20px 24px",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <button type="button" onClick={onShare} className="btn btn-primary" style={{ minWidth: 160 }}>
        <Icons.Upload /> {copied ? "Skopiowano!" : "Udostępnij"}
      </button>
      <Link
        to="/podopieczny"
        className="btn"
        style={{
          background: "rgba(255,255,255,.08)",
          color: "var(--bg)",
          borderColor: "rgba(255,255,255,.15)",
        }}
      >
        Zamknij
      </Link>
    </div>
  );
}

function buildShareText(s: WrappedSummaryView, firstName: string): string {
  const archetype = describeArchetype(s);
  const parts = [`${firstName} · ${s.label} w kalisthenos:`, `${s.sessions} sesji`];
  if (s.totalReps > 0) parts.push(`${s.totalReps.toLocaleString("pl-PL")} powt.`);
  if (s.totalSeconds > 0) parts.push(`${s.totalSeconds.toLocaleString("pl-PL")} sek.`);
  if (s.prs.length > 0) parts.push(`${s.prs.length} nowych rekordów`);
  parts.push(`Typ: ${archetype.label} ${archetype.emoji}`);
  return parts.join(" · ");
}

// ============================================================
// Pluralization mini-helper local to this file
// ============================================================

function pl(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 12 && lastTwo <= 14) return many;
  if (last >= 2 && last <= 4) return few;
  return many;
}
