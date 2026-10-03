// @vitest-environment node
//
// Domyślne środowisko testów to `happy-dom` (`vitest.config.ts`) — a jego
// `Request` filtruje nagłówki zakazane spec Fetch (`cookie` jest jednym z
// nich) już w KONSTRUKTORZE, więc `zadanie()` niżej budowałaby żądanie, które
// nigdy nie niesie ciastka, i middleware zawsze brałby gałąź anonima. Realny
// serwer (Node, nie przeglądarka) tego nie robi — `node` jako środowisko
// TEGO pliku odwzorowuje faktyczny czas wykonania middleware'u, a nie
// zmienia domyślnego środowiska reszty pakietu testów.
import { beforeEach, describe, expect, it, vi } from "vitest";

// `apiMiddleware` czyta `getEnv().API_URL` bezpośrednio (nie przez wstrzykiwany
// `baseUrl` — tego pola `MiddlewareDeps` celowo nie ma, patrz brief). Bez tego
// mocka `getEnv()` parsowałoby prawdziwy `process.env`, którego testy nie
// ustawiają, i każdy z czterech przypadków padałby na `ZodError` zanim
// dotarłby do właściwej asercji. Ten sam wzorzec co w `files.test.ts`.
//
// Sekret nagłówków adresu klienta (ADR-0048) jest tu LITERAŁEM, nie stałą z pliku:
// `vi.mock` jest wynoszony na górę, więc fabryka nie widzi niczego zadeklarowanego
// niżej. Ta sama wartość wraca w `SEKRET` poniżej — do asercji.
vi.mock("~/lib/env", () => ({
  getEnv: () => ({
    API_URL: "http://be.test",
    CLIENT_FORWARDING_SECRET: "sekret-przekazywania-co-najmniej-32-znaki",
  }),
}));

import {
  exerciseCategoriesControllerList,
  invitesControllerPreview,
} from "@kalisthenos/api-client";
import { RouterContextProvider } from "react-router";
import { apiContext } from "./context";
import { ApiError } from "./errors";
import { apiMiddleware } from "./middleware";
import { resetRefreshState } from "./refresh";
import { type ApiSession, buildSessionCookie, readSessionCookie } from "./session";

const TERAZ = new Date("2026-08-31T10:00:00Z");

const ME = {
  partyId: "p-1",
  displayName: "Anna Kowalska",
  email: "anna@example.pl",
  roles: ["trainer"],
  coach: null,
};

function sesja(nadpisz: Partial<ApiSession> = {}): ApiSession {
  return {
    accessToken: "A1",
    refreshToken: "R1",
    accessExpiresAt: TERAZ.getTime() + 900_000,
    ...nadpisz,
  };
}

/** `dodatkowe` — nagłówki, z którymi żądanie przychodzi do FE od przeglądarki (np. adres klienta). */
function zadanie(
  session: ApiSession | null,
  sciezka = "/trener",
  dodatkowe: Record<string, string> = {},
): Request {
  const naglowki = new Headers(dodatkowe);
  if (session) naglowki.set("cookie", buildSessionCookie(session).split(";")[0]!);
  return new Request(`https://fe.test${sciezka}`, { headers: naglowki });
}

// Ta sama wartość co w `vi.mock("~/lib/env", …)` na górze pliku — tam musi być literałem.
const SEKRET = "sekret-przekazywania-co-najmniej-32-znaki";

/** Jak żądanie przychodzi do FE zza brzegu Railway: klient pierwszy w `X-Forwarded-For`. */
const OD_PRZEGLADARKI = {
  "x-forwarded-for": "203.0.113.7, 100.64.0.2",
  "user-agent": "Mozilla/5.0 (test)",
};

interface NaglowkiAdresu {
  ip: string | null;
  ua: string | null;
  sekret: string | null;
}

/** Trzy nagłówki ADR-0048 w takiej postaci, w jakiej widzi je BE. */
function przekazane(req: Request): NaglowkiAdresu {
  return {
    ip: req.headers.get("x-kth-client-ip"),
    ua: req.headers.get("x-kth-client-ua"),
    sekret: req.headers.get("x-kth-forwarding-secret"),
  };
}

/** To, co BE ma zobaczyć, gdy FE dostał żądanie z `OD_PRZEGLADARKI` — dla KAŻDEGO wywołania. */
const ADRES_KLIENTA: NaglowkiAdresu = {
  ip: "203.0.113.7",
  ua: "Mozilla/5.0 (test)",
  sekret: SEKRET,
};

