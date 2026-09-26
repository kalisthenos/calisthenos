import { describe, expect, it } from "vitest";
import {
  DEFAULT_METRICS,
  type PyramidMetrics,
  type PyramidNodeInput,
  VIEW_W,
  buildPyramid,
  layoutPyramid,
  orderAndPlace,
} from "./skill-pyramid";
import type { Edge } from "./skill-tree-math";

/**
 * Drzewo z produkcji (zrzut `docs/skill-tree.png`) + jeden węzeł EKSPERT.
 * Służy testom układu: to na nim właściciel zgłosił plątaninę krawędzi.
 */
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

function namesOf(nodes: PyramidNodeInput[]): Map<string, string> {
  return new Map(nodes.map((x) => [x.id, x.name]));
}

function placeProd() {
  return orderAndPlace(buildPyramid(PROD_NODES, PROD_EDGES), PROD_EDGES, namesOf(PROD_NODES));
}

/** Skrót „zbuduj pasy i rozstaw je" — wejście `layoutPyramid`. */
function place(nodes: PyramidNodeInput[], edges: Edge[] = []) {
  return orderAndPlace(buildPyramid(nodes, edges), edges, namesOf(nodes));
}

const M: PyramidMetrics = {
  rowH: 100,
  bandHeaderH: 20,
  bandGap: 10,
  cardH: 70,
};

function n(id: string, tier: PyramidNodeInput["tier"], name = id): PyramidNodeInput {
  return { id, name, tier };
}

describe("buildPyramid — pasy", () => {
  it("węzeł bez krawędzi trafia do pasa swojego tieru, podrząd 0", () => {
    const bands = buildPyramid([n("a", "advanced")], []);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.tier).toBe("advanced");
    expect(bands[0]!.rows).toEqual([["a"]]);
  });

  it("pomija puste pasy i zwraca je rosnąco od basic", () => {
    const bands = buildPyramid([n("x", "expert"), n("y", "basic")], []);
    expect(bands.map((b) => b.tier)).toEqual(["basic", "expert"]);
  });

  it("każdy niepusty tier dostaje własny pas", () => {
    const bands = buildPyramid(
      [n("a", "basic"), n("b", "intermediate"), n("c", "advanced"), n("d", "expert")],
      [],
    );
    expect(bands.map((b) => b.tier)).toEqual(["basic", "intermediate", "advanced", "expert"]);
  });
});

describe("buildPyramid — podrzędy", () => {
  it("krawędź wewnątrz pasa tworzy podrząd (prereq niżej)", () => {
    const nodes = [n("dip", "intermediate", "Dip"), n("pull", "intermediate", "Pull-up")];
    const edges: Edge[] = [{ from: "dip", requires: "pull" }];
    const bands = buildPyramid(nodes, edges);
    expect(bands[0]!.rows).toEqual([["pull"], ["dip"]]);
  });

  it("łańcuch trzech w jednym pasie daje trzy podrzędy", () => {
    const nodes = [n("c", "basic"), n("b", "basic"), n("a", "basic")];
    const edges: Edge[] = [
      { from: "b", requires: "a" },
      { from: "c", requires: "b" },
    ];
    const bands = buildPyramid(nodes, edges);
    expect(bands[0]!.rows).toEqual([["a"], ["b"], ["c"]]);
  });

  it("krawędź międzypasowa NIE tworzy podrzędu", () => {
    const nodes = [n("front", "advanced"), n("pull", "basic")];
    const edges: Edge[] = [{ from: "front", requires: "pull" }];
    const bands = buildPyramid(nodes, edges);
    expect(bands.find((b) => b.tier === "basic")!.rows).toEqual([["pull"]]);
    expect(bands.find((b) => b.tier === "advanced")!.rows).toEqual([["front"]]);
  });

  it("krawędź odwrócona (prereq z wyższego tieru) nie wybucha i nie tworzy podrzędu", () => {
    const nodes = [n("push", "basic"), n("planche", "expert")];
    const edges: Edge[] = [{ from: "push", requires: "planche" }];
    const bands = buildPyramid(nodes, edges);
    expect(bands.find((b) => b.tier === "basic")!.rows).toEqual([["push"]]);
    expect(bands.find((b) => b.tier === "expert")!.rows).toEqual([["planche"]]);
  });

  it("węzeł z dwoma prerekami w pasie bierze max głębokości", () => {
    const nodes = [n("a", "basic"), n("b", "basic"), n("d", "basic")];
    const edges: Edge[] = [
      { from: "b", requires: "a" },
      { from: "d", requires: "a" },
      { from: "d", requires: "b" },
    ];
    const bands = buildPyramid(nodes, edges);
    expect(bands[0]!.rows[2]).toEqual(["d"]);
  });

  it("cykl wewnątrz pasa nie zapętla i nie zostawia pustego podrzędu", () => {
    const nodes = [n("a", "basic"), n("b", "basic")];
    const edges: Edge[] = [
      { from: "a", requires: "b" },
      { from: "b", requires: "a" },
    ];
    const bands = buildPyramid(nodes, edges);
    expect(bands[0]!.rows.flat().sort()).toEqual(["a", "b"]);
    expect(bands[0]!.rows.every((r) => r.length > 0)).toBe(true);
  });

  it("krawędź do węzła spoza wejścia jest ignorowana", () => {
    const bands = buildPyramid([n("a", "basic")], [{ from: "a", requires: "nieistnieje" }]);
    expect(bands[0]!.rows).toEqual([["a"]]);
  });
});

