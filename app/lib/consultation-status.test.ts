import type { ConsultationView } from "@kalisthenos/api-client";
import { describe, expect, it } from "vitest";
import { type ConsultationTone, mostUrgentTone, presentationFor } from "~/lib/consultation-status";

/** Kształt `presentation` z kontraktu; `tone` serwera nie jest tu czytany. */
const key = (k: string): ConsultationView["presentation"] =>
  ({ key: k, tone: "neutral" }) as ConsultationView["presentation"];

describe("presentationFor — plakietka z klucza serwera, nie z własnej tabeli", () => {
  it("odwzorowuje klucze, które kontrakt niesie dziś", () => {
    expect(presentationFor(key("planned"))).toEqual({
      label: "zaplanowany",
      tone: "scheduled",
    });
    expect(presentationFor(key("confirmed"))).toEqual({
      label: "potwierdzony",
      tone: "confirmed",
    });
    expect(presentationFor(key("change_requested"))).toEqual({
      label: "prośba o zmianę",
      tone: "change",
    });
    expect(presentationFor(key("cancelled"))).toEqual({
      label: "odwołany",
      tone: "cancelled",
    });
    expect(presentationFor(key("documented"))).toEqual({
      label: "udokumentowany",
      tone: "done",
    });
  });

  /**
   * D-FE-4. Do 2026-09-21 etykieta zależała od roli: ten sam `planned` był
   * „zaplanowany" u trenera i „do potwierdzenia" u podopiecznego — wprost wbrew
   * `docs/02` §5, który wspólną prezentację podnosi do rangi niezmiennika.
   * Funkcja nie ma już parametru roli, więc złamanie tego jest dziś
   * niewyrażalne — i to jest mocniejsza obrona niż asercja.
   */
  it("nie ma jak zwrócić dwóch etykiet dla jednego klucza", () => {
    expect(presentationFor(key("planned"))).toEqual(presentationFor(key("planned")));
    expect(presentationFor.length).toBe(1);
  });

  /**
   * Klucze fazy terminu — obsługiwane ZANIM pojawią się w typach pakietu.
   * Backend zaczyna je zwracać po wydaniu rozszerzającym (ADR-0042), a klient
   * ma je rozumieć od pierwszej odpowiedzi, nie od kolejnego podbicia.
   */
  it("zna klucze fazy, choć nie ma ich jeszcze w typach klienta", () => {
    expect(presentationFor(key("in_progress"))).toEqual({
      label: "trwa teraz",
      tone: "confirmed",
    });
    // `planned_past` i `confirmed_past` dzielą etykietę świadomie: dla trenera
    // znaczą to samo — spotkanie się odbyło i czeka na dokumentację.
    expect(presentationFor(key("confirmed_past"))).toEqual(presentationFor(key("planned_past")));
  });

  /**
   * **Zobowiązanie z ADR-0042, nie ostrożność.** `presentation.key` jest
   * w kontrakcie zadeklarowany jako `x-extensible-enum` — zbiór, który ma rosnąć
   * — a w zamian konsument obowiązuje się obsłużyć wartość nieznaną. Bez tej
   * gałęzi pierwsza nowa wartość oddałaby `undefined` i wywróciła render;
   * wyczerpujący `Record` po unii z pakietu wyglądałby przy tym na poprawny.
   */
  it("klucz nieznany daje plakietkę zapasową, nie `undefined`", () => {
    const nieznany = presentationFor(key("cos_czego_ten_klient_nie_zna"));

    expect(nieznany).toBeDefined();
    expect(nieznany.label).toBe("termin");
    expect(TONY).toContain(nieznany.tone);
  });
});

const TONY: ConsultationTone[] = [
  "scheduled",
  "pending",
  "confirmed",
  "change",
  "cancelled",
  "done",
];

describe("mostUrgentTone", () => {
  it("wybiera najważniejszy ton (pending > confirmed > done)", () => {
    const tones: ConsultationTone[] = ["done", "confirmed", "pending"];
    expect(mostUrgentTone(tones)).toBe("pending");
    expect(mostUrgentTone(["confirmed", "done"])).toBe("confirmed");
    expect(mostUrgentTone(["scheduled", "done"])).toBe("scheduled");
  });
  it("zwraca null dla pustej listy", () => {
    expect(mostUrgentTone([])).toBeNull();
  });
});
