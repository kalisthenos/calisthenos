import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const KORZEN = join(process.cwd(), "app");
const STARE_CIASTKO = "__Host-kth_session";

function pliki(katalog: string): string[] {
  return readdirSync(katalog).flatMap((wpis) => {
    const sciezka = join(katalog, wpis);
    if (statSync(sciezka).isDirectory()) return pliki(sciezka);
    // Pliki testowe poza skanem, i to nie jest furtka: `api/session.test.ts`
    // KARMI `readSessionCookie` starym ciastkiem, żeby udowodnić, że nowy
    // czytnik je odrzuca. To strażnik dokładnie tego samego szwu, nie jego
    // naruszenie — a testy i tak nigdzie nie jadą. Zakaz dotyczy kodu, który
    // realnie obsłuży żądanie użytkownika.
    if (/\.test\.tsx?$/.test(wpis)) return [];
    return /\.(ts|tsx)$/.test(wpis) ? [sciezka] : [];
  });
}

/**
 * Komentarze wycięte PRZED szukaniem, i to jest istotne dla sensu tej bramki.
 * Zakaz dotyczy kodu, który stare ciastko czyta albo zapisuje — nie zdań,
 * które tłumaczą, czym nowe ciastko różni się od starego. Bramka wymuszająca
 * kasowanie takich zdań kupowałaby zieloność za cenę wiedzy.
 */
function bezKomentarzy(zrodlo: string): string {
  return zrodlo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("szew starej sesji — nic w app/ jej już nie dotyka", () => {
  it("znajduje pliki źródłowe", () => {
    // Bez tej asercji bramka przechodziłaby PUSTA, gdyby skan przestał
    // cokolwiek widzieć — dokładnie tak, jak stało się to w tym repozytorium
    // bramce skanującej `.claude/skills` po przeniesieniu katalogu: zero
    // plików, `expect([]).toEqual([])`, zielono i bez żadnej ochrony.
    expect(pliki(KORZEN).length).toBeGreaterThan(100);
  });

  it("stare ciastko nie występuje w KODZIE — komentarze o nim wolno pisać", () => {
    // Krok 2 Etapu 2 usuwa starą sesję bazodanową. „Usunęliśmy" jest
    // twierdzeniem; ta bramka czyni je faktem — i pilnuje, żeby nie wróciła
    // tylnymi drzwiami przy przepinaniu kolejnych modułów. Do usunięcia
    // dopiero wtedy, gdy zniknie sama możliwość pomyłki, czyli po kroku 6.
    const winowajcy = pliki(KORZEN).filter((p) =>
      bezKomentarzy(readFileSync(p, "utf8")).includes(STARE_CIASTKO),
    );

    expect(winowajcy).toEqual([]);
  });
});
