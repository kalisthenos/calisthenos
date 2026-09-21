import { describe, expect, it, vi } from "vitest";

// `body-photos.ts` importuje `file-uploads.ts` (limit rozmiaru) i `api/client.ts`
// (`publicFileUrl`) — oba czytają `getEnv()`. Bez mocka test wysadza się na braku
// zmiennych środowiskowych, zanim dojdzie do asercji. Adres publiczny jest INNY
// niż `be.test` z klienta testowego świadomie: w produkcji `API_URL` bywa siecią
// prywatną, a do `<img src>` idzie `API_PUBLIC_URL` (wzorzec: `exercises.test.ts`).
vi.mock("~/lib/env", () => ({
  getEnv: () => ({
    MAX_UPLOAD_BYTES: 250_000_000,
    MAX_VIDEO_UPLOAD_BYTES: 30_000_000,
    API_URL: "http://be.internal",
    API_PUBLIC_URL: "https://api.kalisthenos.test",
  }),
}));

import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import type { BodyPhotoDto } from "./body-photos";
import {
  BodyPhotoError,
  addBodyPhoto,
  deleteBodyPhoto,
  getSideBySidePhotoPairs,
  listAllMyBodyPhotos,
  listAllTraineeBodyPhotos,
  listMyBodyPhotos,
} from "./body-photos";

// `Promise<Response>` w sygnaturze jest konieczne: część przypadków niżej czyta
// ciało żądania (`await req.json()`), więc reguła bywa funkcją asynchroniczną.
function klient(reguly: (req: Request) => Response | Promise<Response>) {
  return createApiClient({
    baseUrl: "http://be.test",
    getToken: () => "T",
    fetch: (async (req: Request) => reguly(req)) as unknown as typeof fetch,
  });
}

