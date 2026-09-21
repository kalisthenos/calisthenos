import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bramka na D-FE-3: **trasa, która porównuje coś z `scheduledAt`, nie bierze
 * `Date.now()`**.
 *
 * `scheduledAt` opuszcza `~/lib/consultations` jako CZAS ŚCIENNY zapisany
 * w komponentach UTC (`toAppWallClock`), a `Date.now()` jest PRAWDZIWYM
 * momentem. Porównanie jednego z drugim myli się dokładnie o offset strefy —
 * dwie godziny latem, godzinę zimą — i przez to spotkanie sprzed półtorej
 * godziny siedziało latem w sekcji „Nadchodzące”, a etykieta
 * „do udokumentowania” zapalała się u trenera z dwugodzinnym opóźnieniem.
 * Właściwym źródłem jest `appWallClockNow()` z tego samego modułu.
 *
 * **Dlaczego bramka strukturalna, a nie test zachowania.** Sama funkcja
 * `consultationPresentation` była poprawna — myliły się jej WOŁAJĄCE, w pięciu
 * miejscach naraz. Testy tamtej funkcji przechodziły i przechodzą, bo operują
 * na datach oddalonych o dni, a pomyłka jest rzędu godzin. Objaw jest więc
 * niewidoczny dla testu jednostkowego obu stron z osobna i widoczny wyłącznie
 * w tym, CZYM trasa karmi moduł — dokładnie jak szew z `no-direct-api.test.ts`,
 * którego kształt ta bramka powtarza.
 *
 * ── CZEGO TA BRAMKA NIE ŁAPIE ────────────────────────────────────────────────
 *
 * **`new Date().getTime()` i `performance.now()`** — ten sam błąd innym
 * zapisem. Zakaz jest wąski celowo: `new Date()` jest w tych trasach używane
 * poprawnie i często (`nowISO: new Date().toISOString()` idzie do BE jako
 * MOMENT i przeliczać go NIE WOLNO), więc reguła zakazująca go łapałaby
 * głównie kod zdrowy. Pomyłka w tę stronę uczy obchodzenia bramek.
 *
 * **Pomyłkę odwrotną** — przeliczenie na czas ścienny czegoś, co ma zostać
 * momentem, zanim pojedzie do BE. To jest ta sama klasa i nikt jej nie pilnuje.
 *
 * **Komponenty poza `app/routes/`**, które dostają `scheduledAt` propsem.
 * Dziś żaden nie liczy sam „teraz”; gdy zacznie, skan trzeba rozszerzyć.
 */
const KORZEN_TRAS = join(process.cwd(), "app", "routes");

/** Moment liczony surowo — jedyna postać, której ta bramka zakazuje. */
const SUROWE_TERAZ = /Date\s*\.\s*now\s*\(\s*\)/;

/** Obecność tej nazwy znaczy, że plik pracuje na konwencji czasu ściennego. */
const CZAS_SCIENNY = /scheduledAt/;

function pliki(katalog: string): string[] {
  return readdirSync(katalog).flatMap((wpis) => {
    const sciezka = join(katalog, wpis);
    if (statSync(sciezka).isDirectory()) return pliki(sciezka);
    // Testy poza skanem — tak samo jak w `no-direct-api.test.ts`: test trasy
    // celowo buduje własne „teraz”, a ta bramka inaczej łapałaby samą siebie
    // za literały wyżej.
    if (/\.test\.tsx?$/.test(wpis)) return [];
    return /\.(ts|tsx)$/.test(wpis) ? [sciezka] : [];
  });
}

/**
 * Komentarze wycięte PRZED szukaniem. Zakaz dotyczy kodu, nie zdań
 * tłumaczących, dlaczego `Date.now()` stąd zniknęło — a takie zdania w tych
 * trasach stoją i mają stać. Bramka wymuszająca ich skasowanie kupowałaby
 * zieloność za cenę wiedzy (wzorzec z `no-google-lib.test.ts`).
 */
function bezKomentarzy(zrodlo: string): string {
  return zrodlo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function laczyKonwencje(zrodlo: string): boolean {
  const kod = bezKomentarzy(zrodlo);
  return CZAS_SCIENNY.test(kod) && SUROWE_TERAZ.test(kod);
}

describe("konwencja czasu — trasa z `scheduledAt` nie liczy „teraz” surowo", () => {
  const skanowane = pliki(KORZEN_TRAS);

  it("znajduje pliki tras", () => {
    // Bez tej asercji bramka przechodziłaby PUSTA, gdyby skan przestał
    // cokolwiek widzieć — ten sam kanarek, co w `no-direct-api.test.ts`.
    expect(skanowane.length).toBeGreaterThan(50);
  });

  it("żadna trasa nie miesza `scheduledAt` z `Date.now()`", () => {
    const winowajcy = skanowane.filter((p) => laczyKonwencje(readFileSync(p, "utf8")));

    expect(winowajcy).toEqual([]);
  });

  // Bramka, która dziś nie ma czego złapać, jest nie do odróżnienia od bramki
  // zepsutej — chyba że pokaże, że łapie, gdy jest co. To jest jedyne miejsce,
  // w którym widać ją na czerwono.
  it("reguła łapie mieszankę konwencji i przepuszcza każdą z nich osobno", () => {
    expect(laczyKonwencje("const past = new Date(o.scheduledAt).getTime() < Date.now();")).toBe(
      true,
    );
    // Poprawnie: „teraz” w tej samej konwencji, co `scheduledAt`.
    expect(
      laczyKonwencje("const past = new Date(o.scheduledAt).getTime() < appWallClockNow();"),
    ).toBe(false);
    // Poprawnie: moment dla BE, bez udziału czasu ściennego.
    expect(laczyKonwencje("const nowISO = new Date().toISOString();")).toBe(false);
    // `Date.now()` bez `scheduledAt` w pobliżu bramki nie obchodzi.
    expect(laczyKonwencje("const id = `req-${Date.now()}`;")).toBe(false);
    // Zdanie w komentarzu nie jest naruszeniem — inaczej bramka kasowałaby wiedzę.
    expect(laczyKonwencje("// `Date.now()` stało tu do D-FE-3\nconst x = o.scheduledAt;")).toBe(
      false,
    );
  });
});
