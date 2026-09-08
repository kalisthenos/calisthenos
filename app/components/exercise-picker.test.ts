// app/components/exercise-picker.test.ts — .ts, nie .tsx: nic tu nie renderuje.
// Test WYŁĄCZNIE dla `filterExercises`, czystej funkcji wydzielonej z komponentu —
// granica wyjaśniona w docblocku `exercise-picker.tsx`.
import { describe, expect, it } from "vitest";
import { filterExercises } from "./exercise-picker";

const ex = (id: string, name: string) => ({ id, name, unit: "REPS" as const, tracksRpe: true });

describe("filterExercises", () => {
  it("filtruje po nazwie, bez względu na wielkość liter", () => {
    const lista = [ex("a", "Podciąganie"), ex("b", "Deska")];
    expect(filterExercises(lista, "desk").map((e) => e.name)).toEqual(["Deska"]);
  });

  it("odsiewa ćwiczenie, które właśnie zastępujemy", () => {
    const lista = [ex("a", "Podciąganie"), ex("b", "Deska")];
    expect(filterExercises(lista, "", ["b"]).map((e) => e.name)).toEqual(["Podciąganie"]);
  });

  it("pusta szukajka oddaje całość, nie pustkę", () => {
    const lista = [ex("a", "Podciąganie"), ex("b", "Deska")];
    expect(filterExercises(lista, "  ")).toHaveLength(2);
  });
});
