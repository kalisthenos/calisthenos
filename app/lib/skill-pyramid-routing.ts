import {
  DEFAULT_METRICS,
  type PyramidLayout,
  type PyramidMetrics,
  VIEW_W,
} from "~/lib/skill-pyramid";
import type { Edge } from "~/lib/skill-tree-math";

/**
 * Trasowanie krawędzi piramidy. Czysta logika — bez DOM, bez DB, SSR-clean.
 *
 * ZASADA KIERUNKU
 * ---------------
 * Krawędź ZAWSZE wychodzi z GÓRNEJ krawędzi prerekwizytu i wchodzi w DOLNĄ
 * krawędź umiejętności, którą odblokowuje. Dzięki temu dwa znaczniki na karcie
 * (stopka u góry, grot u dołu) opisują całą planszę i nie trzeba grotu na każdej
 * krawędzi — co jest istotne, bo oś X jest rozciągana i `<marker>` by się spłaszczył.
 *
 * MODEL WSPÓŁRZĘDNYCH
 * -------------------
 * Ten sam co w `skill-pyramid`: x w jednostkach 0..VIEW_W (rozciągane na szerokość
 * planszy), y w pikselach 1:1.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface RoutedEdge {
  /** Umiejętność zależna (wyżej na planszy). */
  from: string;
  /** Prerekwizyt (niżej na planszy). */
  requires: string;
  /** Łamana: start na karcie prereka, koniec na karcie zależnej. */
  points: Pt[];
  /** Prerekwizyt leży WYŻEJ niż to, co odblokowuje — możliwe po zmianie tieru. */
  reversed: boolean;
}

/** Odległość pierwszego pasa od dolnej krawędzi karty docelowej, px. */
const LANE_BASE = 12;
/** Odstęp między pasami, px. */
const LANE_STEP = 9;
/** Ile pasów mieści przerwa `rowH - cardH` (150 - 112 = 38 px). */
const MAX_LANES = 3;
/** O ile nad kartę prereka wychodzi zejście do korytarza, px. */
const STUB = 10;
/** Zapas wokół karty przy szukaniu korytarza, w ułamku slotu. */
const CORRIDOR_MARGIN = 0.04;
/** Poniżej tej różnicy x (ułamek slotu) rysujemy prosty pion zamiast łamanej. */
const SAME_COL = 0.06;
/** Ile półslotów w bok wolno odsunąć korytarz, zanim się poddamy. */
const MAX_CORRIDOR_STEPS = 6;
/** Skurczenie zakresu poziomego odcinka — samo zejście się w punkcie celu to nie kolizja. */
const RUN_PAD = 0.5;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Punkt oddalony o `d` od `a` w stronę `b`. */
function towards(a: Pt, b: Pt, d: number): Pt {
  const len = dist(a, b) || 1;
  return { x: a.x + ((b.x - a.x) / len) * d, y: a.y + ((b.y - a.y) / len) * d };
}

/**
 * Pion nie może przechodzić przez kartę — inaczej nie widać, co z czym łączy.
 * Domyślnie biegnie w kolumnie prereka; przy kolizji odsuwamy go o kolejne
 * półsloty, zaczynając od strony celu (tam trasa i tak zmierza).
 */
function findCorridor(
  srcX: number,
  dstX: number,
  yTop: number,
  yBot: number,
  layout: PyramidLayout,
  slot: number,
  half: number,
  skip: Set<string>,
): number {
  const blocked = (x: number): boolean => {
    for (const [id, c] of layout.centers) {
      if (skip.has(id)) continue;
      if (Math.abs(x - c.x) >= layout.cardHalfW + CORRIDOR_MARGIN * slot) continue;
      if (yBot <= c.y - half || yTop >= c.y + half) continue;
      return true;
    }
    return false;
  };

  if (!blocked(srcX)) return srcX;
  const toward = dstX > srcX ? 1 : -1;
  for (let k = 1; k <= MAX_CORRIDOR_STEPS; k++) {
    for (const sign of [toward, -toward]) {
      const cand = srcX + sign * k * 0.5 * slot;
      if (cand < 0 || cand > VIEW_W) continue;
      if (!blocked(cand)) return cand;
    }
  }
  return srcX; // nie ma wolnego korytarza — lepiej narysować prosto niż nic
}

