import { describe, expect, it } from "vitest";
import { type ShotTarget, parseShotArgs, selectTargets, slugForPath } from "./shots-lib";

describe("slugForPath", () => {
  it("zamienia ścieżkę na slug z podkreśleniami", () => {
    expect(slugForPath("/trener/biblioteka")).toBe("trener_biblioteka");
  });
  it("obsługuje pojedynczy segment", () => {
    expect(slugForPath("/trener")).toBe("trener");
  });
  it("korzeń '/' to 'root'", () => {
    expect(slugForPath("/")).toBe("root");
  });
  it("ścina końcowy slash i zamienia kropki w segmentach na podkreślenia", () => {
    expect(slugForPath("/trener/biblioteka.nowe/")).toBe("trener_biblioteka_nowe");
  });
  it("zwija powtórzone slashe", () => {
    expect(slugForPath("//trener///biblioteka")).toBe("trener_biblioteka");
  });
});

describe("parseShotArgs", () => {
  it("brak argów → null (pełny przebieg)", () => {
    expect(parseShotArgs([])).toBeNull();
  });
  it("zwraca podane ścieżki", () => {
    expect(parseShotArgs(["/trener", "/trener/biblioteka"])).toEqual([
      "/trener",
      "/trener/biblioteka",
    ]);
  });
  it("dopisuje wiodący slash i ignoruje flagi", () => {
    expect(parseShotArgs(["trener", "--foo"])).toEqual(["/trener"]);
  });
});

describe("selectTargets", () => {
  const manifest: ShotTarget[] = [
    { path: "/trener", role: "trainer" },
    { path: "/trener/biblioteka", role: "trainer" },
    { path: "/podopieczny", role: "trainee" },
  ];

  it("pełny przebieg: tylko trasy zalogowanej roli, reszta do skipped", () => {
    const { targets, skipped } = selectTargets({ manifest, paths: null, role: "trainer" });
    expect(targets.map((t) => t.path)).toEqual(["/trener", "/trener/biblioteka"]);
    expect(skipped.map((t) => t.path)).toEqual(["/podopieczny"]);
  });

  it("on-demand: ścieżka z manifestu dziedziczy rolę z manifestu", () => {
    const { targets, skipped } = selectTargets({
      manifest,
      paths: ["/podopieczny"],
      role: "trainer",
    });
    expect(targets).toEqual([]);
    expect(skipped).toEqual([{ path: "/podopieczny", role: "trainee" }]);
  });

  it("on-demand: ścieżka spoza manifestu dostaje rolę zalogowaną i trafia do targets", () => {
    const { targets } = selectTargets({
      manifest,
      paths: ["/trener/plany"],
      role: "trainer",
    });
    expect(targets).toEqual([{ path: "/trener/plany", role: "trainer" }]);
  });
});
