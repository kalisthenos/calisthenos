import { describe, expect, it } from "vitest";
import {
  API_SESSION_COOKIE,
  buildSessionCookie,
  clearSessionCookie,
  needsRefresh,
  readSessionCookie,
  sessionFromTokens,
} from "./session";

const TOKENY = {
  accessToken: "access.jwt.abc",
  refreshToken: "refresh-opaque-xyz",
  expiresIn: 900,
};

const TERAZ = new Date("2026-09-01T10:00:00.000Z");

describe("sessionFromTokens", () => {
  it("zamienia `expiresIn` w sekundach na moment bezwzględny", () => {
    // BE oddaje długość życia, nie moment. Trzymanie długości byłoby
    // bezużyteczne przy następnym żądaniu — nie wiadomo, od kiedy liczyć.
    const sesja = sessionFromTokens(TOKENY, TERAZ);

    expect(sesja.accessExpiresAt).toBe(TERAZ.getTime() + 900_000);
    expect(sesja.accessToken).toBe("access.jwt.abc");
    expect(sesja.refreshToken).toBe("refresh-opaque-xyz");
  });
});

describe("ciastko sesji", () => {
  it("przenosi całą sesję tam i z powrotem", () => {
    const sesja = sessionFromTokens(TOKENY, TERAZ);

    const odczytane = readSessionCookie(
      `${API_SESSION_COOKIE}=${wartoscCiastka(buildSessionCookie(sesja))}`,
    );

    expect(odczytane).toEqual(sesja);
  });

  it("spełnia wymogi prefiksu `__Host-`", () => {
    // Przeglądarka odrzuci ciastko `__Host-` bez `Secure`, z `Domain` albo ze
    // ścieżką inną niż `/`. Odrzuci je po cichu, więc objawem byłoby
    // wylogowanie bez powodu, nie błąd.
    const ciastko = buildSessionCookie(sessionFromTokens(TOKENY, TERAZ));

    expect(API_SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(ciastko).toContain("Path=/");
    expect(ciastko).toContain("Secure");
    expect(ciastko).toContain("HttpOnly");
    expect(ciastko).not.toContain("Domain=");
  });

  it("nie żyje dłużej niż sesja w BE", () => {
    // `SESSION_TTL_S` w BE to 30 dni. Ciastko przeżywające token odświeżający
    // daje użytkownikowi ekran ładowania zakończony wylogowaniem zamiast
    // ekranu logowania.
    expect(buildSessionCookie(sessionFromTokens(TOKENY, TERAZ))).toContain("Max-Age=2592000");
  });

  it("kasowanie unieważnia ciastko natychmiast", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});

describe("readSessionCookie — wejście, którego nie kontrolujemy", () => {
  it.each([
    ["brak nagłówka", null],
    ["pusty nagłówek", ""],
    ["obce ciastka", "inne=1; jeszcze_inne=2"],
    ["nasza nazwa, śmieć w środku", `${API_SESSION_COOKIE}=%%%nie-base64%%%`],
    ["nasza nazwa, poprawny base64 nie-JSON", `${API_SESSION_COOKIE}=YWJj`],
    ["JSON bez tokenów", `${API_SESSION_COOKIE}=${btoa('{"a":1}')}`],
    ["ciastko sesji sprzed integracji", "__Host-kth_session=stary-identyfikator"],
  ])("%s → null, bez wyjątku", (_opis, naglowek) => {
    // Każde z tych wejść jest osiągalne z przeglądarki. Wyjątek w tym miejscu
    // biegnie przez middleware, czyli przez KAŻDE żądanie — 500 zamiast
    // przekierowania na logowanie.
    expect(readSessionCookie(naglowek)).toBeNull();
  });
});

describe("needsRefresh", () => {
  const sesja = sessionFromTokens(TOKENY, TERAZ);

  it("nie odświeża tokenu z zapasem czasu", () => {
    expect(needsRefresh(sesja, new Date(TERAZ.getTime() + 60_000))).toBe(false);
  });

  it("odświeża token już wygasły", () => {
    expect(needsRefresh(sesja, new Date(TERAZ.getTime() + 901_000))).toBe(true);
  });

  it("odświeża token wygasający ZA CHWILĘ", () => {
    // Sedno marginesu: token ważny jeszcze dwie sekundy zdąży wygasnąć
    // w locie, między wysłaniem żądania a jego obsługą w BE. Bez marginesu
    // reaktywna ścieżka `401` przestaje być wyjątkiem i staje się normą przy
    // każdym żądaniu trafiającym w koniec okna.
    expect(needsRefresh(sesja, new Date(TERAZ.getTime() + 898_000))).toBe(true);
  });
});

/** Sama wartość ciastka, bez atrybutów — tak, jak odda ją przeglądarka. */
function wartoscCiastka(setCookie: string): string {
  const [para = ""] = setCookie.split(";");
  return para.split("=").slice(1).join("=");
}
