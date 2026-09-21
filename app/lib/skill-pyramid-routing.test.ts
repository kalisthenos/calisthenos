import { describe, expect, it } from "vitest";
import {
  type PyramidLayout,
  type PyramidMetrics,
  type PyramidNodeInput,
  VIEW_W,
  buildPyramid,
  layoutPyramid,
  orderAndPlace,
} from "./skill-pyramid";
import { type Pt, edgePathD, routeEdges } from "./skill-pyramid-routing";
import type { Edge } from "./skill-tree-math";

const M: PyramidMetrics = { rowH: 150, bandHeaderH: 34, bandGap: 18, cardH: 112 };

/**
 * Ręcznie złożona plansza — routing testujemy w oderwaniu od algorytmu rozstawiania,
 * żeby pozycje w teście były jawne, a nie wynikiem sześciu zamiatań barycentrum.
 * `col` liczy się w slotach; y podajemy wprost w pikselach.
 */
function fakeLayout(nodes: Array<{ id: string; col: number; y: number }>, boardCols: number) {
  const slot = VIEW_W / boardCols;
  const centers = new Map<string, Pt>();
  for (const n of nodes) centers.set(n.id, { x: (n.col + 0.5) * slot, y: n.y });
  const layout: PyramidLayout = {
    totalH: Math.max(...nodes.map((n) => n.y)) + M.rowH,
    boardCols,
    bands: [],
    centers,
    cardHalfW: 0.43 * slot,
  };
  return layout;
}

const PROD_NODES: PyramidNodeInput[] = [
  { id: "pull", name: "Podciąganie", tier: "basic" },
  { id: "dipy", name: "Dipy", tier: "basic" },
  { id: "hollow", name: "Hollow body", tier: "basic" },
  { id: "mu", name: "muscle up", tier: "intermediate" },
  { id: "dragon", name: "Dragon flag", tier: "intermediate" },
  { id: "hs", name: "Handstand", tier: "intermediate" },
  { id: "press", name: "press do handstand'a", tier: "intermediate" },
  { id: "hspu", name: "HSPU", tier: "intermediate" },
  { id: "fl", name: "Frontlever", tier: "advanced" },
  { id: "planche", name: "planche", tier: "advanced" },
  { id: "hspu90", name: "90 degree HSPU", tier: "advanced" },
  { id: "oahs", name: "One arm handstand", tier: "expert" },
];

const PROD_EDGES: Edge[] = [
  { from: "mu", requires: "pull" },
  { from: "mu", requires: "dipy" },
  { from: "dragon", requires: "hollow" },
  { from: "hs", requires: "hollow" },
  { from: "press", requires: "hs" },
  { from: "hspu", requires: "press" },
  { from: "fl", requires: "pull" },
  { from: "fl", requires: "dragon" },
  { from: "planche", requires: "dipy" },
  { from: "planche", requires: "press" },
  { from: "hspu90", requires: "hspu" },
  { from: "oahs", requires: "hspu90" },
];

function prodLayout(): PyramidLayout {
  const names = new Map(PROD_NODES.map((n) => [n.id, n.name]));
  return layoutPyramid(orderAndPlace(buildPyramid(PROD_NODES, PROD_EDGES), PROD_EDGES, names), M);
}

/** Odcinki pionowe łamanej (te, które mogą wjechać w kartę). */
function verticalSegments(points: Pt[]): Array<{ x: number; y0: number; y1: number }> {
  const out: Array<{ x: number; y0: number; y1: number }> = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) > 1e-6) {
      out.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
    }
  }
  return out;
}

/** Poziomy odcinek łamanej, jeśli jest (przeskok w przerwie pod celem). */
function horizontalRun(points: Pt[]): { y: number; x0: number; x1: number } | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1e-6) {
      return { y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) };
    }
  }
  return null;
}

