import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const KORZEN = join(process.cwd(), "app");
const USUNIETY_KATALOG = "~/lib/google";

function pliki(katalog: string): string[] {
  return readdirSync(katalog).flatMap((wpis) => {
    const sciezka = join(katalog, wpis);
    if (statSync(sciezka).isDirectory()) return pliki(sciezka);
    // Pliki testowe poza skanem — inaczej ta bramka łapie samą siebie:
    // `USUNIETY_KATALOG` musi gdzieś w kodzie istnieć jako zwykły literał,
    // żeby było czego szukać w innych plikach. Ten sam wzorzec, co w
    // `no-stara-sesja.test.ts`.
    if (/\.test\.tsx?$/.test(wpis)) return [];
    return /\.(ts|tsx)$/.test(wpis) ? [sciezka] : [];
  });
}

/**
 * Komentarze wycięte PRZED szukaniem — zakaz dotyczy importów, nie zdań
 * tłumaczących, dokąd ten katalog poszedł. Bramka wymuszająca kasowanie
 * takich zdań kupowałaby zieloność za cenę wiedzy. Ten sam wzorzec, co
 * w `no-stara-sesja.test.ts`.
 */
function bezKomentarzy(zrodlo: string): string {
  return zrodlo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("kalendarz zewnętrzny — nic w app/ nie sięga po usunięty katalog", () => {
  it("znajduje pliki źródłowe", () => {
    // Bez tej asercji bramka przechodziłaby PUSTA, gdyby skan przestał
    // cokolwiek widzieć — dokładnie tak, jak stało się bramce skanującej
    // `.claude/skills` po przeniesieniu katalogu: zero plików, zielono
    // i bez żadnej ochrony.
    expect(pliki(KORZEN).length).toBeGreaterThan(100);
  });

  it("import z ~/lib/google nie występuje w KODZIE", () => {
    const winowajcy = pliki(KORZEN).filter((p) =>
      bezKomentarzy(readFileSync(p, "utf8")).includes(USUNIETY_KATALOG),
    );

    expect(winowajcy).toEqual([]);
  });
});
