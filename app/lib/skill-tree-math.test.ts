import { describe, expect, it } from "vitest";
import {
  type Edge,
  assignLayers,
  nodeState,
  orderWithinLayer,
  topoOrder,
  wouldCreateCycle,
} from "./skill-tree-math";

describe("wouldCreateCycle", () => {
  it("blokuje pętlę własną", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });
  it("pozwala na pierwszą krawędź", () => {
    expect(wouldCreateCycle([], "a", "b")).toBe(false);
  });
  it("blokuje krawędź zwrotną (b wymaga a, gdy a wymaga b)", () => {
    const edges: Edge[] = [{ from: "a", requires: "b" }];
    expect(wouldCreateCycle(edges, "b", "a")).toBe(true);
  });
  it("blokuje cykl pośredni a->b->c, dodanie c->a", () => {
    const edges: Edge[] = [
      { from: "a", requires: "b" },
      { from: "b", requires: "c" },
    ];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });
  it("pozwala na gałąź bez domknięcia", () => {
    const edges: Edge[] = [
      { from: "a", requires: "b" },
      { from: "a", requires: "c" },
    ];
    expect(wouldCreateCycle(edges, "d", "a")).toBe(false);
  });
});

describe("assignLayers", () => {
  it("łańcuch dostaje rosnące warstwy", () => {
    const edges: Edge[] = [
      { from: "b", requires: "a" },
      { from: "c", requires: "b" },
    ];
    const layers = assignLayers(["a", "b", "c"], edges);
    expect(layers.get("a")).toBe(0);
    expect(layers.get("b")).toBe(1);
    expect(layers.get("c")).toBe(2);
  });
  it("węzeł z dwoma prerekami na różnych głębokościach bierze max", () => {
    const edges: Edge[] = [
      { from: "b", requires: "a" },
      { from: "d", requires: "a" },
      { from: "d", requires: "b" },
    ];
    const layers = assignLayers(["a", "b", "d"], edges);
    expect(layers.get("d")).toBe(2); // max(layer a=0, layer b=1) + 1
  });
  it("izolowany węzeł jest korzeniem", () => {
    expect(assignLayers(["x"], []).get("x")).toBe(0);
  });
});

describe("nodeState", () => {
  it("mastered gdy ma zdarzenia i na szczycie", () => {
    expect(nodeState({ hasEvents: true, atTopVariation: true, prereqStates: [] })).toBe("mastered");
  });
  it("in_progress gdy ma zdarzenia, nie na szczycie", () => {
    expect(nodeState({ hasEvents: true, atTopVariation: false, prereqStates: [] })).toBe(
      "in_progress",
    );
  });
  it("available gdy brak zdarzeń i wszystkie prereki mastered", () => {
    expect(
      nodeState({
        hasEvents: false,
        atTopVariation: false,
        prereqStates: ["mastered", "mastered"],
      }),
    ).toBe("available");
  });
  it("locked gdy brak zdarzeń i jakiś prereq nie-mastered", () => {
    expect(
      nodeState({
        hasEvents: false,
        atTopVariation: false,
        prereqStates: ["mastered", "in_progress"],
      }),
    ).toBe("locked");
  });
  it("korzeń bez zdarzeń jest available (brak prereków)", () => {
    expect(nodeState({ hasEvents: false, atTopVariation: false, prereqStates: [] })).toBe(
      "available",
    );
  });
});

describe("orderWithinLayer", () => {
  it("sortuje po nazwie locale pl", () => {
    const names = new Map([
      ["1", "Łokieć"],
      ["2", "Antagonista"],
      ["3", "Zwis"],
    ]);
    expect(orderWithinLayer(["1", "2", "3"], names)).toEqual(["2", "1", "3"]);
  });
});

describe("topoOrder", () => {
  it("prerekwizyty przed zależnymi", () => {
    const edges: Edge[] = [
      { from: "c", requires: "a" },
      { from: "c", requires: "b" },
    ];
    const order = topoOrder(["a", "b", "c"], edges);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });
});