describe("buildPyramid — kolejność", () => {
  it("sortuje rząd po nazwie z locale pl", () => {
    const nodes = [
      n("1", "basic", "Łokieć"),
      n("2", "basic", "Antagonista"),
      n("3", "basic", "Zwis"),
    ];
    expect(buildPyramid(nodes, [])[0]!.rows[0]).toEqual(["2", "1", "3"]);
  });

  it("jest deterministyczny — permutacja wejścia daje ten sam wynik", () => {
    const a = n("a", "basic", "Alfa");
    const b = n("b", "basic", "Beta");
    expect(buildPyramid([a, b], [])).toEqual(buildPyramid([b, a], []));
  });
});

/** Suma poziomych przebiegów krawędzi — im mniejsza, tym mniej skosów na planszy. */
function travel(columnOf: Map<string, number>, edges: Edge[]): number {
  return edges.reduce(
    (sum, e) => sum + Math.abs(columnOf.get(e.from)! - columnOf.get(e.requires)!),
    0,
  );
}

/** Układ, jaki daje dzisiejsza kolejność alfabetyczna: x = indeks w rzędzie. */
function alphabeticalColumns(bands: ReturnType<typeof buildPyramid>): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bands) for (const row of b.rows) row.forEach((id, i) => m.set(id, i));
  return m;
}