function json(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Koperta błędu BE: `{ error: { code, message, details } }` — patrz `parseApiError`. */
function odmowa(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function zdjecie(over: Partial<BodyPhotoDto> = {}): BodyPhotoDto {
  return {
    id: "bp-1",
    view: "front",
    takenOn: "2026-08-01",
    note: null,
    photoUrl: "/v1/files/f-1?exp=1&sig=aa",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function strona(items: BodyPhotoDto[], page = 1, totalPages = 1, total = items.length) {
  return { items, page, totalPages, total };
}

describe("listMyBodyPhotos — własna galeria na kontrakcie", () => {
  it("idzie pod `/v1/me/body-photos` ze stroną i sortowaniem przetłumaczonym na nazwy kontraktu", async () => {
    // Adres listy jest zakładkowalny (`?sort=newest`), a kontrakt nazywa
    // sortowania inaczej — dlatego, inaczej niż w planach, jest tu słownik.
    let sciezka = "";
    let zapytanie = "";
    const api = klient((req) => {
      const url = new URL(req.url);
      sciezka = url.pathname;
      zapytanie = url.search;
      return json(200, strona([zdjecie()]));
    });

    await listMyBodyPhotos(api, { page: 3, sort: "newest" });

    expect(sciezka).toBe("/v1/me/body-photos");
    expect(zapytanie).toContain("page=3");
    expect(zapytanie).toContain("sort=taken_on_desc");
  });

  it("`oldest` idzie jako `taken_on_asc`", async () => {
    let zapytanie = "";
    const api = klient((req) => {
      zapytanie = new URL(req.url).search;
      return json(200, strona([zdjecie()]));
    });

    await listMyBodyPhotos(api, { page: 1, sort: "oldest" });

    expect(zapytanie).toContain("sort=taken_on_asc");
  });

  it("`photoUrl` dostaje origin z `API_PUBLIC_URL`, a liczby strony wracają z kontraktu", async () => {
    // Ścieżka wstawiona wprost w `src` rozwiązałaby się względem origin FE,
    // gdzie trasy plików już nie ma — i to bez żadnego błędu, bo puste `<img>`
    // wygląda dokładnie jak brak zdjęcia. Origin dokłada MODUŁ, nie trasa.
    const api = klient(() => json(200, strona([zdjecie()], 2, 4, 187)));

    const wynik = await listMyBodyPhotos(api, { page: 2, sort: "newest" });

    expect(wynik.items[0]?.photoUrl).toBe("https://api.kalisthenos.test/v1/files/f-1?exp=1&sig=aa");
    expect(wynik.page).toBe(2);
    expect(wynik.totalPages).toBe(4);
    expect(wynik.total).toBe(187);
  });

  it("`500` przechodzi jako ApiError — awaria BE ma zostać awarią", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await listMyBodyPhotos(api, { page: 1, sort: "newest" }).catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
  });
});

describe("listAllMyBodyPhotos / listAllTraineeBodyPhotos — sklejone strony", () => {
  it("dociąga kolejne strony aż do `totalPages` i zwraca jedną listę", async () => {
    // Porównanie „przed / po" musi widzieć WSZYSTKIE zdjęcia ujęcia, a kontrakt
    // stronicuje po 60 i nie ma parametru „wszystko" (precedens: `exercises.ts`).
    const strony: string[] = [];
    const api = klient((req) => {
      const url = new URL(req.url);
      const page = url.searchParams.get("page") ?? "";
      strony.push(page);
      return json(200, strona([zdjecie({ id: `bp-${page}` })], Number(page), 3, 3));
    });

    const wynik = await listAllMyBodyPhotos(api);

    expect(strony).toEqual(["1", "2", "3"]);
    expect(wynik.map((p) => p.id)).toEqual(["bp-1", "bp-2", "bp-3"]);
  });

  it("galeria podopiecznego idzie pod `/v1/trainees/{id}/body-photos`, z originem na adresach", async () => {
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      // Kontrakt dokłada tu `pairs` policzone po stronie BE — moduł ich świadomie
      // NIE czyta, bo nie znają stanów „jedno zdjęcie" i „brak zdjęć".
      return json(200, { ...strona([zdjecie()]), pairs: [] });
    });

    const wynik = await listAllTraineeBodyPhotos(api, "t-1");

    expect(sciezka).toBe("/v1/trainees/t-1/body-photos");
    expect(wynik[0]?.photoUrl).toBe("https://api.kalisthenos.test/v1/files/f-1?exp=1&sig=aa");
  });
});

function foto(bajtow: number): File {
  return new File([new Uint8Array(bajtow)], "foto.jpg", { type: "image/jpeg" });
}

describe("addBodyPhoto — dwie fazy: plik, potem zdjęcie", () => {
  it("wysyła plik, potwierdza go i dopiero potem zapisuje zdjęcie z `fileId`", async () => {
    const trafienia: string[] = [];
    let cialo: unknown;
    const api = klient(async (req) => {
      const sciezka = new URL(req.url).pathname;
      trafienia.push(`${req.method} ${sciezka}`);
      if (sciezka === "/v1/files/body-photo") {
        return json(201, { id: "f-9", bytes: 10, mimeType: "image/jpeg" });
      }
      if (sciezka === "/v1/me/body-photos") {
        cialo = await req.json();
        return json(201, zdjecie({ id: "bp-9" }));
      }
      return new Response(null, { status: 204 });
    });

    const id = await addBodyPhoto(api, {
      file: foto(10),
      view: "side",
      takenOn: "2026-09-01",
      note: "waga 72,4 kg",
    });

    expect(id).toBe("bp-9");
    expect(trafienia).toEqual([
      "POST /v1/files/body-photo",
      "POST /v1/files/f-9/confirm",
      "POST /v1/me/body-photos",
    ]);
    // Ciało składane pole po polu: `trainerId`/`traineeId` byłyby polami spoza
    // DTO, czyli `400` (`forbidNonWhitelisted`), a typy strukturalne tego nie zgłoszą.
    expect(cialo).toEqual({
      fileId: "f-9",
      view: "side",
      takenOn: "2026-09-01",
      note: "waga 72,4 kg",
    });
  });

  it("`400` z zapisu zdjęcia wraca jako BodyPhotoError z komunikatem BE", async () => {
    const api = klient((req) => {
      const sciezka = new URL(req.url).pathname;
      if (sciezka === "/v1/files/body-photo") {
        return json(201, { id: "f-9", bytes: 10, mimeType: "image/jpeg" });
      }
      if (sciezka === "/v1/me/body-photos") {
        return odmowa(400, "VALIDATION_FAILED", "Data wykonania jest nieprawidłowa.");
      }
      return new Response(null, { status: 204 });
    });

    const blad = await addBodyPhoto(api, {
      file: foto(10),
      view: "front",
      takenOn: "2026-13-01",
      note: null,
    }).catch((e) => e);

    expect(blad).toBeInstanceOf(BodyPhotoError);
    expect((blad as BodyPhotoError).userMessage).toBe("Data wykonania jest nieprawidłowa.");
  });

  it("`500` z zapisu zdjęcia przechodzi jako ApiError, nie jako komunikat o zdjęciu", async () => {
    const api = klient((req) => {
      const sciezka = new URL(req.url).pathname;
      if (sciezka === "/v1/files/body-photo") {
        return json(201, { id: "f-9", bytes: 10, mimeType: "image/jpeg" });
      }
      if (sciezka === "/v1/me/body-photos") {
        return odmowa(500, "INTERNAL", "Ups.");
      }
      return new Response(null, { status: 204 });
    });

    const blad = await addBodyPhoto(api, {
      file: foto(10),
      view: "front",
      takenOn: "2026-09-01",
      note: null,
    }).catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(BodyPhotoError);
  });
});

describe("deleteBodyPhoto — kasowanie własnego zdjęcia", () => {
  it("idzie `DELETE /v1/me/body-photos/{id}`", async () => {
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return new Response(null, { status: 204 });
    });

    await deleteBodyPhoto(api, "bp-1");

    expect(metoda).toBe("DELETE");
    expect(sciezka).toBe("/v1/me/body-photos/bp-1");
  });

  it("`404` (cudze albo już usunięte) wraca jako BodyPhotoError, `500` jako ApiError", async () => {
    // Kliknięcie w nieaktualny przycisk ma skończyć się zdaniem przy galerii,
    // nie ekranem błędu; awaria serwera — odwrotnie.
    const brak = klient(() => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono zdjęcia."));
    const awaria = klient(() => odmowa(500, "INTERNAL", "Ups."));

    const odrzucone = await deleteBodyPhoto(brak, "bp-x").catch((e) => e);
    const blad = await deleteBodyPhoto(awaria, "bp-1").catch((e) => e);

    expect(odrzucone).toBeInstanceOf(BodyPhotoError);
    expect((odrzucone as BodyPhotoError).userMessage).toBe("Nie znaleziono zdjęcia.");
    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(BodyPhotoError);
  });
});

