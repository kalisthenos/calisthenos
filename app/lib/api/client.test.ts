import { exerciseCategoriesControllerList } from "@kalisthenos/api-client";
import { describe, expect, it, vi } from "vitest";

// Potrzebne wyłącznie dla `publicFileUrl` — pozostałe testy w tym pliku podają
// `baseUrl` jawnie, więc do konfiguracji nie sięgają w ogóle.
vi.mock("~/lib/env", () => ({
  getEnv: () => ({ API_URL: "http://be.internal", API_PUBLIC_URL: "https://api.kalisthenos.test" }),
}));

import { createApiClient, orNull, publicFileUrl } from "./client";
import { ApiError } from "./errors";

function odpowiedz(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("dokłada token do nagłówka przy każdym wywołaniu", async () => {
    let widziany: string | null = null;
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "TOKEN-A",
      fetch: async (req) => {
        widziany = (req as Request).headers.get("authorization");
        return odpowiedz(200, []);
      },
    });

    await exerciseCategoriesControllerList({ client: api });

    expect(widziany).toBe("Bearer TOKEN-A");
  });

  it("czyta token przy KAŻDYM wywołaniu, nie przy tworzeniu klienta", async () => {
    // Klient powstaje raz na żądanie, a token może się w jego trakcie zmienić
    // (odświeżenie w interceptorze). Gdyby fabryka domknęła wartość zamiast
    // funkcji, ponowione żądanie poszłoby ze starym, właśnie unieważnionym
    // tokenem — i pętla 401 → odśwież → 401 nigdy by się nie zamknęła.
    let biezacy = "STARY";
    const widziane: (string | null)[] = [];
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => biezacy,
      fetch: async (req) => {
        widziane.push((req as Request).headers.get("authorization"));
        return odpowiedz(200, []);
      },
    });

    await exerciseCategoriesControllerList({ client: api });
    biezacy = "NOWY";
    await exerciseCategoriesControllerList({ client: api });

    expect(widziane).toEqual(["Bearer STARY", "Bearer NOWY"]);
  });

  it("zamienia kopertę błędu na ApiError", async () => {
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: async () =>
        odpowiedz(409, {
          error: { code: "CATEGORY_NAME_TAKEN", message: "Kategoria o tej nazwie już istnieje." },
        }),
    });

    const blad = await exerciseCategoriesControllerList({ client: api }).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect((blad as ApiError).status).toBe(409);
    expect((blad as ApiError).code).toBe("CATEGORY_NAME_TAKEN");
  });

  it("awarię sieci zamienia na ApiError 502, nie na surowy TypeError", async () => {
    // Bez tego zerwane połączenie do BE wychodzi z modułu jako `TypeError:
    // fetch failed` i granica błędu trasy pokazuje komunikat, którego nie
    // napisał nikt po polsku.
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    const blad = await exerciseCategoriesControllerList({ client: api }).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect((blad as ApiError).status).toBe(502);
  });

  it("błąd, który wszedł już jako ApiError, wychodzi tym samym błędem", async () => {
    // Zagnieżdżone odświeżenie (nieudana ponowna próba po 401) rzuca gotowy
    // ApiError, a ten wraca przez TEN SAM interceptor drugi raz. Bez tej
    // wczesnej ścieżki `parseApiError` dostałby `ApiError` zamiast surowej
    // koperty, nie znalazłby w nim pola `.error` (bo `ApiError` go nie ma)
    // i zamieniłby 401/TOKEN_EXPIRED na 502/UNKNOWN — dokładnie informację,
    // po którą sięga middleware rozpoznający martwą sesję.
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: async () => {
        throw new ApiError(401, "TOKEN_EXPIRED", "Token wygasł.");
      },
    });

    const blad = await exerciseCategoriesControllerList({ client: api }).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect((blad as ApiError).status).toBe(401);
    expect((blad as ApiError).code).toBe("TOKEN_EXPIRED");
    expect((blad as ApiError).message).toBe("Token wygasł.");
  });

  it("Response rzucony z interceptora odpowiedzi wychodzi z wywołania SDK jako ten sam Response", async () => {
    // `middleware.ts` rzuca `Response` (przekierowanie na logowanie) z
    // WEWNĄTRZ interceptora odpowiedzi — to jedyny sposób, żeby stamtąd
    // w ogóle wyjść. Bez gałęzi `error instanceof Response` w interceptorze
    // błędu ten rzut wpadłby do `parseApiError`, który nie widzi na
    // obiekcie `Response` koperty `{error}` i przemielił go na generyczny
    // `401/UNKNOWN` — tracąc status i nagłówki przekierowania, zanim
    // dotrze do miejsca, które umie je odczytać jako `Response`.
    const rzucona = new Response(null, { status: 302, headers: { Location: "/login" } });
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: async () => odpowiedz(200, []),
    });
    api.interceptors.response.use(() => {
      throw rzucona;
    });

    const blad = await exerciseCategoriesControllerList({ client: api }).catch((e: unknown) => e);

    expect(blad).toBe(rzucona);
    expect((blad as Response).status).toBe(302);
    expect((blad as Response).headers.get("Location")).toBe("/login");
  });

  it("odczytuje Retry-After z odpowiedzi i wkłada go do ApiError", async () => {
    // Interceptor jest jedynym miejscem, które widzi nagłówki — `parseApiError`
    // dostaje samo ciało. Bez tego przejścia pole zostałoby na zawsze puste,
    // a komunikat o limicie prób nie miałby skąd wziąć minut.
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Za dużo." } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "900" },
        })) as unknown as typeof fetch,
    });

    const blad = await api.get({ url: "/v1/cokolwiek" }).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect((blad as ApiError).retryAfter).toBe(900);
  });

  it("nagłówek nieliczbowy nie psuje błędu", async () => {
    // `Retry-After` dopuszcza też datę HTTP, a proxy potrafi wstawić śmieć.
    // Błąd ma wtedy dojść bez czasu, a nie wywrócić się na `NaN` — „za NaN min"
    // jest gorsze niż brak liczby.
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Za dużo." } }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT",
          },
        })) as unknown as typeof fetch,
    });

    const blad = await api.get({ url: "/v1/cokolwiek" }).catch((e: unknown) => e);

    expect((blad as ApiError).status).toBe(429);
    expect((blad as ApiError).retryAfter).toBeUndefined();
  });

  it("brak nagłówka daje BRAK wartości, nie zero", async () => {
    // `Number(null)` to 0, nie NaN — więc naiwne `Number(headers.get(...))`
    // nadawałoby `retryAfter: 0` KAŻDEJ odpowiedzi błędnej. A `0` znaczy
    // „próbuj teraz", czyli co innego niż „nie wiem", i wywołujący nie miałby
    // jak tych dwóch przypadków odróżnić.
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Ups." } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });

    const blad = await api.get({ url: "/v1/cokolwiek" }).catch((e: unknown) => e);

    expect((blad as ApiError).status).toBe(500);
    expect((blad as ApiError).retryAfter).toBeUndefined();
  });
});

