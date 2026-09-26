import { useState } from "react";
import { Link } from "react-router";
import { Icons } from "~/components/icons";
import {
  DEFAULT_METRICS,
  type PyramidBandBox,
  VIEW_W,
  buildPyramid,
  layoutPyramid,
  orderAndPlace,
} from "~/lib/skill-pyramid";
import { edgePathD, routeEdges } from "~/lib/skill-pyramid-routing";
import { type SkillTier, TIER_LABEL, highestEarnedTier } from "~/lib/skill-tier";
import type { SkillTree, TreeNode } from "~/lib/skill-tree";
import type { NodeState } from "~/lib/skill-tree-math";

// ============================================================
// SkillTreeView — monument. Fundament (PODSTAWOWY) na dole, EKSPERT na szczycie;
// płyty warstw idą pełną szerokością planszy, a masę niosą: ciężar płyty, rzymski
// numer wykuty w jej rogu i atramentowy szczyt.
//
// Dwa kodowania na jednej karcie, na różnych warstwach:
//   • TIER → ciężar karty (płaski well → hairline → 1.5px → inwersja atramentowa)
//   • STAN → akcent (kropka stanu, pasek postępu)
// Lime jest zarezerwowany dla postępu podopiecznego — nigdy nie oznacza tieru.
//
// KIERUNEK ZALEŻNOŚCI
// -------------------
// Krawędź zawsze wychodzi z GÓRNEJ krawędzi prerekwizytu i wchodzi w DOLNĄ
// krawędź tego, co odblokowuje. Dlatego kierunek kodują dwa znaczniki na karcie:
// stopka na górze („z tego coś wyrasta") i grot na dole („tutaj wchodzą prereki").
// Znaczniki są elementami DOM, nie `<marker>` w SVG — oś X jest rozciągana, więc
// marker SVG byłby spłaszczony.
//
// MODEL WSPÓŁRZĘDNYCH
// -------------------
// Geometrię liczą czyste funkcje (`layoutPyramid`, `routeEdges`), testowane
// jednostkowo: oś X w jednostkach 0..VIEW_W (rozciągana na szerokość planszy),
// oś Y w px 1:1. Karty pozycjonowane absolutnie w procentach X i pikselach Y;
// SVG krawędzi ma viewBox 0 0 VIEW_W totalH z preserveAspectRatio="none".
// Końce łamanych trafiają w krawędzie kart przy każdej szerokości — bez pomiaru
// DOM, bez useEffect, bezpiecznie w SSR.
// ============================================================

/**
 * Ile razy szerzej od minimum wolno rozciągnąć planszę. Bez sufitu na szerokim
 * monitorze karty rozjeżdżają się w rzadką siatkę — `.pyramid-board { margin: 0 auto }`
 * dopiero z tym limitem ma co centrować.
 */
const BOARD_SLACK = 1.35;

/** Docelowy promień zakrętu krawędzi w pikselach (przeliczany na jednostki VIEW_W). */
const CORNER_PX = 13;
/** Rozstaw kolumn na desktopie z `tokens.css` — do przeliczenia promienia na jednostki osi X. */
const COL_PX = 280;

/** Rzymski numer warstwy — koduje kolejność tierów, którą i tak trzeba przeczytać. */
const TIER_ROMAN: Record<SkillTier, string> = {
  basic: "I",
  intermediate: "II",
  advanced: "III",
  expert: "IV",
};

const STATE_LABEL: Record<NodeState, string> = {
  mastered: "opanowane",
  in_progress: "w toku",
  available: "gotowe do startu",
  locked: "zablokowane",
};

/** Krótka etykieta na kartę — „gotowe do startu" nie mieści się na wąskiej karcie. */
const STATE_SHORT: Record<NodeState, string> = {
  mastered: "opanowane",
  in_progress: "w toku",
  available: "gotowe",
  locked: "zablokowane",
};