/** Pierwszy pas, w którym poziomy odcinek nikomu nie wejdzie na drogę. */
function allocLane(
  lanes: Map<number, Array<Array<[number, number]>>>,
  key: number,
  x1: number,
  x2: number,
): number {
  const lo = Math.min(x1, x2) + RUN_PAD;
  const hi = Math.max(x1, x2) - RUN_PAD;
  const list = lanes.get(key) ?? [];
  for (let i = 0; i < MAX_LANES; i++) {
    const used = list[i] ?? [];
    if (used.every(([a, b]) => hi <= a || lo >= b)) {
      used.push([lo, hi]);
      list[i] = used;
      lanes.set(key, list);
      return i;
    }
  }
  return MAX_LANES - 1; // przepełnienie: ostatni pas przyjmuje resztę
}

/**
 * Trasuje krawędzie na gotowej planszy. Krawędź dotykająca węzła spoza planszy
 * (np. zarchiwizowanego) jest pomijana.
 */
export function routeEdges(
  edges: Edge[],
  layout: PyramidLayout,
  m: PyramidMetrics = DEFAULT_METRICS,
): RoutedEdge[] {
  const slot = VIEW_W / layout.boardCols;
  const half = m.cardH / 2;
  const lanes = new Map<number, Array<Array<[number, number]>>>();
  const out: RoutedEdge[] = [];

  for (const e of edges) {
    const src = layout.centers.get(e.requires);
    const dst = layout.centers.get(e.from);
    if (!src || !dst) continue;

    const reversed = src.y < dst.y;
    if (reversed) {
      // Anomalia po zmianie tieru: prereq wisi NAD tym, co odblokowuje. Reguła
      // „z góry karty w dół karty" dałaby tu pętlę, więc łączymy najbliższe
      // krawędzie prostym odcinkiem; komponent rysuje go stylem ostrzegawczym.
      out.push({
        from: e.from,
        requires: e.requires,
        reversed,
        points: [
          { x: src.x, y: src.y + half },
          { x: dst.x, y: dst.y - half },
        ],
      });
      continue;
    }

    const srcTop = src.y - half;
    const dstBot = dst.y + half;

    if (Math.abs(src.x - dst.x) < SAME_COL * slot) {
      out.push({
        from: e.from,
        requires: e.requires,
        reversed,
        points: [
          { x: src.x, y: srcTop },
          { x: dst.x, y: dstBot },
        ],
      });
      continue;
    }

    // Korytarz liczymy dla pasa 0; różnica między pasami (≤ 18 px) mieści się
    // w przerwie między rzędami, gdzie i tak nie ma kart.
    const approxLaneY = dstBot + LANE_BASE;
    const corridorX = findCorridor(
      src.x,
      dst.x,
      approxLaneY,
      srcTop,
      layout,
      slot,
      half,
      new Set([e.from, e.requires]),
    );
    const shifted = Math.abs(corridorX - src.x) > 1e-6;
    const lane = allocLane(lanes, Math.round(dst.y), corridorX, dst.x);
    const laneY = dstBot + LANE_BASE + lane * LANE_STEP;

    const points: Pt[] = shifted
      ? [
          { x: src.x, y: srcTop },
          { x: corridorX, y: srcTop - STUB },
          { x: corridorX, y: laneY },
          { x: dst.x, y: laneY },
          { x: dst.x, y: dstBot },
        ]
      : [
          { x: src.x, y: srcTop },
          { x: src.x, y: laneY },
          { x: dst.x, y: laneY },
          { x: dst.x, y: dstBot },
        ];

    out.push({ from: e.from, requires: e.requires, reversed, points });
  }

  return out;
}

const fmt = (p: Pt): string => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`;

/**
 * Łamana → atrybut `d` z zaokrąglonymi zakrętami. Promień jest osobny dla osi X
 * i Y, bo oś X jest rozciągana na szerokość planszy — okrągły róg w jednostkach
 * VIEW_W wyszedłby elipsą. Każdy promień przycinamy do połowy sąsiedniego odcinka,
 * więc dwa zakręty nigdy nie zjedzą tego samego odcinka dwa razy.
 */
export function edgePathD(points: Pt[], rx: number, ry: number): string {
  if (points.length < 2) return "";
  const parts = [`M${fmt(points[0]!)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const inHorizontal = Math.abs(prev.y - cur.y) < 1e-6;
    const outHorizontal = Math.abs(next.y - cur.y) < 1e-6;
    const rIn = Math.min(inHorizontal ? rx : ry, dist(prev, cur) / 2);
    const rOut = Math.min(outHorizontal ? rx : ry, dist(cur, next) / 2);
    parts.push(`L${fmt(towards(cur, prev, rIn))}`, `Q${fmt(cur)} ${fmt(towards(cur, next, rOut))}`);
  }
  parts.push(`L${fmt(points[points.length - 1]!)}`);
  return parts.join(" ");
}
