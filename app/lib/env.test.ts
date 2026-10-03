import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Po S6 wymagane jest już tylko jedno pole poza adresami BE: cztery zmienne
// bazy, sesji, podpisu plików i katalogu danych zniknęły ze schematu razem
// z tym, co je czytało.
const BAZA = {
  BASE_URL: "https://example.test",
};

afterEach(() => {
  // biome-ignore lint/performance/noDelete: process.env wymaga delete — przypisanie `undefined` stringifikuje się do "undefined", nie usuwa klucza
  delete process.env.API_URL;
  // biome-ignore lint/performance/noDelete: jak wyżej
  delete process.env.API_PUBLIC_URL;
});

describe("EnvSchema — adresy BE", () => {
  it("wymaga API_URL", async () => {
    const { EnvSchema } = await import("./env");
    expect(() => EnvSchema.parse({ ...BAZA })).toThrow();
  });

  it("bez API_PUBLIC_URL przyjmuje adres wewnętrzny", async () => {
    // Lokalnie i w testach jeden adres wystarcza. Wymuszanie dwóch tworzyłoby
    // klasę błędu „działa lokalnie, 502 na produkcji" w drugą stronę: rozjazd
    // konfiguracji między środowiskami, którego nikt nie zauważa do wdrożenia.
    const { EnvSchema } = await import("./env");
    const env = EnvSchema.parse({ ...BAZA, API_URL: "http://api.internal:3000" });
    expect(env.API_PUBLIC_URL).toBe("http://api.internal:3000");
  });

  it("pusty string w API_PUBLIC_URL traktuje jak brak zmiennej", async () => {
    // Nie hipoteza: `react-router dev` czyta `.env` przez Vite `loadEnv` z
    // pustym prefiksem, który kopiuje CAŁY plik do `process.env` — pusta
    // linia `API_PUBLIC_URL=` w `.env.example` trafia tu jako `""`, nie jako
    // nieobecny klucz. `.optional()` reaguje tylko na `undefined`, więc bez
    // tego przypadku `.url()` odrzuca pusty string i wysypuje `getEnv()` —
    // czyli middleware klienta, a więc każde żądanie.
    const { EnvSchema } = await import("./env");
    const env = EnvSchema.parse({
      ...BAZA,
      API_URL: "http://api.internal:3000",
      API_PUBLIC_URL: "",
    });
    expect(env.API_PUBLIC_URL).toBe("http://api.internal:3000");
  });

  it("gdy oba są ustawione, zachowuje je rozdzielnie", async () => {
    const { EnvSchema } = await import("./env");
    const env = EnvSchema.parse({
      ...BAZA,
      API_URL: "http://api.internal:3000",
      API_PUBLIC_URL: "https://api.kalisthenos.pl",
    });
    expect(env.API_URL).toBe("http://api.internal:3000");
    expect(env.API_PUBLIC_URL).toBe("https://api.kalisthenos.pl");
  });
});