describe("orderAndPlace — kolumny", () => {
  it("czysty łańcuch prereków stoi w jednej kolumnie", () => {
    // Handstand → press → HSPU → 90 degree HSPU → One arm handstand: każde ogniwo
    // ma dokładnie jednego prereka, a ten dokładnie jedną zależną.
    const { columnOf } = placeProd();
    const chain = ["hs", "press", "hspu", "hspu90", "oahs"];
    const xs = chain.map((id) => columnOf.get(id)!);
    for (const x of xs) expect(x).toBeCloseTo(xs[0]!, 6);
  });

  it("dwie zależne jednego prereka rozchodzą się symetrycznie wokół niego", () => {
    const nodes: PyramidNodeInput[] = [
      { id: "r", name: "Rdzeń", tier: "basic" },
      { id: "a", name: "Alfa", tier: "intermediate" },
      { id: "b", name: "Beta", tier: "intermediate" },
    ];
    const edges: Edge[] = [
      { from: "a", requires: "r" },
      { from: "b", requires: "r" },
    ];
    const { columnOf } = orderAndPlace(buildPyramid(nodes, edges), edges, namesOf(nodes));
    const [xa, xb, xr] = [columnOf.get("a")!, columnOf.get("b")!, columnOf.get("r")!];
    expect(xa).not.toBeCloseTo(xb, 6);
    expect((xa + xb) / 2).toBeCloseTo(xr, 6);
  });

  it("równoległe łańcuchy nie zlewają się w jedną kolumnę", () => {
    const nodes: PyramidNodeInput[] = [
      { id: "a1", name: "A1", tier: "basic" },
      { id: "a2", name: "A2", tier: "basic" },
      { id: "b1", name: "B1", tier: "basic" },
      { id: "b2", name: "B2", tier: "basic" },
    ];
    const edges: Edge[] = [
      { from: "a2", requires: "a1" },
      { from: "b2", requires: "b1" },
    ];
    const { columnOf } = orderAndPlace(buildPyramid(nodes, edges), edges, namesOf(nodes));
    expect(columnOf.get("a1")!).toBeCloseTo(columnOf.get("a2")!, 6);
    expect(columnOf.get("b1")!).toBeCloseTo(columnOf.get("b2")!, 6);
    expect(Math.abs(columnOf.get("a1")! - columnOf.get("b1")!)).toBeGreaterThanOrEqual(1);
  });

  it("żadne dwa węzły w jednym rzędzie nie są bliżej niż jedna kolumna", () => {
    const { bands, columnOf } = placeProd();
    for (const band of bands) {
      for (const row of band.rows) {
        const xs = row.map((id) => columnOf.get(id)!);
        // Tolerancja pokrywa zaokrąglenie do 6 miejsc, które domyka determinizm.
        for (let i = 1; i < xs.length; i++) {
          expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(1 - 1e-5);
        }
      }
    }
  });

  it("rzędy wracają uporządkowane rosnąco po x", () => {
    const { bands, columnOf } = placeProd();
    for (const band of bands) {
      for (const row of band.rows) {
        const xs = row.map((id) => columnOf.get(id)!);
        expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      }
    }
  });

  it("graf bez krawędzi zachowuje kolejność alfabetyczną (locale pl)", () => {
    const nodes: PyramidNodeInput[] = [
      { id: "1", name: "Łokieć", tier: "basic" },
      { id: "2", name: "Antagonista", tier: "basic" },
      { id: "3", name: "Zwis", tier: "basic" },
    ];
    const { bands, columnOf } = orderAndPlace(buildPyramid(nodes, []), [], namesOf(nodes));
    expect(bands[0]!.rows[0]).toEqual(["2", "1", "3"]);
    expect(columnOf.get("2")).toBeCloseTo(0, 6);
    expect(columnOf.get("1")).toBeCloseTo(1, 6);
    expect(columnOf.get("3")).toBeCloseTo(2, 6);
  });

  it("jest deterministyczny — permutacja wejścia daje ten sam wynik", () => {
    const reversed = [...PROD_NODES].reverse();
    const shuffledEdges = [...PROD_EDGES].reverse();
    const a = placeProd();
    const b = orderAndPlace(
      buildPyramid(reversed, shuffledEdges),
      shuffledEdges,
      namesOf(reversed),
    );
    expect([...b.columnOf.entries()].sort()).toEqual([...a.columnOf.entries()].sort());
    expect(b.bands).toEqual(a.bands);
    expect(b.boardCols).toBeCloseTo(a.boardCols, 6);
  });

  it("każdy węzeł dostaje kolumnę, a najmniejsza z nich to 0", () => {
    const { columnOf } = placeProd();
    expect(columnOf.size).toBe(PROD_NODES.length);
    expect(Math.min(...columnOf.values())).toBeCloseTo(0, 6);
  });

  it("boardCols mieści najszerszy rząd", () => {
    const { bands, boardCols } = placeProd();
    const widest = Math.max(...bands.flatMap((b) => b.rows.map((r) => r.length)));
    expect(boardCols).toBeGreaterThanOrEqual(widest);
  });

  it("krawędzie biegną mniej na boki niż przy kolejności alfabetycznej", () => {
    // To jest zarzut nr 3 właściciela wyrażony liczbą: alfabet ustawia obok siebie
    // węzły, które nie mają ze sobą nic wspólnego, więc każda zależność jedzie skosem.
    const bands = buildPyramid(PROD_NODES, PROD_EDGES);
    const before = travel(alphabeticalColumns(bands), PROD_EDGES);
    const after = travel(placeProd().columnOf, PROD_EDGES);
    expect(after).toBeLessThan(before);
  });
});

