import { SKILL_TIERS, type SkillTier } from "~/lib/skill-tier";
import { type Edge, orderWithinLayer } from "~/lib/skill-tree-math";

/**
 * Układ piramidy umiejętności: przypisanie pasów/podrzędów + geometria planszy.
 * Wszystko czyste i deterministyczne — bez DOM, bez DB, bezpieczne w SSR.
 *
 * MODEL WSPÓŁRZĘDNYCH
 * -------------------
 * Oś X jest znormalizowana do 0..VIEW_W i rozciągana na szerokość planszy
 * (SVG z preserveAspectRatio="none", karty pozycjonowane w procentach).
 * Oś Y jest w PIKSELACH i mapuje się 1:1 — dzięki temu końce beziera zawsze
 * trafiają w środki kart, niezależnie od szerokości ekranu.
 */

export interface PyramidNodeInput {
  id: string;
  name: string;
  tier: SkillTier;
}

export interface PyramidBand {
  tier: SkillTier;
  /** Od dołu pasa: rows[0] = podrząd 0. Każdy rząd posortowany po nazwie (locale pl). */
  rows: string[][];
}

/** Mapa: węzeł → jego prereki leżące w TYM SAMYM pasie (tylko one tworzą podrzędy). */
function sameBandPrereqs(nodes: PyramidNodeInput[], edges: Edge[]): Map<string, string[]> {
  const tierById = new Map(nodes.map((n) => [n.id, n.tier]));
  const m = new Map<string, string[]>();
  for (const e of edges) {
    const fromTier = tierById.get(e.from);
    const reqTier = tierById.get(e.requires);
    // Krawędź dotykająca węzła spoza wejścia (np. zarchiwizowanego) — pomijamy.
    if (fromTier === undefined || reqTier === undefined) continue;
    // Międzypasowa (w tym odwrócona) — nie tworzy podrzędu, patrz spec §4.2.
    if (fromTier !== reqTier) continue;
    const arr = m.get(e.from) ?? [];
    arr.push(e.requires);
    m.set(e.from, arr);
  }
  return m;
}

/** Głębokość w obrębie pasa: bez prereków w pasie = 0, inaczej max(prereq) + 1. */
function subRowDepths(ids: string[], prereqs: Map<string, string[]>): Map<string, number> {
  const inScope = new Set(ids);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  function d(id: string): number {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // guard na nieoczekiwany cykl
    visiting.add(id);
    let best = 0;
    for (const p of prereqs.get(id) ?? []) {
      if (!inScope.has(p)) continue;
      best = Math.max(best, d(p) + 1);
    }
    visiting.delete(id);
    depth.set(id, best);
    return best;
  }
  for (const id of ids) d(id);
  return depth;
}