describe("routeEdges — kształt łamanej", () => {
  it("ta sama kolumna → prosty pion od górnej krawędzi prereka do dolnej krawędzi zależnej", () => {
    const layout = fakeLayout(
      [
        { id: "a", col: 0, y: 500 },
        { id: "b", col: 0, y: 350 },
      ],
      2,
    );
    const [e] = routeEdges([{ from: "b", requires: "a" }], layout, M);
    expect(e!.points).toHaveLength(2);
    expect(e!.points[0]!.y).toBeCloseTo(500 - M.cardH / 2, 6);
    expect(e!.points[1]!.y).toBeCloseTo(350 + M.cardH / 2, 6);
    expect(e!.points[0]!.x).toBeCloseTo(e!.points[1]!.x, 6);
  });

  it("różne kolumny → poziomy przeskok w przerwie pod celem", () => {
    const layout = fakeLayout(
      [
        { id: "a", col: 0, y: 500 },
        { id: "b", col: 2, y: 350 },
      ],
      3,
    );
    const [e] = routeEdges([{ from: "b", requires: "a" }], layout, M);
    expect(e!.points.length).toBeGreaterThanOrEqual(4);
    const run = horizontalRun(e!.points)!;
    expect(run).not.toBeNull();
    // Przeskok siedzi pod celem, a nad kartą prereka.
    expect(run.y).toBeGreaterThan(350 + M.cardH / 2);
    expect(run.y).toBeLessThan(500 - M.cardH / 2);
  });

  it("każda krawędź zaczyna się na karcie prereka i kończy na karcie zależnej", () => {
    const layout = prodLayout();
    for (const e of routeEdges(PROD_EDGES, layout, M)) {
      const src = layout.centers.get(e.requires)!;
      const dst = layout.centers.get(e.from)!;
      const first = e.points[0]!;
      const last = e.points[e.points.length - 1]!;
      expect(first.x).toBeCloseTo(src.x, 6);
      expect(first.y).toBeCloseTo(src.y - M.cardH / 2, 6);
      expect(last.x).toBeCloseTo(dst.x, 6);
      expect(last.y).toBeCloseTo(dst.y + M.cardH / 2, 6);
    }
  });

  it("żaden pionowy odcinek nie przecina karty", () => {
    // To jest zarzut nr 2 właściciela sprowadzony do inwariantu: linia nie ma prawa
    // przejść pod kartą, bo wtedy nie wiadomo, co z czym łączy.
    const layout = prodLayout();
    const routed = routeEdges(PROD_EDGES, layout, M);
    for (const e of routed) {
      for (const seg of verticalSegments(e.points)) {
        for (const [id, c] of layout.centers) {
          if (id === e.from || id === e.requires) continue;
          const overlapsY = seg.y1 > c.y - M.cardH / 2 && seg.y0 < c.y + M.cardH / 2;
          const overlapsX = Math.abs(seg.x - c.x) < layout.cardHalfW;
          expect(overlapsY && overlapsX).toBe(false);
        }
      }
    }
  });
});

describe("routeEdges — pasy poziomych odcinków", () => {
  it("krawędzie o nachodzących zakresach x dostają różne pasy", () => {
    // Dwie krawędzie krzyżujące się w tej samej przerwie: a→d i b→c.
    const layout = fakeLayout(
      [
        { id: "a", col: 0, y: 500 },
        { id: "b", col: 1, y: 500 },
        { id: "c", col: 0, y: 350 },
        { id: "d", col: 1, y: 350 },
      ],
      2,
    );
    const routed = routeEdges(
      [
        { from: "d", requires: "a" },
        { from: "c", requires: "b" },
      ],
      layout,
      M,
    );
    const ys = routed.map((e) => horizontalRun(e.points)!.y);
    expect(ys[0]).not.toBeCloseTo(ys[1]!, 6);
  });

  it("krawędzie o rozłącznych zakresach x dzielą ten sam pas", () => {
    const layout = fakeLayout(
      [
        { id: "a", col: 0, y: 500 },
        { id: "b", col: 3, y: 500 },
        { id: "c", col: 1, y: 350 },
        { id: "d", col: 4, y: 350 },
      ],
      5,
    );
    const routed = routeEdges(
      [
        { from: "c", requires: "a" },
        { from: "d", requires: "b" },
      ],
      layout,
      M,
    );
    const ys = routed.map((e) => horizontalRun(e.points)!.y);
    expect(ys[0]).toBeCloseTo(ys[1]!, 6);
  });

  it("poziome odcinki mieszczą się w przerwie między rzędami", () => {
    const layout = prodLayout();
    for (const e of routeEdges(PROD_EDGES, layout, M)) {
      const run = horizontalRun(e.points);
      if (!run) continue;
      const dst = layout.centers.get(e.from)!;
      const src = layout.centers.get(e.requires)!;
      expect(run.y).toBeGreaterThan(dst.y + M.cardH / 2);
      expect(run.y).toBeLessThan(src.y - M.cardH / 2);
    }
  });
});