describe("layoutPyramid — wymiary", () => {
  it("pusta piramida ma zerową wysokość", () => {
    const l = layoutPyramid(place([]), M);
    expect(l.totalH).toBe(0);
    expect(l.centers.size).toBe(0);
  });

  it("totalH = suma (nagłówek + rzędy) wszystkich pasów + odstępy między nimi", () => {
    const l = layoutPyramid(place([n("a", "basic"), n("b", "expert")]), M);
    // dwa pasy po (20 + 1*100) + jeden odstęp 10
    expect(l.totalH).toBe(20 + 100 + 10 + 20 + 100);
  });

  it("pasy nie nachodzą na siebie i idą od góry w dół", () => {
    const l = layoutPyramid(place([n("a", "basic"), n("b", "intermediate"), n("c", "expert")]), M);
    for (let i = 1; i < l.bands.length; i++) {
      expect(l.bands[i]!.y).toBeGreaterThanOrEqual(l.bands[i - 1]!.y + l.bands[i - 1]!.h);
    }
  });

  it("pasy zwracane są od najwyższego tieru (góra planszy) do najniższego", () => {
    const l = layoutPyramid(place([n("a", "basic"), n("b", "expert")]), M);
    expect(l.bands.map((b) => b.tier)).toEqual(["expert", "basic"]);
  });

  it("płyty są pełnej szerokości — geometria nie niesie już wcięcia", () => {
    const l = layoutPyramid(place([n("a", "basic"), n("b", "intermediate")]), M);
    for (const b of l.bands) {
      expect(b).not.toHaveProperty("x0");
      expect(b).not.toHaveProperty("x1");
    }
  });

  it("boardCols przechodzi z rozstawienia bez zmian", () => {
    const p = place([n("a", "basic"), n("b", "basic"), n("c", "basic")]);
    expect(layoutPyramid(p, M).boardCols).toBeCloseTo(p.boardCols, 6);
  });

  it("cardHalfW mieści się w połowie slotu — inaczej karty nachodziłyby na siebie", () => {
    const p = place([n("a", "basic"), n("b", "basic"), n("c", "basic")]);
    const l = layoutPyramid(p, M);
    expect(l.cardHalfW).toBeGreaterThan(0);
    expect(l.cardHalfW).toBeLessThan(VIEW_W / p.boardCols / 2);
  });
});

describe("layoutPyramid — środki węzłów", () => {
  it("każdy węzeł dostaje środek", () => {
    const nodes = [n("a", "basic"), n("b", "intermediate"), n("c", "expert")];
    const l = layoutPyramid(place(nodes), M);
    for (const node of nodes) expect(l.centers.get(node.id)).toBeDefined();
  });

  it("pojedynczy węzeł siedzi w środku planszy", () => {
    const l = layoutPyramid(place([n("a", "basic")]), M);
    expect(l.centers.get("a")!.x).toBeCloseTo(VIEW_W / 2, 6);
  });

  it("węzły w rzędzie mają rosnące x i są symetryczne względem środka planszy", () => {
    const l = layoutPyramid(place([n("a", "basic", "A"), n("b", "basic", "B")]), M);
    const xa = l.centers.get("a")!.x;
    const xb = l.centers.get("b")!.x;
    expect(xa).toBeLessThan(xb);
    expect(xa + xb).toBeCloseTo(VIEW_W, 6);
  });

  it("podrząd 0 leży NIŻEJ (większe y) niż podrząd 1 w tym samym pasie", () => {
    const nodes = [n("dip", "basic", "Dip"), n("pull", "basic", "Pull-up")];
    const edges: Edge[] = [{ from: "dip", requires: "pull" }];
    const l = layoutPyramid(place(nodes, edges), M);
    expect(l.centers.get("pull")!.y).toBeGreaterThan(l.centers.get("dip")!.y);
  });

  it("węzeł z wyższego tieru leży wyżej (mniejsze y) niż z niższego", () => {
    const l = layoutPyramid(place([n("a", "basic"), n("z", "expert")]), M);
    expect(l.centers.get("z")!.y).toBeLessThan(l.centers.get("a")!.y);
  });

  it("wszystkie środki mieszczą się w planszy", () => {
    const l = layoutPyramid(place(PROD_NODES, PROD_EDGES), M);
    for (const c of l.centers.values()) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(VIEW_W);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(l.totalH);
    }
  });

  it("karta nie wystaje poza planszę żadną krawędzią", () => {
    const l = layoutPyramid(place(PROD_NODES, PROD_EDGES), M);
    for (const c of l.centers.values()) {
      expect(c.x - l.cardHalfW).toBeGreaterThanOrEqual(0);
      expect(c.x + l.cardHalfW).toBeLessThanOrEqual(VIEW_W);
    }
  });
});

describe("DEFAULT_METRICS", () => {
  it("ma dodatnie wymiary", () => {
    expect(DEFAULT_METRICS.rowH).toBeGreaterThan(0);
    expect(DEFAULT_METRICS.bandHeaderH).toBeGreaterThan(0);
    expect(DEFAULT_METRICS.bandGap).toBeGreaterThan(0);
    expect(DEFAULT_METRICS.cardH).toBeGreaterThan(0);
  });
  it("rząd jest wyższy od karty — inaczej nie ma gdzie poprowadzić krawędzi", () => {
    // Przerwa musi pomieścić pasy poziomych odcinków (skill-pyramid-routing).
    expect(DEFAULT_METRICS.rowH - DEFAULT_METRICS.cardH).toBeGreaterThanOrEqual(30);
  });
});
