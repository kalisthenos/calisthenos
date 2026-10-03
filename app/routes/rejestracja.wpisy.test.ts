// @vitest-environment node
import { describe, expect, it } from "vitest";
import routes from "../routes";

/**
 * Wpisy tras rejestracji trenera i dokumentu zgody w `app/routes.ts` (spec tras §12, pkt 16).
 *
 * Trasa to plik PLUS wpis; sam plik daje martwy komponent. Bez wpisu router odpowiada własnym
 * `404`, nieodróżnialnym od `404` rzuconego przez loader — `dokumenty` rzuca go dla każdego
 * nieznanego klucza — więc ani testy loaderów, ani scenariusz Playwrighta „dokument, którego nie
 * ma” niczego tu nie widzą.
 *
 * Wzorem `healthz.test.ts`, ale na WYLICZONEJ konfiguracji, nie na jej tekście. W tekście wpis
 * zakomentowany, zawinięty przez formater albo wstawiony pod `layout(...)` czy `prefix(...)`
 * wygląda jak poprawny, a pod layoutem trenera trasa publiczna dziedziczyłaby jego bramkę.
 * Asercja szuka więc wpisu NA SZCZYCIE konfiguracji — tam, gdzie stoją trasy poza layoutami.
 *
 * Czego NIE łapie: czy plik trasy istnieje i eksportuje to, czego router oczekuje. To pilnują
 * testy samych tras i `npm run build`.
 */
const WPISY: [string, string][] = [
  ["rejestracja", "routes/rejestracja.tsx"],
  ["rejestracja/:token", "routes/rejestracja.$token.tsx"],
  ["dokumenty/:klucz/:wersja", "routes/dokumenty.$klucz.$wersja.tsx"],
];

describe("app/routes.ts — wpisy tras rejestracji i dokumentu zgody", () => {
  it.each(WPISY)("na szczycie konfiguracji jest trasa „%s” → %s", (sciezka, plik) => {
    const wpis = routes.find((r) => r.path === sciezka);

    expect(wpis?.file, `brak wpisu „${sciezka}” na szczycie app/routes.ts`).toBe(plik);
  });
});
