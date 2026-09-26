import { describe, expect, it } from "vitest";
import { type ListControlsSpec, buildControlHref, parseListControls } from "./list-params";

const spec: ListControlsSpec = {
  sortOptions: [
    { key: "newest", label: "Najnowsze" },
    { key: "name_asc", label: "Nazwa A–Z" },
  ],
  defaultSort: "newest",
  filterGroups: [
    {
      param: "status",
      label: "Status",
      options: [
        { value: "all", label: "Wszystkie" },
        { value: "active", label: "Aktywne" },
      ],
      defaultValue: "all",
    },
  ],
  searchable: true,
};

describe("parseListControls", () => {
  it("zwraca wartości domyślne dla pustych params", () => {
    const s = parseListControls(new URLSearchParams(), spec);
    expect(s).toEqual({ sort: "newest", filters: { status: "all" }, q: "" });
  });

  it("akceptuje poprawne wartości", () => {
    const sp = new URLSearchParams("sort=name_asc&status=active&q=  pull  ");
    const s = parseListControls(sp, spec);
    expect(s.sort).toBe("name_asc");
    expect(s.filters.status).toBe("active");
    expect(s.q).toBe("pull"); // przycięte
  });

  it("odrzuca nieznany sort i filtr do wartości domyślnej", () => {
    const sp = new URLSearchParams("sort=bogus&status=bogus");
    const s = parseListControls(sp, spec);
    expect(s.sort).toBe("newest");
    expect(s.filters.status).toBe("all");
  });

  it("ignoruje q gdy lista nie jest searchable", () => {
    const s = parseListControls(new URLSearchParams("q=abc"), { ...spec, searchable: false });
    expect(s.q).toBe("");
  });
});

describe("buildControlHref", () => {
  it("ustawia parametr i zawsze resetuje page", () => {
    const cur = new URLSearchParams("page=4&status=all&sort=newest");
    expect(buildControlHref(cur, { sort: "name_asc" })).toBe("?status=all&sort=name_asc");
  });

  it("usuwa parametr przy wartości null lub pustej i czyści page", () => {
    expect(buildControlHref(new URLSearchParams("status=active&page=2"), { status: null })).toBe(
      ".",
    );
    expect(buildControlHref(new URLSearchParams("status=active&q=x"), { status: "" })).toBe("?q=x");
  });

  it("zachowuje pozostałe parametry", () => {
    const cur = new URLSearchParams("q=pull&sort=newest");
    expect(buildControlHref(cur, { status: "active" })).toBe("?q=pull&sort=newest&status=active");
  });
});