/** Serwer atrapowy: liczy wywołania i odpowiada wg ścieżki. */
function serwer(reguly: (url: string, req: Request, cialo: string) => Response) {
  const trafienia: string[] = [];
  return {
    trafienia,
    // Rzutowanie na `typeof fetch`: middleware zawsze woła `transport` z
    // obiektem `Request` (nigdy z gołym stringiem/URL-em ani `RequestInfo`
    // z osobnym `init` — to drugie akceptuje wyłącznie realny `fetch`),
    // więc atrapa celowo przyjmuje tylko ten jeden, faktycznie używany
    // kształt. Czyta ciało PRZED wywołaniem `reguly` — dokładnie jak realny
    // `fetch`, który zużywa strumień ciała żądania nawet przy nieudanym
    // połączeniu (zmierzone osobno). Bez tego atrapa nie odtwarzałaby
    // warunku, w którym ponowienie żądania z ciałem po 401 rzuca
    // `TypeError: … already been used`, i test tej ścieżki niczego by nie
    // pilnował.
    fetch: (async (req: Request) => {
      const url = new URL(req.url).pathname;
      trafienia.push(url);
      const cialo = await req.text();
      return reguly(url, req, cialo);
    }) as typeof fetch,
  };
}

function json(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => resetRefreshState());