describe("EnvSchema — sekret nagłówków adresu klienta (ADR-0048 w BE)", () => {
  const KOMPLET = { ...BAZA, API_URL: "http://api.internal:3000" };
  const SEKRET = "sekret-przekazywania-co-najmniej-32-znaki";

  /** Ścieżki błędów schematu — pusta lista, gdy konfiguracja przeszła. */
  async function sciezkiBledow(wejscie: Record<string, string>): Promise<string[]> {
    const { EnvSchema } = await import("./env");
    const wynik = EnvSchema.safeParse(wejscie);
    return wynik.success ? [] : wynik.error.issues.map((i) => i.path.join("."));
  }

  it("na produkcji bez sekretu odrzuca konfigurację — błąd stoi na tej zmiennej", async () => {
    // Bez sekretu BE nikomu nie ufa i liczy cały ruch z webu jednym licznikiem — a nic tego
    // nie zgłasza. Brak ma więc zatrzymać start, nie przejść w ciszy.
    expect(await sciezkiBledow({ ...KOMPLET, NODE_ENV: "production" })).toEqual([
      "CLIENT_FORWARDING_SECRET",
    ]);
  });

  it("pusty string poza produkcją znaczy brak, nie błąd długości — tak jak w API_PUBLIC_URL", async () => {
    // `react-router dev` kopiuje CAŁY `.env` do `process.env`, więc pusta linia
    // `CLIENT_FORWARDING_SECRET=` trafia tu jako `""`, nie jako nieobecny klucz. Bez
    // `z.preprocess` `.min(32)` odrzucałby ją i wysypywał `getEnv()` — czyli middleware,
    // a więc każde żądanie — u każdego, kto skopiował `.env.example` i wyczyścił wartość.
    expect(
      await sciezkiBledow({ ...KOMPLET, NODE_ENV: "development", CLIENT_FORWARDING_SECRET: "" }),
    ).toEqual([]);
  });

  it("pusty string na produkcji nie zastępuje sekretu", async () => {
    // Zmienna założona w panelu Railway i niewypełniona to nadal brak sekretu.
    expect(
      await sciezkiBledow({ ...KOMPLET, NODE_ENV: "production", CLIENT_FORWARDING_SECRET: "" }),
    ).toEqual(["CLIENT_FORWARDING_SECRET"]);
  });

  it("na produkcji z sekretem co najmniej 32 znaków przechodzi i zachowuje wartość", async () => {
    const { EnvSchema } = await import("./env");
    const wynik = EnvSchema.safeParse({
      ...KOMPLET,
      NODE_ENV: "production",
      CLIENT_FORWARDING_SECRET: SEKRET,
    });
    expect(wynik.success).toBe(true);
    expect(wynik.success ? wynik.data.CLIENT_FORWARDING_SECRET : null).toBe(SEKRET);
  });

  /**
   * Wartość `CLIENT_FORWARDING_SECRET` z PRAWDZIWEGO `.env.example` — to, co ktoś skopiuje na
   * Railway bez zmiany. Czytana z pliku, nie przepisana: gdy przykład dostanie inny przedrostek,
   * a reguła w `env.ts` zostanie, pułapka wraca bez słowa i dopiero ten test to widzi. Brak
   * wartości w przykładzie kończy się błędem, nie zielonym przejściem „na pusto”.
   */
  function sekretZPrzykladu(): string {
    const plik = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const wartosc = /^CLIENT_FORWARDING_SECRET=(.*)$/m.exec(plik)?.[1]?.trim();
    if (!wartosc) throw new Error("`.env.example` nie ma wartości CLIENT_FORWARDING_SECRET");
    return wartosc;
  }

  it("na produkcji odrzuca wartość z `.env.example` — przykład skopiowany na Railway nie przejdzie", async () => {
    // Przykład ma co najmniej 32 znaki, więc `.min(32)` go przepuszcza — to właśnie ta luka.
    // Długość sprawdzona jawnie: gdyby przykład był krótszy, odrzuciłaby go długość i test
    // przeszedłby z powodu, którego ta reguła nie dotyczy.
    const przyklad = sekretZPrzykladu();
    expect(przyklad.length).toBeGreaterThanOrEqual(32);

    expect(
      await sciezkiBledow({
        ...KOMPLET,
        NODE_ENV: "production",
        CLIENT_FORWARDING_SECRET: przyklad,
      }),
    ).toEqual(["CLIENT_FORWARDING_SECRET"]);
  });

  it("poza produkcją wartość z `.env.example` przechodzi — lokalnie wystarcza skopiować plik", async () => {
    // Druga strona tej samej reguły: odrzucenie nie może wyjść poza produkcję, bo wtedy
    // `cp .env.example .env` kończyłby się wywrotką `getEnv()` u każdego, kto zaczyna pracę.
    expect(
      await sciezkiBledow({
        ...KOMPLET,
        NODE_ENV: "development",
        CLIENT_FORWARDING_SECRET: sekretZPrzykladu(),
      }),
    ).toEqual([]);
  });

  it("poza produkcją sekret jest opcjonalny — FE po prostu nie dokłada nagłówków", async () => {
    const { EnvSchema } = await import("./env");
    const env = EnvSchema.parse({ ...KOMPLET, NODE_ENV: "development" });
    expect(env.CLIENT_FORWARDING_SECRET).toBeUndefined();
  });

  it("sekret krótszy niż 32 znaki jest odrzucany także poza produkcją", async () => {
    // Za krótki sekret to ten sam brak ochrony, tylko z miną ochrony — więc nie czeka na
    // produkcję, żeby wyjść na jaw.
    expect(
      await sciezkiBledow({
        ...KOMPLET,
        NODE_ENV: "development",
        CLIENT_FORWARDING_SECRET: "za-krotki",
      }),
    ).toEqual(["CLIENT_FORWARDING_SECRET"]);
  });
});