/** Pasy piramidy — tylko niepuste, rosnąco od `basic`. */
export function buildPyramid(nodes: PyramidNodeInput[], edges: Edge[]): PyramidBand[] {
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const prereqs = sameBandPrereqs(nodes, edges);

  const out: PyramidBand[] = [];
  for (const tier of SKILL_TIERS) {
    // .sort() domyka determinizm: gdyby dwie umiejętności miały tę samą nazwę,
    // orderWithinLayer (sort stabilny) zostawiłby o kolejności decydować bazie.
    const ids = nodes
      .filter((n) => n.tier === tier)
      .map((n) => n.id)
      .sort();
    if (ids.length === 0) continue; // pusty pas nie jest renderowany
    const depths = subRowDepths(ids, prereqs);
    const maxDepth = Math.max(...ids.map((id) => depths.get(id) ?? 0));
    const rows: string[][] = [];
    for (let d = 0; d <= maxDepth; d++) {
      rows.push(
        orderWithinLayer(
          ids.filter((id) => (depths.get(id) ?? 0) === d),
          nameById,
        ),
      );
    }
    // Guard antycyklowy w subRowDepths może zostawić dziurę w numeracji głębokości,
    // a wtedy layoutPyramid zarezerwowałby pusty rząd. Dla poprawnego DAG-u ten
    // filtr jest no-opem: każda głębokość 0..maxDepth ma tam swojego mieszkańca.
    out.push({ tier, rows: rows.filter((r) => r.length > 0) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kolejność w rzędach i przydział kolumn
// ---------------------------------------------------------------------------

/**
 * Wynik porządkowania: te same pasy z rzędami ustawionymi rosnąco po x, pozycja
 * pozioma każdego węzła (w jednostkach szerokości karty) i szerokość planszy.
 */
export interface Placement {
  bands: PyramidBand[];
  /** Pozycja pozioma w jednostkach karty; ułamki są normalne (łańcuch trzyma kolumnę). */
  columnOf: Map<string, number>;
  /** Ile szerokości karty musi mieć plansza. */
  boardCols: number;
}

/** Ile razy powtarzamy parę zamiatań (w górę po prerekach, w dół po zależnych). */
const SWEEPS = 6;
/** Minimalny odstęp między środkami sąsiadów w rzędzie, w jednostkach karty. */
const MIN_GAP = 1;
/** Zaokrąglenie domykające determinizm: sumowanie w innej kolejności daje inne ~1e-16. */
const PRECISION = 1e6;

function pushInto(m: Map<string, string[]>, key: string, value: string): void {
  const arr = m.get(key);
  if (arr) arr.push(value);
  else m.set(key, [value]);
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Ustawia jedną warstwę: każdy węzeł ciągnie do średniej pozycji sąsiadów, potem
 * rozsuwamy warstwę do minimalnego odstępu i wracamy środkiem bloku na średnią
 * docelową — bez tego ostatniego kroku każda warstwa dryfowałaby w prawo.
 * Zwraca warstwę w nowej kolejności (rosnąco po x).
 */
function placeLayer(
  layer: string[],
  neighbors: Map<string, string[]>,
  x: Map<string, number>,
): string[] {
  if (layer.length === 0) return layer;
  const desired = new Map<string, number>();
  for (const id of layer) {
    const ns = neighbors.get(id) ?? [];
    desired.set(id, ns.length > 0 ? mean(ns.map((n) => x.get(n) ?? 0)) : (x.get(id) ?? 0));
  }
  // Sort stabilny (ES2019+): przy równym docelowym x zostaje dzisiejsza kolejność.
  const sorted = [...layer].sort((a, b) => desired.get(a)! - desired.get(b)!);
  const pos: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const want = desired.get(sorted[i]!)!;
    pos.push(i === 0 ? want : Math.max(want, pos[i - 1]! + MIN_GAP));
  }
  const shift = mean(sorted.map((id) => desired.get(id)!)) - mean(pos);
  sorted.forEach((id, i) => x.set(id, pos[i]! + shift));
  return sorted;
}

/** Najdłuższa ścieżka w górę od węzła — czyli jak daleko biegnie jeszcze rozwój. */
function heightsAbove(ids: string[], deps: Map<string, string[]>): Map<string, number> {
  const h = new Map<string, number>();
  const visiting = new Set<string>();
  function go(id: string): number {
    const cached = h.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // guard na nieoczekiwany cykl
    visiting.add(id);
    let best = 0;
    for (const d of deps.get(id) ?? []) best = Math.max(best, go(d) + 1);
    visiting.delete(id);
    h.set(id, best);
    return best;
  }
  for (const id of ids) go(id);
  return h;
}

/** Najkrótszy łańcuch, który warto prostować. Dwa węzły to jeszcze nie ścieżka rozwoju. */
const MIN_SEGMENT = 3;

/**
 * Prostuje kręgosłupy — ciągi, w których każdy węzeł ma dokładnie jeden prerekwizyt
 * i jest jego „dziedzicem": tym z zależnych, nad którym rozwój biegnie najdalej.
 * To one czytają się jako ścieżka (Handstand → press → HSPU → 90 degree HSPU), więc
 * muszą stać w jednej kolumnie; same zamiatania rozjeżdżają je o ułamek kolumny, bo
 * każde ogniwo ciągną również sąsiedzi z boku.
 *
 * Rozwidlenie bez kontynuacji (dwie zależne, obie bez własnych) zostaje nietknięte —
 * tam ładniej wygląda symetryczne rozejście się wokół prereka niż wyróżnianie jednej
 * gałęzi. Stąd próg `MIN_SEGMENT`.
 */
function straightenChains(
  layers: string[][],
  prereqs: Map<string, string[]>,
  deps: Map<string, string[]>,
  x: Map<string, number>,
): void {
  const heights = heightsAbove([...x.keys()], deps);

  // Dziedzic: spośród zależnych o dokładnie jednym prereku wygrywa ta, nad którą
  // łańcuch biegnie najdalej; remis rozstrzyga id, żeby wynik nie zależał od
  // kolejności krawędzi na wejściu.
  const heir = new Map<string, string>();
  for (const [from, ps] of prereqs) {
    if (ps.length !== 1) continue;
    const req = ps[0]!;
    const cur = heir.get(req);
    if (cur === undefined) {
      heir.set(req, from);
      continue;
    }
    const hNew = heights.get(from) ?? 0;
    const hCur = heights.get(cur) ?? 0;
    if (hNew > hCur || (hNew === hCur && from < cur)) heir.set(req, from);
  }

  const isHeir = new Set(heir.values());
  const segments: string[][] = [];
  for (const start of heir.keys()) {
    if (isHeir.has(start)) continue; // to nie jest początek łańcucha
    const seg = [start];
    const seen = new Set([start]);
    let cur = start;
    while (heir.has(cur)) {
      const next = heir.get(cur)!;
      if (seen.has(next)) break; // guard na nieoczekiwany cykl
      seg.push(next);
      seen.add(next);
      cur = next;
    }
    if (seg.length >= MIN_SEGMENT) segments.push(seg);
  }
  segments.sort((a, b) => a[0]!.localeCompare(b[0]!));

  for (const seg of segments) {
    const xs = seg.map((id) => x.get(id) ?? 0).sort((a, b) => a - b);
    const mid = xs.length / 2;
    const med = xs.length % 2 === 1 ? xs[Math.floor(mid)]! : (xs[mid - 1]! + xs[mid]!) / 2;
    for (const id of seg) x.set(id, med);
  }

  // Wyprostowanie mogło ścisnąć sąsiadów — minimalny odstęp jest inwariantem
  // twardszym niż pion łańcucha, więc egzekwujemy go na końcu.
  for (const layer of layers) {
    layer.sort((a, b) => (x.get(a) ?? 0) - (x.get(b) ?? 0));
    for (let i = 1; i < layer.length; i++) {
      const floor = (x.get(layer[i - 1]!) ?? 0) + MIN_GAP;
      if ((x.get(layer[i]!) ?? 0) < floor) x.set(layer[i]!, floor);
    }
  }
}

/**
 * Kolejność w rzędach i przydział kolumn — zastępuje sortowanie alfabetyczne.
 * Alfabet stawia obok siebie węzły, które nie mają ze sobą nic wspólnego, więc
 * każda zależność biegnie skosem przez planszę; barycentrum sąsiadów ustawia
 * łańcuchy w kolumnach i skraca poziome przebiegi krawędzi.
 */
export function orderAndPlace(
  bands: PyramidBand[],
  edges: Edge[],
  nameById: Map<string, string>,
): Placement {
  const layers: string[][] = [];
  for (const band of bands) for (const row of band.rows) layers.push([...row]);
  if (layers.length === 0) return { bands: [], columnOf: new Map(), boardCols: 1 };

  const inScope = new Set(layers.flat());
  const prereqs = new Map<string, string[]>();
  const deps = new Map<string, string[]>();
  for (const e of edges) {
    if (!inScope.has(e.from) || !inScope.has(e.requires)) continue;
    pushInto(prereqs, e.from, e.requires);
    pushInto(deps, e.requires, e.from);
  }
  // Kolejność list sąsiadów nie może zależeć od kolejności krawędzi na wejściu —
  // średnia liczona w innej kolejności daje inny ostatni bit.
  for (const arr of prereqs.values()) arr.sort();
  for (const arr of deps.values()) arr.sort();

  // Start: dzisiejsza kolejność alfabetyczna (buildPyramid już ją nadał), co domyka
  // determinizm przy węzłach o równym barycentrum.
  const x = new Map<string, number>();
  for (const layer of layers) {
    const ordered = orderWithinLayer(layer, nameById);
    ordered.forEach((id, i) => x.set(id, i));
  }

  for (let it = 0; it < SWEEPS; it++) {
    for (let L = 1; L < layers.length; L++) layers[L] = placeLayer(layers[L]!, prereqs, x);
    for (let L = layers.length - 2; L >= 0; L--) layers[L] = placeLayer(layers[L]!, deps, x);
  }
  straightenChains(layers, prereqs, deps, x);

  const min = Math.min(...x.values());
  for (const [id, v] of x) x.set(id, Math.round((v - min) * PRECISION) / PRECISION);
  const boardCols = Math.max(...x.values()) + 1;

  let k = 0;
  const out: PyramidBand[] = bands.map((band) => ({
    tier: band.tier,
    rows: band.rows.map(() => layers[k++]!),
  }));

  return { bands: out, columnOf: x, boardCols };
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

export const VIEW_W = 1000;

export interface PyramidMetrics {
  /** Wysokość jednego rzędu wizualnego, px. */
  rowH: number;
  /** Wysokość paska z nazwą tieru i licznikiem, px. */
  bandHeaderH: number;
  /** Odstęp między płytami pasów, px. */
  bandGap: number;
  /**
   * Nominalna wysokość karty, px. Krawędzie zaczepiają się o jej górną i dolną
   * krawędź, więc musi być mniejsza od `rowH` — w przerwie biegną poziome odcinki.
   */
  cardH: number;
}

/**
 * Przerwa `rowH - cardH` = 38 px mieści trzy pasy poziomych odcinków
 * (`skill-pyramid-routing`). `cardH` to przypadek najgorszy, czyli wąska karta
 * mobilna z nazwą łamaną do dwóch linii: pasek stanu + nazwa 2×16 + linia poziomu
 * + rowek + padding.
 */
export const DEFAULT_METRICS: PyramidMetrics = {
  rowH: 150,
  bandHeaderH: 34,
  bandGap: 18,
  cardH: 112,
};

/**
 * Pół szerokości karty jako ułamek slotu kolumny. CSS trzyma ten sam stosunek na
 * obu viewportach (desktop 240/280, mobile 116/136 — oba ≈ 0,855), więc połowa to
 * ≈ 0,428; bierzemy 0,43 z zapasem w górę, żeby prostokąt kolizji był nie węższy
 * niż realna karta. Korytarz krawędzi biegnie w połowie slotu (0,5), czyli mija
 * kartę z zapasem 0,03 slotu.
 */
export const CARD_HALF_RATIO = 0.43;

export interface PyramidBandBox {
  tier: SkillTier;
  /** Górna krawędź płyty i jej wysokość, px. Płyty są pełnej szerokości planszy. */
  y: number;
  h: number;
}

export interface PyramidLayout {
  totalH: number;
  /**
   * Ile szerokości karty musi mieć plansza — liczba zmiennoprzecinkowa. CSS używa
   * jej jako `calc(var(--pyramid-col) * boardCols)`.
   */
  boardCols: number;
  /** Od góry planszy (najwyższy tier) w dół. */
  bands: PyramidBandBox[];
  /** x w jednostkach VIEW_W, y w px. */
  centers: Map<string, { x: number; y: number }>;
  /** Pół szerokości karty w jednostkach VIEW_W — routing musi wiedzieć, gdzie kończy się karta. */
  cardHalfW: number;
}

/**
 * Geometria planszy. Płyty są pełnej szerokości — sylwetka schodkowej piramidy
 * została wycofana świadomie (spec 2026-07-25 §0): rzędy nie wykorzystywały
 * zarezerwowanego wcięcia, więc karty siedziały małe na pustych płytach.
 * Monumentalność niesie teraz masa warstwy, rzymski numer i atramentowy szczyt.
 */
export function layoutPyramid(
  placement: Placement,
  m: PyramidMetrics = DEFAULT_METRICS,
): PyramidLayout {
  const { bands, columnOf, boardCols } = placement;
  const slot = VIEW_W / boardCols;
  const boxes: PyramidBandBox[] = [];
  const centers = new Map<string, { x: number; y: number }>();
  let y = 0;

  // `bands` rośnie od basic, więc iteracja od końca idzie od góry planszy w dół.
  for (let i = bands.length - 1; i >= 0; i--) {
    const band = bands[i]!;
    const h = m.bandHeaderH + band.rows.length * m.rowH;
    boxes.push({ tier: band.tier, y, h });

    // Podrząd 0 na dole pasa → iterujemy rzędy od końca (najwyższy podrząd u góry).
    for (let r = 0; r < band.rows.length; r++) {
      const row = band.rows[band.rows.length - 1 - r]!;
      const rowCenterY = y + m.bandHeaderH + r * m.rowH + m.rowH / 2;
      for (const id of row) {
        centers.set(id, { x: ((columnOf.get(id) ?? 0) + 0.5) * slot, y: rowCenterY });
      }
    }

    y += h + m.bandGap;
  }

  return {
    totalH: Math.max(0, y - m.bandGap),
    boardCols,
    bands: boxes,
    centers,
    cardHalfW: CARD_HALF_RATIO * slot,
  };
}