export function SkillTreeView({
  tree,
  hrefForNode,
}: {
  tree: SkillTree;
  /** Link docelowy drill-in (zależny od roli). */
  hrefForNode: (skillId: string) => string;
}): React.JSX.Element {
  // Podświetlenie sąsiedztwa: przy większym drzewie sama linia mówi „te dwie są
  // połączone", ale nie widać na raz, co dotyka konkretnej karty. SSR renderuje
  // wariant neutralny (null), a reguła CSS działa tylko tam, gdzie hover istnieje.
  // Hook przed wczesnym return — inaczej pusty stan zmieniłby liczbę hooków.
  const [hovered, setHovered] = useState<string | null>(null);

  if (tree.nodes.length === 0) {
    return (
      <div className="empty">
        <h3>Brak umiejętności w drzewie.</h3>
        <p className="muted text-sm" style={{ margin: 0 }}>
          Dodaj umiejętności i połącz je prerekwizytami, aby zobaczyć piramidę.
        </p>
      </div>
    );
  }

  const placement = orderAndPlace(
    buildPyramid(
      tree.nodes.map((n) => ({ id: n.skillId, name: n.name, tier: n.tier })),
      tree.edges,
    ),
    tree.edges,
    new Map(tree.nodes.map((n) => [n.skillId, n.name])),
  );
  const layout = layoutPyramid(placement, DEFAULT_METRICS);
  const routed = routeEdges(tree.edges, layout, DEFAULT_METRICS);

  const nodeById = new Map(tree.nodes.map((n) => [n.skillId, n]));
  const stateById = new Map(tree.nodes.map((n) => [n.skillId, n.state ?? "locked"]));

  // Znaczniki kierunku: stopkę dostaje węzeł, z którego coś wyrasta; grot ten,
  // który czegoś wymaga. Kolor grotu mówi, czy droga do niego jest już otwarta.
  const hasDependents = new Set(tree.edges.map((e) => e.requires));
  const prereqsBySkill = new Map<string, string[]>();
  for (const e of tree.edges) {
    const arr = prereqsBySkill.get(e.from) ?? [];
    arr.push(e.requires);
    prereqsBySkill.set(e.from, arr);
  }

  // Liczniki per pas — „4/6" na railu płyty.
  const countsByTier = new Map<SkillTier, { total: number; mastered: number }>();
  for (const n of tree.nodes) {
    const c = countsByTier.get(n.tier) ?? { total: 0, mastered: 0 };
    c.total += 1;
    if ((n.state ?? "locked") === "mastered") c.mastered += 1;
    countsByTier.set(n.tier, c);
  }

  // `layout.bands` idzie od góry planszy; opóźnienie animacji ma rosnąć OD DOŁU.
  const revealOf = (i: number) => layout.bands.length - 1 - i;

  const cols = layout.boardCols.toFixed(2);
  // Promień zakrętu: oś Y jest w pikselach, oś X rozciągana — dlatego osobno.
  const cornerX = (CORNER_PX / (COL_PX * layout.boardCols)) * VIEW_W;

  const topTier = highestEarnedTier(
    tree.nodes.map((n) => ({ tier: n.tier, mastered: (n.state ?? "locked") === "mastered" })),
  );
  const summitBand = topTier ? layout.bands.find((b) => b.tier === topTier) : undefined;

  return (
    <div className="col" style={{ gap: 18 }}>
      <PyramidProgress nodes={tree.nodes} />

      <div className="pyramid-scroll">
        <div
          className="pyramid-board"
          data-focus={hovered ? "1" : undefined}
          style={
            {
              height: layout.totalH,
              minWidth: `calc(var(--pyramid-col) * ${cols})`,
              maxWidth: `max(420px, var(--pyramid-col) * ${cols} * ${BOARD_SLACK})`,
              "--pyramid-card-h": `${DEFAULT_METRICS.cardH}px`,
            } as React.CSSProperties
          }
        >
          {layout.bands.map((box, i) => (
            <BandPlate
              key={box.tier}
              box={box}
              counts={countsByTier.get(box.tier) ?? { total: 0, mastered: 0 }}
              reveal={revealOf(i)}
            />
          ))}

          {summitBand && topTier ? (
            <div
              className="pyramid-summit"
              style={{ top: Math.max(0, summitBand.y - Math.round(DEFAULT_METRICS.bandGap / 2)) }}
            >
              <span className="pyramid-summit-tag mono">Twój szczyt · {TIER_LABEL[topTier]}</span>
            </div>
          ) : null}

          <svg
            className="pyramid-edges"
            viewBox={`0 0 ${VIEW_W} ${layout.totalH}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Połączenia prerekwizytów: linia biegnie od umiejętności wymaganej do tej, którą odblokowuje"
            style={
              {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: layout.totalH,
                pointerEvents: "none",
                zIndex: 1,
                // Krawędzie pojawiają się po wszystkich pasach.
                "--reveal": layout.bands.length,
              } as React.CSSProperties
            }
          >
            {routed.map((e) => {
              const live = stateById.get(e.requires) === "mastered";
              const stroke = e.reversed ? "var(--warn)" : live ? "var(--ok)" : "var(--line-2)";
              const dash = e.reversed ? "2 6" : live ? undefined : "5 6";
              return (
                <path
                  key={`${e.requires}->${e.from}`}
                  className="pyramid-edge"
                  data-dim={
                    hovered && hovered !== e.from && hovered !== e.requires ? "1" : undefined
                  }
                  d={edgePathD(e.points, cornerX, CORNER_PX)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={live ? 2 : 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={dash}
                  // Bez tego ta sama krawędź byłaby chudsza na wąskim ekranie i
                  // grubsza na szerokim, a kreski przerywane rozciągałyby się z nią.
                  vectorEffect="non-scaling-stroke"
                  opacity={live ? 0.95 : 0.8}
                />
              );
            })}
          </svg>

          {[...layout.centers].map(([skillId, c]) => {
            const node = nodeById.get(skillId);
            if (!node) return null;
            const bandIndex = layout.bands.findIndex((b) => b.tier === node.tier);
            const prereqs = prereqsBySkill.get(skillId) ?? [];
            return (
              <NodeCard
                key={skillId}
                node={node}
                href={hrefForNode(skillId)}
                x={c.x}
                y={c.y}
                reveal={revealOf(bandIndex < 0 ? 0 : bandIndex)}
                hasDependents={hasDependents.has(skillId)}
                prereqCount={prereqs.length}
                prereqsOpen={
                  prereqs.length > 0 && prereqs.every((p) => stateById.get(p) === "mastered")
                }
                onFocusChange={setHovered}
              />
            );
          })}
        </div>
      </div>

      <StateLegend />
    </div>
  );
}

// ============================================================
// PyramidProgress — nagłówek dumy: ile zdobyte, jak wysoko, ile w toku.
// ============================================================

function PyramidProgress({ nodes }: { nodes: TreeNode[] }) {
  const total = nodes.length;
  const mastered = nodes.filter((n) => (n.state ?? "locked") === "mastered").length;
  const inProgress = nodes.filter((n) => (n.state ?? "locked") === "in_progress").length;
  const top = highestEarnedTier(
    nodes.map((n) => ({ tier: n.tier, mastered: (n.state ?? "locked") === "mastered" })),
  );

  return (
    <div className="card row wrap" style={{ gap: 32, padding: 16 }}>
      <div className="stat">
        <div className="v mono">
          {mastered}/{total}
        </div>
        <div className="k">Opanowane</div>
      </div>
      <div className="stat">
        <div className="v" style={{ fontSize: 18, lineHeight: 1.4 }}>
          {top === null ? "—" : TIER_LABEL[top]}
        </div>
        <div className="k">Najwyższy zdobyty tier</div>
      </div>
      <div className="stat">
        <div className="v mono">{inProgress}</div>
        <div className="k">W toku</div>
      </div>
    </div>
  );
}

// ============================================================
// BandPlate — płyta jednego pasa: well + rail z nazwą tieru i licznikiem.
// ============================================================

function BandPlate({
  box,
  counts,
  reveal,
}: {
  box: PyramidBandBox;
  counts: { total: number; mastered: number };
  reveal: number;
}) {
  return (
    <div
      className="pyramid-band"
      data-tier={box.tier}
      style={{ top: box.y, height: box.h, "--reveal": reveal } as React.CSSProperties}
    >
      <div className="pyramid-band-head">
        <span className="uppercase-label">{TIER_LABEL[box.tier]}</span>
        <span className="mono text-xs">
          {counts.mastered}/{counts.total}
        </span>
      </div>
      <span aria-hidden="true" className="pyramid-band-roman">
        {TIER_ROMAN[box.tier]}
      </span>
    </div>
  );
}

// ============================================================
// NodeCard — jedna umiejętność, link do drabiny wariantów.
// ============================================================

function NodeCard({
  node,
  href,
  x,
  y,
  reveal,
  hasDependents,
  prereqCount,
  prereqsOpen,
  onFocusChange,
}: {
  node: TreeNode;
  href: string;
  x: number;
  y: number;
  reveal: number;
  /** Coś z tej umiejętności wyrasta → stopka na górnej krawędzi. */
  hasDependents: boolean;
  /** Ile prereków ma ta umiejętność → grot na dolnej krawędzi. */
  prereqCount: number;
  /** Wszystkie prereki opanowane — droga do tej karty jest już otwarta. */
  prereqsOpen: boolean;
  /** Wskazanie karty (mysz albo klawiatura) → podświetlenie jej krawędzi. */
  onFocusChange: (skillId: string | null) => void;
}) {
  const state: NodeState = node.state ?? "locked";
  const isLocked = state === "locked";

  return (
    <Link
      to={href}
      data-tier={node.tier}
      data-state={state}
      className={`card card-hover pyramid-node${isLocked ? " pyramid-node-locked" : ""}`}
      style={
        {
          left: `${(x / VIEW_W) * 100}%`,
          top: y,
          zIndex: 2,
          "--reveal": reveal,
        } as React.CSSProperties
      }
      aria-label={`${node.name} — ${TIER_LABEL[node.tier]}, ${STATE_LABEL[state]}`}
      onMouseEnter={() => onFocusChange(node.skillId)}
      onMouseLeave={() => onFocusChange(null)}
      onFocus={() => onFocusChange(node.skillId)}
      onBlur={() => onFocusChange(null)}
    >
      {/* Stopka — z tej umiejętności wyrasta co najmniej jedna inna. */}
      {hasDependents ? <span aria-hidden="true" className="pyramid-node-foot" /> : null}

      <span className="pyramid-node-state">
        <span aria-hidden="true" className="pyramid-node-dot" />
        <span className="mono">{STATE_SHORT[state]}</span>
      </span>

      <span className="pyramid-node-name">{node.name}</span>

      {/* Kolor CELOWO w CSS, nie inline: styl inline wygrałby z regułą
          kontrastu `.pyramid-node[data-tier="expert"] .pyramid-node-sub`. */}
      <span className="mono pyramid-node-sub">{levelText(node)}</span>

      {/* Rowek i jego wypełnienie stylowane w CSS — tło rowka musi dać się
          nadpisać na karcie odwróconej, a inline by na to nie pozwolił. */}
      <span aria-hidden="true" className="pyramid-node-bar">
        <span style={{ width: barFill(state, node) }} />
      </span>

      {/* Grot — tutaj wchodzą prerekwizyty. */}
      {prereqCount > 0 ? (
        <span
          aria-hidden="true"
          className="pyramid-node-notch"
          data-open={prereqsOpen ? "1" : "0"}
        />
      ) : null}
    </Link>
  );
}

/** „5 poziomów" po polsku: 1 poziom, 2–4 poziomy, 5+ poziomów (z wyjątkiem 12–14). */
function levelsWord(n: number): string {
  if (n === 1) return "poziom";
  const last = n % 10;
  const teens = n % 100;
  return last >= 2 && last <= 4 && !(teens >= 12 && teens <= 14) ? "poziomy" : "poziomów";
}

/**
 * Linia poziomu: „poziom n/m", gdy podopieczny jest na drabinie; inaczej jej
 * głębokość. Stanu już tu nie powtarzamy — niesie go pasek nad nazwą.
 */
function levelText(node: TreeNode): string {
  if (node.variationCount === 0) return "brak wariantów";
  return node.currentOrdinal != null
    ? `poziom ${node.currentOrdinal}/${node.variationCount}`
    : `${node.variationCount} ${levelsWord(node.variationCount)}`;
}

/** Wypełnienie paska wg stanu. mastered = pełny, available/locked = pusty. */
function barFill(state: NodeState, node: TreeNode): string {
  if (state === "mastered") return "100%";
  if (state === "in_progress") {
    if (node.currentOrdinal != null && node.variationCount > 0) {
      return `${Math.round((node.currentOrdinal / node.variationCount) * 100)}%`;
    }
    return "40%";
  }
  return "0%";
}

// ============================================================
// StateLegend — klucz kolorów stanu + legenda krawędzi.
// ============================================================

function StateLegend() {
  const items: NodeState[] = ["mastered", "in_progress", "available", "locked"];
  return (
    <div className="pyramid-legend row wrap">
      {items.map((state) => (
        <span key={state} className="row" style={{ gap: 6, alignItems: "center" }}>
          <span aria-hidden="true" className="pyramid-legend-swatch" data-state={state} />
          <span>{STATE_LABEL[state]}</span>
        </span>
      ))}

      {/* Reguła kierunku wyłożona wprost — bez niej linia mówi tylko „te dwie
          umiejętności są połączone", a nie która z której wynika. */}
      <span className="row" style={{ gap: 7, alignItems: "center" }}>
        <svg width={30} height={12} aria-hidden="true" style={{ display: "block" }}>
          <title>stopka, linia, grot</title>
          <rect x={0} y={4} width={7} height={8} rx={2} fill="var(--ok)" />
          <path d="M3.5,8 L21,8" stroke="var(--ok)" strokeWidth={2} strokeLinecap="round" />
          <path d="M21,2 L29,8 L21,12 Z" fill="var(--ok)" />
        </svg>
        <span>ze stopki prerekwizytu w grot tego, co odblokowuje</span>
      </span>

      <span className="row" style={{ gap: 6, alignItems: "center" }}>
        <svg width={22} height={10} aria-hidden="true" style={{ display: "block" }}>
          <title>linia przerywana</title>
          <line
            x1={1}
            y1={5}
            x2={21}
            y2={5}
            stroke="var(--line-2)"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        </svg>
        <span>prerekwizyt nieopanowany</span>
      </span>

      <span className="row" style={{ gap: 6, alignItems: "center" }}>
        <svg width={22} height={10} aria-hidden="true" style={{ display: "block" }}>
          <title>linia kropkowana</title>
          <line
            x1={1}
            y1={5}
            x2={21}
            y2={5}
            stroke="var(--warn)"
            strokeWidth={2}
            strokeDasharray="2 4"
          />
        </svg>
        <span>prerekwizyt trudniejszy — do poprawy</span>
      </span>
    </div>
  );
}

// ============================================================
// VariationLadder — growy, pionowy tor wariantów jednej umiejętności
// (tuck → adv tuck → … → full). Współdzieli język wizualny z SkillTreeView:
// tokeny `var(--*)`, etykiety mono, hairline bordery, brak glow/emoji.
// Stany kroków: done (poniżej bieżącego, `--ok` + ptaszek), current (bieżący,
// `--accent` + pigułka „TU JESTEŚ"), locked/upcoming (powyżej bieżącego lub gdy
// brak bieżącego — przygaszone `--muted`). Czysta prezentacja, read-only.
// ============================================================

type LadderState = "done" | "current" | "locked";

/** Token-based accent color for a ladder step (no hardcoded hex, no glow). */
function ladderStepColor(state: LadderState): string {
  switch (state) {
    case "done":
      return "var(--ok)";
    case "current":
      return "var(--accent)";
    case "locked":
      return "var(--muted-2)";
  }
}

export function VariationLadder({
  variations,
  currentVariationId,
}: {
  variations: Array<{
    id: string;
    ordinal: number;
    exerciseName: string;
  }>;
  /**
   * Bieżący poziom podopiecznego. Kontrakt trzyma go na wpisie mapy, nie flagą
   * per wariant — drabina dostaje więc identyfikator i sama rozstrzyga kroki.
   */
  currentVariationId: string | null;
}): React.JSX.Element {
  if (variations.length === 0) {
    return (
      <span className="text-xs muted">Brak wariantów — uzupełnij w edytorze umiejętności.</span>
    );
  }

  const currentOrdinal = variations.find((v) => v.id === currentVariationId)?.ordinal ?? null;
  const steps = [...variations].sort((a, b) => a.ordinal - b.ordinal);

  return (
    <ol
      className="col"
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        gap: 0,
        position: "relative",
      }}
    >
      {steps.map((v, i) => {
        const state: LadderState =
          v.id === currentVariationId
            ? "current"
            : currentOrdinal != null && v.ordinal < currentOrdinal
              ? "done"
              : "locked";
        const color = ladderStepColor(state);
        const isLast = i === steps.length - 1;
        return (
          <LadderStep
            key={v.id}
            ordinal={v.ordinal}
            exerciseName={v.exerciseName}
            state={state}
            color={color}
            isLast={isLast}
          />
        );
      })}
    </ol>
  );
}

function LadderStep({
  ordinal,
  exerciseName,
  state,
  color,
  isLast,
}: {
  ordinal: number;
  exerciseName: string;
  state: LadderState;
  color: string;
  isLast: boolean;
}) {
  const isCurrent = state === "current";
  const isDone = state === "done";
  const isLocked = state === "locked";

  // Connector segment color: solid accent/ok up to the current step, dashed
  // hairline above it (the not-yet-reached part of the path).
  const connectorReached = isDone || isCurrent;

  return (
    <li
      className="row"
      style={{
        gap: 12,
        alignItems: "stretch",
        opacity: isLocked ? 0.6 : 1,
      }}
      aria-current={isCurrent ? "step" : undefined}
    >
      {/* Rail: node + vertical connector to the next step. */}
      <div
        aria-hidden="true"
        className="col"
        style={{
          alignItems: "center",
          gap: 0,
          flexShrink: 0,
          width: 28,
          paddingTop: 2,
        }}
      >
        {/* Node marker — mono ordinal, or check for done, accent ring for current. */}
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 28,
            height: 28,
            borderRadius: "var(--radius-pill)",
            border: `${isCurrent ? 2 : 1}px solid ${isLocked ? "var(--line)" : color}`,
            background: isCurrent
              ? "var(--accent)"
              : isDone
                ? "var(--accent-soft)"
                : "var(--surface-2)",
            color: isCurrent ? "var(--accent-ink)" : isDone ? "var(--ok)" : "var(--muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {isDone ? <Icons.Check style={{ width: 14, height: 14 }} /> : ordinal}
        </span>
        {/* Vertical connector down to the next node (omit on last step). */}
        {!isLast ? (
          <span
            style={{
              flex: 1,
              width: connectorReached ? 2 : 0,
              minHeight: 18,
              marginTop: 2,
              marginBottom: 2,
              background: connectorReached ? color : "transparent",
              borderLeft: connectorReached ? undefined : "2px dashed var(--line)",
            }}
          />
        ) : null}
      </div>

      {/* Label block. */}
      <div
        className="col"
        style={{
          gap: 4,
          paddingBottom: isLast ? 0 : 14,
          minWidth: 0,
        }}
      >
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: isCurrent ? 600 : 500,
              fontSize: 14,
              letterSpacing: "-0.01em",
              color: isLocked ? "var(--ink-2)" : "var(--ink)",
            }}
          >
            <span className="mono" style={{ color: isLocked ? "var(--muted)" : color }}>
              {ordinal}.
            </span>{" "}
            {exerciseName}
          </span>
          {isCurrent ? (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "var(--radius-pill)",
                whiteSpace: "nowrap",
                background: "var(--accent)",
                color: "var(--accent-ink)",
                border: "1px solid transparent",
              }}
            >
              Tu jesteś
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