describe("routeEdges — krawędź odwrócona i determinizm", () => {
  it("reversed dokładnie wtedy, gdy prerekwizyt leży wyżej niż zależna", () => {
    const layout = fakeLayout(
      [
        { id: "low", col: 0, y: 500 },
        { id: "high", col: 1, y: 200 },
      ],
      2,
    );
    const normal = routeEdges([{ from: "high", requires: "low" }], layout, M);
    const inverted = routeEdges([{ from: "low", requires: "high" }], layout, M);
    expect(normal[0]!.reversed).toBe(false);
    expect(inverted[0]!.reversed).toBe(true);
  });

  it("krawędź do węzła spoza planszy jest pomijana", () => {
    const layout = fakeLayout([{ id: "a", col: 0, y: 500 }], 1);
    expect(routeEdges([{ from: "duch", requires: "a" }], layout, M)).toEqual([]);
  });

  it("jest deterministyczny — permutacja krawędzi nie zmienia tras", () => {
    const layout = prodLayout();
    const a = routeEdges(PROD_EDGES, layout, M);
    const b = routeEdges([...PROD_EDGES].reverse(), layout, M);
    const key = (e: (typeof a)[number]) => `${e.requires}->${e.from}`;
    const byKey = new Map(b.map((e) => [key(e), e]));
    for (const e of a) expect(byKey.get(key(e))).toEqual(e);
  });
});

describe("edgePathD", () => {
  it("dwa punkty → prosty odcinek bez zaokrągleń", () => {
    const d = edgePathD(
      [
        { x: 10, y: 100 },
        { x: 10, y: 20 },
      ],
      16,
      12,
    );
    expect(d).toBe("M10,100 L10,20");
    expect(d).not.toContain("Q");
  });

  it("łamana z dwoma zakrętami dostaje dwa zaokrąglenia", () => {
    const d = edgePathD(
      [
        { x: 10, y: 300 },
        { x: 10, y: 200 },
        { x: 200, y: 200 },
        { x: 200, y: 100 },
      ],
      16,
      12,
    );
    expect(d.match(/Q/g)).toHaveLength(2);
    expect(d.startsWith("M10,300")).toBe(true);
    expect(d.endsWith("200,100")).toBe(true);
  });

  it("promień jest przycinany do długości odcinka — ścieżka nigdy nie cofa się", () => {
    const points: Pt[] = [
      { x: 0, y: 100 },
      { x: 0, y: 96 },
      { x: 8, y: 96 },
      { x: 8, y: 40 },
    ];
    const d = edgePathD(points, 40, 40);
    expect(d).not.toContain("NaN");
    // Żadna współrzędna nie może wyjść poza prostokąt rozpięty na punktach.
    for (const num of d.match(/-?\d+(\.\d+)?/g) ?? []) {
      expect(Number.isFinite(Number(num))).toBe(true);
    }
  });

  it("pusta lub jednopunktowa łamana daje pusty `d`", () => {
    expect(edgePathD([], 16, 12)).toBe("");
    expect(edgePathD([{ x: 1, y: 2 }], 16, 12)).toBe("");
  });
});