describe("apiMiddleware — cykl życia sesji w jednym żądaniu", () => {
  it("bez ciastka nie woła BE i wpuszcza anonima", async () => {
    const s = serwer(() => json(200, {}));
    const context = new RouterContextProvider();

    await apiMiddleware({ request: zadanie(null), context }, async () => new Response("ok"), {
      fetch: s.fetch,
      now: () => TERAZ,
    });

    expect(s.trafienia).toEqual([]);
    expect(context.get(apiContext).user).toBeNull();
  });

  it("ze świeżym tokenem woła /v1/me raz i nie odświeża", async () => {
    const s = serwer(() => json(200, ME));
    const context = new RouterContextProvider();

    const res = await apiMiddleware(
      { request: zadanie(sesja()), context },
      async () => new Response("ok"),
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(s.trafienia).toEqual(["/v1/me"]);
    expect(context.get(apiContext).user?.roles).toEqual(["trainer"]);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("token bliski wygaśnięcia odświeża PRZED loaderami i dopisuje ciastko", async () => {
    const s = serwer((url) =>
      url === "/v1/auth/refresh"
        ? json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 })
        : json(200, ME),
    );
    const context = new RouterContextProvider();
    // 10 s do wygaśnięcia — wewnątrz 30-sekundowego marginesu.
    const bliska = sesja({ accessExpiresAt: TERAZ.getTime() + 10_000 });

    const res = await apiMiddleware(
      { request: zadanie(bliska), context },
      async () => new Response("ok"),
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(s.trafienia).toEqual(["/v1/auth/refresh", "/v1/me"]);
    expect(res.headers.get("set-cookie")).toContain("__Host-kth_api=");
  });

  it("martwy token odświeżający czyści ciastko i odsyła na logowanie", async () => {
    const s = serwer(() =>
      json(401, { error: { code: "INVALID_REFRESH", message: "Zaloguj się ponownie." } }),
    );
    const context = new RouterContextProvider();
    const bliska = sesja({ accessExpiresAt: TERAZ.getTime() - 1 });

    const res = await apiMiddleware(
      { request: zadanie(bliska), context },
      async () => new Response("ok"),
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("401 w locie, odświeżenie udane — ponawia z nowym tokenem i zachowanym ciałem", async () => {
    // Token na wejściu jest świeży (needsRefresh=false) — jedyna droga do 401
    // to gałąź REAKTYWNA interceptora odpowiedzi, nie ścieżka wyprzedzająca.
    // Żądanie z ciałem idzie przez `next()`, dokładnie jak zrobiłaby to trasa
    // wołająca `context.get(apiContext).api` z loadera/akcji PO middleware —
    // samo middleware woła wyłącznie bezciałowe `/v1/me`, więc to jedyny
    // sposób w tym pliku, żeby powstało żądanie z ciałem do ponowienia.
    const mutacje: { authorization: string | null; cialo: string }[] = [];
    const s = serwer((url, req, cialo) => {
      if (url === "/v1/auth/refresh") {
        return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      }
      if (url === "/v1/me") return json(200, ME);
      mutacje.push({ authorization: req.headers.get("authorization"), cialo });
      return mutacje.length === 1 ? json(401, {}) : json(200, {});
    });
    const context = new RouterContextProvider();

    await apiMiddleware(
      { request: zadanie(sesja()), context },
      async () => {
        await context
          .get(apiContext)
          .api.post({ url: "/v1/mutacja-testowa", body: { pole: "wartosc" } });
        return new Response("ok");
      },
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(s.trafienia.filter((u) => u === "/v1/auth/refresh")).toHaveLength(1);
    expect(mutacje).toHaveLength(2);
    expect(mutacje[1]?.authorization).toBe("Bearer A2");
    expect(mutacje[0]?.cialo.length).toBeGreaterThan(0);
    expect(mutacje[1]?.cialo).toBe(mutacje[0]?.cialo);
  });

  it("401 w locie, odświeżenie martwe — przekierowanie na logowanie wychodzi rzucone", async () => {
    // Jak wyżej: świeży token na wejściu, więc 401 może przyjść wyłącznie z
    // gałęzi reaktywnej. Tu middleware trafia w 401 na samym `/v1/me` — bez
    // potrzeby osobnej mutacji przez `next()`. `apiMiddleware` NIE zwraca tu
    // odpowiedzi — rzuca `Response`, bo błąd wyszedł z wnętrza wywołania
    // klienta (`meControllerMe`), nie z własnego `catch` funkcji.
    const s = serwer((url) =>
      url === "/v1/auth/refresh"
        ? json(401, { error: { code: "INVALID_REFRESH", message: "Zaloguj się ponownie." } })
        : json(401, {}),
    );
    const context = new RouterContextProvider();

    let zlapany: unknown;
    try {
      await apiMiddleware({ request: zadanie(sesja()), context }, async () => new Response("ok"), {
        fetch: s.fetch,
        now: () => TERAZ,
      });
    } catch (e) {
      zlapany = e;
    }

    expect(zlapany).toBeInstanceOf(Response);
    const odpowiedz = zlapany as Response;
    expect(odpowiedz.status).toBe(302);
    expect(odpowiedz.headers.get("location")).toBe("/login");
    expect(odpowiedz.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("awaria BE (502) na /v1/me nie jest wylogowaniem", async () => {
    // Regułę „502 nie jest wylogowaniem" middleware uzasadnia pięcioma
    // liniami komentarza (odesłanie na logowanie w odpowiedzi na awarię BE
    // kazałoby wpisywać hasło na nic) — bez tego testu nic jej nie pilnuje.
    const s = serwer(() => json(502, {}));
    const context = new RouterContextProvider();

    let zlapany: unknown;
    try {
      await apiMiddleware({ request: zadanie(sesja()), context }, async () => new Response("ok"), {
        fetch: s.fetch,
        now: () => TERAZ,
      });
    } catch (e) {
      zlapany = e;
    }

    expect(zlapany).toBeInstanceOf(ApiError);
    expect((zlapany as ApiError).status).toBe(502);
  });

  it("żądanie na /login z martwą sesją nie zapętla się w kolejne przekierowanie", async () => {
    // Bez tej gałęzi `wyloguj` przekierowałby `/login` → `/login` → …
    // Dziś usunięcie gałęzi nie wywraca żadnego testu; jej awaria to
    // nieskończona pętla przekierowań w przeglądarce.
    const s = serwer(() =>
      json(401, { error: { code: "INVALID_REFRESH", message: "Zaloguj się ponownie." } }),
    );
    const context = new RouterContextProvider();
    const bliska = sesja({ accessExpiresAt: TERAZ.getTime() - 1 });

    const res = await apiMiddleware(
      { request: zadanie(bliska, "/login"), context },
      async () => new Response("FORMULARZ LOGOWANIA"),
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    // TREŚĆ, nie sam status. Middleware, który na `/login` przerywa żądanie
    // i zwraca własne puste `200`, przechodził komplet asercji wyżej — a
    // użytkownik dostawał BIAŁĄ STRONĘ zamiast formularza i nie miał jak
    // wrócić. Ta trasa musi dojść do `next()`.
    await expect(res.text()).resolves.toBe("FORMULARZ LOGOWANIA");
    expect(context.get(apiContext).user).toBeNull();
  });

  it("awaria BE PO udanej rotacji oddaje nową parę tokenów mimo błędu", async () => {
    // Najgroźniejsza ścieżka w tym pliku. Rotacja się dokonała, więc stary
    // token odświeżający jest po stronie BE zużyty; gdyby błąd `/me` wyleciał
    // rzutem, nowa para nie trafiłaby do przeglądarki. Okno łaski kryje 60 s,
    // a potem pierwsze żądanie ze starym ciastkiem wygląda dla BE jak PONOWNE
    // UŻYCIE tokenu — `deleteChain`, czyli wylogowanie ze wszystkich urządzeń
    // w odpowiedzi na cudzą usterkę. Wyzwalacz jest zwyczajny: rolling deploy
    // BE trafiający tuż po rotacji.
    const s = serwer((url) =>
      url === "/v1/auth/refresh"
        ? json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 })
        : json(502, {}),
    );
    const context = new RouterContextProvider();
    const bliska = sesja({ accessExpiresAt: TERAZ.getTime() + 10_000 });

    const res = await apiMiddleware(
      { request: zadanie(bliska), context },
      async () => new Response("nie powinno dojsc"),
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(s.trafienia).toEqual(["/v1/auth/refresh", "/v1/me"]);
    expect(res.status).toBe(502);
    const ciastko = res.headers.get("set-cookie");
    expect(readSessionCookie(ciastko?.split(";")[0] ?? null)?.refreshToken).toBe("R2");
  });

  it("zUzytkownika nie myli pól trenera przy obecnym coach", async () => {
    // `ME` w całym pliku ma `coach: null` — zamiana miejscami `partyId` i
    // `displayName` w `zUzytkownika` przeżyłaby więc komplet pozostałych
    // testów. Ten jeden przypadek ma niepustego `coach`.
    const zTrenerem = { ...ME, coach: { partyId: "coach-1", displayName: "Jan Trener" } };
    const s = serwer(() => json(200, zTrenerem));
    const context = new RouterContextProvider();

    await apiMiddleware({ request: zadanie(sesja()), context }, async () => new Response("ok"), {
      fetch: s.fetch,
      now: () => TERAZ,
    });

    const user = context.get(apiContext).user;
    expect(user?.trainerId).toBe("coach-1");
    expect(user?.trainerName).toBe("Jan Trener");
  });
});

// FE woła BE ze swojego serwera (ADR-0048 w BE) — bez trzech nagłówków BE widzi adres serwera
// FE, a limity i dowód zgody liczą wszystkich razem. Pominięcie nie objawia się niczym, więc
// KAŻDY z trzech klientów budowanych w middleware'ze ma tu własny przypadek: anonimowy,
// zalogowany (`GET /v1/me`) i wymiana tokenu. Czwarty przypadek to ponowienie po 401, które
// idzie z klonu i nie przechodzi przez budowę nagłówków drugi raz; piąty — nagłówki `x-kth-*`
// nadesłane przez przeglądarkę, które nie mogą dotrzeć do BE; szósty — zalogowany niesie naraz
// `Authorization` i trzy nagłówki adresu (scalanie nagłówków w konfiguracji klienta).
describe("apiMiddleware — adres klienta w nagłówkach do BE (ADR-0048)", () => {
  it("klient anonimowy (bez ciastka) niesie adres, przeglądarkę i sekret", async () => {
    const widziane: Record<string, NaglowkiAdresu> = {};
    const s = serwer((url, req) => {
      widziane[url] = przekazane(req);
      return json(200, {});
    });
    const context = new RouterContextProvider();

    await apiMiddleware(
      { request: zadanie(null, "/rejestracja", OD_PRZEGLADARKI), context },
      async () => {
        // Tak woła BE trasa: klientem z kontekstu, nie własnym.
        await invitesControllerPreview({
          client: context.get(apiContext).api,
          path: { token: "t" },
        });
        return new Response("ok");
      },
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(s.trafienia).toEqual(["/v1/invites/t"]);
    expect(widziane["/v1/invites/t"]).toEqual(ADRES_KLIENTA);
  });

  it("sesja ważna: GET /v1/me, które woła sam middleware, niesie te same trzy nagłówki", async () => {
    const widziane: Record<string, NaglowkiAdresu> = {};
    const s = serwer((url, req) => {
      widziane[url] = przekazane(req);
      return json(200, ME);
    });
    const context = new RouterContextProvider();

    await apiMiddleware(
      { request: zadanie(sesja(), "/trener", OD_PRZEGLADARKI), context },
      async () => new Response("ok"),
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(s.trafienia).toEqual(["/v1/me"]);
    expect(widziane["/v1/me"]).toEqual(ADRES_KLIENTA);
  });

  it("sesja do odświeżenia: POST /v1/auth/refresh niesie adres klienta", async () => {
    // Wymiana tokenu ma własnego klienta (`exchange` w `odswiez`) — osobna ścieżka budowy,
    // którą łatwo pominąć, bo działa identycznie z nagłówkami i bez nich.
    const widziane: Record<string, NaglowkiAdresu> = {};
    const s = serwer((url, req) => {
      widziane[url] = przekazane(req);
      return url === "/v1/auth/refresh"
        ? json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 })
        : json(200, ME);
    });
    const context = new RouterContextProvider();
    const wygasla = sesja({ accessExpiresAt: TERAZ.getTime() - 1 });

    await apiMiddleware(
      { request: zadanie(wygasla, "/trener", OD_PRZEGLADARKI), context },
      async () => new Response("ok"),
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(s.trafienia).toEqual(["/v1/auth/refresh", "/v1/me"]);
    expect(widziane["/v1/auth/refresh"]).toEqual(ADRES_KLIENTA);
    // `/v1/me` po rotacji idzie głównym klientem — ten sam adres, nie adres wymiany.
    expect(widziane["/v1/me"]).toEqual(ADRES_KLIENTA);
  });

  it("ponowienie po 401 niesie adres klienta tak samo jak pierwsze żądanie", async () => {
    // Ponowienie buduje `new Request(kopia, { headers })` z klonu żądania, które klient już
    // zbudował. Przebudowa nagłówków od zera (np. same `authorization`) zgubiłaby trzy
    // nagłówki tylko na tej ścieżce — i tylko tu BE zobaczyłby adres serwera FE.
    const mutacje: NaglowkiAdresu[] = [];
    const s = serwer((url, req) => {
      if (url === "/v1/auth/refresh") {
        return json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 });
      }
      if (url === "/v1/me") return json(200, ME);
      mutacje.push(przekazane(req));
      return mutacje.length === 1 ? json(401, {}) : json(200, {});
    });
    const context = new RouterContextProvider();

    await apiMiddleware(
      { request: zadanie(sesja(), "/trener", OD_PRZEGLADARKI), context },
      async () => {
        await context
          .get(apiContext)
          .api.post({ url: "/v1/mutacja-testowa", body: { pole: "wartosc" } });
        return new Response("ok");
      },
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(mutacje).toEqual([ADRES_KLIENTA, ADRES_KLIENTA]);
  });

  it("nagłówki x-kth-* nadesłane przez przeglądarkę nie dochodzą do BE — wartości liczy FE", async () => {
    // Gdyby FE przekazywał dalej cokolwiek, co przyszło od przeglądarki, ta mogłaby podstawić
    // własny adres RAZEM z sekretem FE dokładanym do każdego wywołania — i obejść każdy limit.
    const widziane: Record<string, NaglowkiAdresu> = {};
    const s = serwer((url, req) => {
      widziane[url] = przekazane(req);
      return json(200, ME);
    });
    const context = new RouterContextProvider();
    const podszyte = {
      ...OD_PRZEGLADARKI,
      "x-kth-client-ip": "198.51.100.1",
      "x-kth-client-ua": "podstawiona-przegladarka",
      "x-kth-forwarding-secret": "sekret-podstawiony-przez-przegladarke",
    };

    await apiMiddleware(
      { request: zadanie(sesja(), "/trener", podszyte), context },
      async () => new Response("ok"),
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(widziane["/v1/me"]).toEqual(ADRES_KLIENTA);
  });

  it("zalogowany: każde wywołanie do BE niesie naraz Authorization i trzy nagłówki adresu", async () => {
    // `Authorization` dokłada opcja `auth` klienta, trzy nagłówki adresu — jego `headers`; klient
    // scala jedno z drugim przy każdym żądaniu. Dziś każdy z nich jest dowiedziony osobno (token
    // — przy ponowieniu po 401 i w `client.test.ts`, adres — w przypadkach wyżej); ten przypadek
    // pilnuje obu RAZEM, na wywołaniu samego middleware'u (`GET /v1/me`) i na wywołaniu trasy
    // klientem z kontekstu. Wywołanie trasy idzie funkcją SDK Z deklaracją `security`: bez niej
    // klient nie dokłada tokenu w ogóle (`invitesControllerPreview` jest publiczne).
    const widziane: Record<string, NaglowkiAdresu & { authorization: string | null }> = {};
    const s = serwer((url, req) => {
      widziane[url] = { ...przekazane(req), authorization: req.headers.get("authorization") };
      return json(200, url === "/v1/me" ? ME : []);
    });
    const context = new RouterContextProvider();

    await apiMiddleware(
      { request: zadanie(sesja(), "/trener", OD_PRZEGLADARKI), context },
      async () => {
        await exerciseCategoriesControllerList({ client: context.get(apiContext).api });
        return new Response("ok");
      },
      { fetch: s.fetch, now: () => TERAZ },
    );

    expect(s.trafienia).toEqual(["/v1/me", "/v1/exercise-categories"]);
    const oczekiwane = { ...ADRES_KLIENTA, authorization: "Bearer A1" };
    expect(widziane["/v1/me"]).toEqual(oczekiwane);
    expect(widziane["/v1/exercise-categories"]).toEqual(oczekiwane);
  });
});
