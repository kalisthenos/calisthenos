import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Szew `app/lib` po integracji z BE — następca `no-direct-db.test.ts`.
 *
 * Dawna bramka pilnowała, żeby trasa nie sięgała do bazy. Baza z FE znika
 * (S6), więc zakaz traci przedmiot — ale sam szew zostaje i jest tym samym
 * szwem: trasa bierze dane z modułu `~/lib/*`, a moduł rozmawia z BE. Zmienia
 * się to, co leży po drugiej stronie szwu, nie to, gdzie on jest.
 *
 * Czego bramka zakazuje: wołania klienta wprost z trasy — czy to przez fabrykę
 * i pomocniki z `~/lib/api/client`, czy przez funkcje SDK z pakietu kontraktu.
 * Trasa, która sama składa żądanie, omija mapowanie błędów modułu i rozsypuje
 * wiedzę o kontrakcie po katalogu tras — dokładnie to, przed czym szew chroni.
 *
 * Czego NIE zakazuje: `import type`. Typ DTO w propsach komponentu nie generuje
 * kodu w runtime i niczego nie woła — ta sama zasada, którą dawna bramka
 * stosowała do `import type` ze schematu bazy. Wolno też brać resztę
 * `~/lib/api/*` (`requireUser`, `ApiError`, `toRouteResponse`, ciastko sesji):
 * to jest infrastruktura żądania, nie dostęp do danych.
 */
const KORZEN_TRAS = join(process.cwd(), "app", "routes");

// Poza katalogiem tras skanujemy dwa pliki wejściowe — biegną na każdym
// żądaniu, więc zakaz obowiązuje je tak samo. Ta sama para, co w dawnej bramce.
const PLIKI_DODATKOWE = [
  join(process.cwd(), "app", "root.tsx"),
  join(process.cwd(), "app", "entry.server.tsx"),
];

/**
 * Import WARTOŚCI: statyczny bez słowa `type` albo dynamiczny. `[^;]` łapie też
 * importy wielolinijkowe — w liście specyfikatorów średnika nie ma.
 *
 * `import { type Foo } from …` (specyfikator typowy w imporcie wartościowym)
 * bramka liczy jako naruszenie i to jest świadome: kosztuje jedno słowo
 * poprawki, a reguła zostaje czytelna bez parsera TypeScriptu.
 */
const REGULY = [
  {
    modul: "~/lib/api/client",
    statyczny: /import\s+(?!type\s)[^;]*?from\s+["']~\/lib\/api\/client["']/,
    dynamiczny: /import\s*\(\s*["']~\/lib\/api\/client["']/,
  },
  {
    modul: "@kalisthenos/api-client",
    statyczny: /import\s+(?!type\s)[^;]*?from\s+["']@kalisthenos\/api-client["']/,
    dynamiczny: /import\s*\(\s*["']@kalisthenos\/api-client["']/,
  },
] as const;

type Regula = (typeof REGULY)[number];

function pliki(katalog: string): string[] {
  return readdirSync(katalog).flatMap((wpis) => {
    const sciezka = join(katalog, wpis);
    if (statSync(sciezka).isDirectory()) return pliki(sciezka);
    // Testy poza skanem: test trasy CELOWO buduje klienta z podstawionym
    // transportem, żeby udowodnić, czym trasa karmi moduł. Ta bramka też jest
    // testem i inaczej łapałaby samą siebie za literały wyżej.
    if (/\.test\.tsx?$/.test(wpis)) return [];
    return /\.(ts|tsx)$/.test(wpis) ? [sciezka] : [];
  });
}

/**
 * Komentarze wycięte PRZED szukaniem — zakaz dotyczy importów, nie zdań
 * tłumaczących, dokąd wywołanie poszło. Bramka wymuszająca kasowanie takich
 * zdań kupowałaby zieloność za cenę wiedzy (wzorzec z `no-google-lib.test.ts`).
 */
function bezKomentarzy(zrodlo: string): string {
  return zrodlo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function importujeWartosc(zrodlo: string, regula: Regula): boolean {
  return regula.statyczny.test(zrodlo) || regula.dynamiczny.test(zrodlo);
}

describe("szew app/lib — trasy nie wołają klienta wprost", () => {
  const skanowane = [...pliki(KORZEN_TRAS), ...PLIKI_DODATKOWE];

  it("znajduje pliki tras", () => {
    // Bez tej asercji bramka przechodziłaby PUSTA, gdyby skan przestał
    // cokolwiek widzieć — tak właśnie umarła w ciszy bramka skanująca
    // `.claude/skills` po przeniesieniu katalogu: zero plików, zielono,
    // zero ochrony.
    expect(skanowane.length).toBeGreaterThan(50);
  });

  it.each(REGULY)("żadna trasa nie importuje wartości z $modul", (regula) => {
    const winowajcy = skanowane.filter((p) =>
      importujeWartosc(bezKomentarzy(readFileSync(p, "utf8")), regula),
    );

    expect(winowajcy).toEqual([]);
  });

  // Reguła sprawdzana na atrapach, nie tylko na drzewie. Bramka, która dziś nie
  // ma czego złapać, jest nie do odróżnienia od bramki zepsutej — chyba że
  // pokaże, że łapie, gdy jest co.
  it("reguła łapie import wartości i przepuszcza import typu", () => {
    const [klient, sdk] = REGULY;

    expect(
      importujeWartosc('import { invitesControllerPreview } from "@kalisthenos/api-client";', sdk),
    ).toBe(true);
    expect(
      importujeWartosc('import {\n  createApiClient,\n} from "~/lib/api/client";', klient),
    ).toBe(true);
    expect(importujeWartosc('const m = await import("@kalisthenos/api-client");', sdk)).toBe(true);
    expect(
      importujeWartosc('import type { PlanStatusCounts } from "@kalisthenos/api-client";', sdk),
    ).toBe(false);
    expect(importujeWartosc('import { requireUser } from "~/lib/api/auth";', klient)).toBe(false);
  });
});