describe("createApiClient — forwardedHeaders (ADR-0048)", () => {
  it("dokłada podane nagłówki do KAŻDEGO wywołania, nie tylko do pierwszego", async () => {
    // Nagłówki siedzą w KONFIGURACJI klienta, a hey-api scala ją z nagłówkami wywołania przy
    // każdym żądaniu (`beforeRequest`) — więc dostaje je i wywołanie SDK, i surowe `api.get`,
    // i każde następne. Test pilnuje właśnie „każdego następnego”: nagłówek dopisany tylko
    // do pierwszego żądania przeszedłby bez objawu, a BE po cichu liczyłby adres serwera FE.
    const widziane: (string | null)[] = [];
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      forwardedHeaders: { "x-kth-client-ip": "203.0.113.7" },
      fetch: async (req) => {
        widziane.push((req as Request).headers.get("x-kth-client-ip"));
        return odpowiedz(200, []);
      },
    });

    await exerciseCategoriesControllerList({ client: api });
    await api.get({ url: "/v1/cokolwiek" });

    expect(widziane).toEqual(["203.0.113.7", "203.0.113.7"]);
  });

  it("bez forwardedHeaders nie dokłada żadnego nagłówka x-kth-*", async () => {
    const nazwy: string[] = [];
    const api = createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: async (req) => {
        (req as Request).headers.forEach((_wartosc, nazwa) => nazwy.push(nazwa));
        return odpowiedz(200, []);
      },
    });

    await exerciseCategoriesControllerList({ client: api });

    expect(nazwy.filter((n) => n.startsWith("x-kth-"))).toEqual([]);
  });
});

describe("orNull — reguła D3", () => {
  it("404 zamienia na null", async () => {
    // 37 funkcji w `app/lib` deklaruje `Promise<… | null>`, a 40 miejsc w trasach
    // robi z tego `404`. Gdyby `404` leciał wyjątkiem, te 40 miejsc stałoby się
    // martwym kodem — i krok 3 Etapu 2 przestałby być mechaniczny.
    const wynik = await orNull(Promise.reject(new ApiError(404, "NOT_FOUND", "Nie znaleziono.")));

    expect(wynik).toBeNull();
  });

  it("każdy inny status przepuszcza", async () => {
    // Reguła ma być wąska. `orNull` łykający wszystko zamieniałby błędną ścieżkę
    // w kliencie i awarię BE w pusty ekran bez śladu, co się stało.
    await expect(
      orNull(Promise.reject(new ApiError(500, "SERVER", "Awaria."))),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("wartość przepuszcza bez zmian", async () => {
    expect(await orNull(Promise.resolve({ id: "x" }))).toEqual({ id: "x" });
  });
});

describe("publicFileUrl", () => {
  it("do ścieżki z kontraktu dokłada publiczny origin", () => {
    // Podpis z BE jest ŚCIEŻKĄ (`FileUrlSigner.sign`), a trafia do `src`
    // w `<video>`/`<img>` — bez tego origin przeglądarka szukałaby pliku
    // pod adresem FE, gdzie tej trasy nie ma.
    expect(publicFileUrl("/v1/files/f-1?exp=1&sig=abc")).toBe(
      "https://api.kalisthenos.test/v1/files/f-1?exp=1&sig=abc",
    );
  });

  it("adres BEZWZGLĘDNY zwraca nietknięty — bez podwojonego origin", () => {
    // Ta gałąź jest siatką na wypadek, gdyby BE zaczęło kiedyś zwracać pełne
    // adresy: `new URL(x, base)` je przepuszcza, a naiwne sklejanie łańcuchów
    // dałoby `https://api…https://cdn…`. Bez tego testu podmiana implementacji
    // na sklejanie przeszłaby niezauważona — cała suita karmi ją ścieżkami.
    expect(publicFileUrl("https://cdn.example.test/v1/files/f-1?sig=abc")).toBe(
      "https://cdn.example.test/v1/files/f-1?sig=abc",
    );
  });
});