describe("getSideBySidePhotoPairs — parowanie zdjęć (czysta funkcja)", () => {
  it("bierze najstarsze i najnowsze zdjęcie ujęcia, niezależnie od kolejności wejścia", () => {
    // Lista przychodzi z kontraktu od najnowszego; funkcja wybiera skrajne po
    // `takenOn`, nie po pozycji w tablicy — inaczej odwrócenie sortowania
    // zamieniłoby „pierwsze" z „ostatnim" i porównanie pokazałoby regres.
    const pary = getSideBySidePhotoPairs([
      zdjecie({ id: "a3", view: "front", takenOn: "2026-08-20" }),
      zdjecie({ id: "a1", view: "front", takenOn: "2026-06-01" }),
      zdjecie({ id: "a2", view: "front", takenOn: "2026-07-01" }),
    ]);

    const front = pary.find((p) => p.view === "front");
    expect(front?.first?.id).toBe("a1");
    expect(front?.latest?.id).toBe("a3");
    expect(front?.hasPair).toBe(true);
    expect(front?.daysBetween).toBe(80);
  });

  it("adresy w parze są tymi, które przyszły z listy — funkcja niczego nie podpisuje", () => {
    const pary = getSideBySidePhotoPairs([
      zdjecie({ id: "a1", takenOn: "2026-06-01", photoUrl: "https://api.test/v1/files/x" }),
      zdjecie({ id: "a2", takenOn: "2026-07-01", photoUrl: "https://api.test/v1/files/y" }),
    ]);

    const front = pary.find((p) => p.view === "front");
    expect(front?.first?.url).toBe("https://api.test/v1/files/x");
    expect(front?.latest?.url).toBe("https://api.test/v1/files/y");
  });

  it("jedno zdjęcie w ujęciu to nie para, a ujęcie bez zdjęć daje pustą pozycję", () => {
    // Trzy pozycje ZAWSZE: ekran rysuje kafelek także dla ujęcia bez zdjęć
    // („brak zdjęć") i dla ujęcia z jednym („jedno zdjęcie") — dlatego moduł
    // nie czyta `pairs` z kontraktu, które takich stanów nie zna.
    const pary = getSideBySidePhotoPairs([zdjecie({ id: "s1", view: "side" })]);

    expect(pary.map((p) => p.view)).toEqual(["front", "side", "back"]);

    const side = pary.find((p) => p.view === "side");
    expect(side?.hasPair).toBe(false);
    expect(side?.daysBetween).toBeNull();
    expect(side?.first?.id).toBe("s1");
    expect(side?.latest?.id).toBe("s1");

    const back = pary.find((p) => p.view === "back");
    expect(back).toEqual({
      view: "back",
      first: null,
      latest: null,
      hasPair: false,
      daysBetween: null,
    });
  });

  it("remis daty rozstrzyga `createdAt`, żeby porównanie nie mrugało między żądaniami", () => {
    const pary = getSideBySidePhotoPairs([
      zdjecie({ id: "p", takenOn: "2026-06-01", createdAt: "2026-06-01T18:00:00.000Z" }),
      zdjecie({ id: "r", takenOn: "2026-06-01", createdAt: "2026-06-01T06:00:00.000Z" }),
    ]);

    const front = pary.find((p) => p.view === "front");
    expect(front?.first?.id).toBe("r");
    expect(front?.latest?.id).toBe("p");
    // Ten sam dzień: para istnieje (dwa różne zdjęcia), ale różnica to zero dni.
    expect(front?.hasPair).toBe(true);
    expect(front?.daysBetween).toBe(0);
  });
});
