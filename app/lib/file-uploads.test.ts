import { describe, expect, it, vi } from "vitest";

// `maxUploadBytesFor` czyta `getEnv()` domyślnym argumentem. Bez mocka test
// wysadza się na braku zmiennych środowiskowych, zanim dojdzie do asercji.
vi.mock("~/lib/env", () => ({
  getEnv: () => ({ MAX_UPLOAD_BYTES: 250_000_000, MAX_VIDEO_UPLOAD_BYTES: 30_000_000 }),
}));

import { createApiClient } from "~/lib/api/client";
import { ApiError } from "~/lib/api/errors";
import {
  UploadError,
  maxUploadBytesFor,
  uploadBodyPhoto,
  uploadExerciseDemo,
  uploadSetVideo,
} from "./file-uploads";

describe("maxUploadBytesFor", () => {
  const limits = { MAX_UPLOAD_BYTES: 250_000_000, MAX_VIDEO_UPLOAD_BYTES: 30_000_000 };

  it("stosuje niższy limit wideo wyłącznie dla nagrań serii", () => {
    expect(maxUploadBytesFor("set_video", limits)).toBe(30_000_000);
  });

  it("stosuje ogólny limit dla demo ćwiczeń i zdjęć sylwetki", () => {
    // Limity są lustrem `UPLOAD_LIMIT_SOURCE` po stronie BE, nie własną regułą FE:
    // limit surowszy od kontraktu odrzucałby w przeglądarce pliki, które BE
    // przyjmuje bez zastrzeżeń.
    expect(maxUploadBytesFor("exercise_demo", limits)).toBe(250_000_000);
    expect(maxUploadBytesFor("body_photo", limits)).toBe(250_000_000);
  });
});

function klientPlikow(reguly: (req: Request) => Response | Promise<Response>) {
  return createApiClient({
    baseUrl: "http://be.test",
    getToken: () => "T",
    fetch: (async (req: Request) => reguly(req)) as unknown as typeof fetch,
  });
}

function wideo(bajtow: number): File {
  return new File([new Uint8Array(bajtow)], "demo.mp4", { type: "video/mp4" });
}

function zdjecie(bajtow: number): File {
  return new File([new Uint8Array(bajtow)], "sylwetka.jpg", { type: "image/jpeg" });
}

/**
 * Plik o ROZMIARZE ponad limit, bez alokowania tylu bajtów — limit ogólny to dziś
 * 250 MB (zgodnie z kontraktem), a prawdziwy bufor tej wielkości w teście
 * jednostkowym byłby kosztem bez wartości: sprawdzana gałąź patrzy wyłącznie
 * na `file.size`.
 */
function oRozmiarze(plik: File, bajtow: number): File {
  Object.defineProperty(plik, "size", { value: bajtow });
  return plik;
}

describe("uploadExerciseDemo — wysyłka demo przez kontrakt", () => {
  it("pusty plik odrzuca bez wywołania sieci", async () => {
    let wywolan = 0;
    const api = klientPlikow(() => {
      wywolan += 1;
      return new Response(null, { status: 201 });
    });

    await expect(uploadExerciseDemo(api, wideo(0))).rejects.toBeInstanceOf(UploadError);
    expect(wywolan).toBe(0);
  });

  it("plik ponad limit odrzuca bez wywołania sieci", async () => {
    // Plik jest już w pamięci po `request.formData()`, więc sprawdzenie tutaj
    // oszczędza wysłanie kilkudziesięciu megabajtów po to, żeby usłyszeć `413`.
    let wywolan = 0;
    const api = klientPlikow(() => {
      wywolan += 1;
      return new Response(null, { status: 201 });
    });

    const blad = await uploadExerciseDemo(api, oRozmiarze(wideo(1), 250_000_001)).catch(
      (e: unknown) => e,
    );

    expect(blad).toBeInstanceOf(UploadError);
    expect((blad as UploadError).userMessage).toContain("Plik za duży");
    expect(wywolan).toBe(0);
  });

  it("wysyła multipartem i potwierdza plik", async () => {
    // Druga faza (`confirm`) jest dziś po stronie BE udokumentowanym no-opem —
    // wołamy ją, bo kontrakt tak deklaruje protokół, a weryfikacja wraca do życia
    // przy wysyłce prosto do magazynu. Pliku przed zamiataczem sierot broni
    // podpięcie (`PATCH`), nie to wywołanie.
    const trafienia: string[] = [];
    let typZawartosci = "";
    const api = klientPlikow((req) => {
      const sciezka = new URL(req.url).pathname;
      trafienia.push(`${req.method} ${sciezka}`);
      if (sciezka === "/v1/files/exercise-demo") {
        typZawartosci = req.headers.get("content-type") ?? "";
        return new Response(JSON.stringify({ id: "f-1", bytes: 10, mimeType: "video/mp4" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    });

    const wynik = await uploadExerciseDemo(api, wideo(10));

    expect(wynik).toBe("f-1");
    expect(trafienia).toEqual(["POST /v1/files/exercise-demo", "POST /v1/files/f-1/confirm"]);
    expect(typZawartosci).toContain("multipart/form-data");
  });

  it("413 z kontraktu wraca jako UploadError z komunikatem BE", async () => {
    const api = klientPlikow(
      () =>
        new Response(
          JSON.stringify({ error: { code: "FILE_TOO_LARGE", message: "Plik jest za duży." } }),
          { status: 413, headers: { "content-type": "application/json" } },
        ),
    );

    const blad = await uploadExerciseDemo(api, wideo(10)).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(UploadError);
    expect((blad as UploadError).userMessage).toBe("Plik jest za duży.");
  });

  it("awaria BE NIE zamienia się w UploadError", async () => {
    // Ta sama wąskość co przy `CategoryError`: gdyby moduł łykał każdy błąd,
    // awaria serwera pokazałaby się w formularzu jako problem z plikiem —
    // komunikat kierujący użytkownika na fałszywy trop i ukrywający usterkę.
    const api = klientPlikow(
      () =>
        new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Ups." } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    const blad = await uploadExerciseDemo(api, wideo(10)).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(UploadError);
  });
});

describe("uploadSetVideo — nagranie serii przez kontrakt", () => {
  it("wysyła multipartem na `/v1/files/set-video` i potwierdza plik", async () => {
    // Rodzaj pliku wynika z użytej operacji, nie z parametru (`docs/04` §8) —
    // ta sama dwufazowa ścieżka co demo, inny adres pierwszej fazy.
    const trafienia: string[] = [];
    const api = klientPlikow((req) => {
      const sciezka = new URL(req.url).pathname;
      trafienia.push(`${req.method} ${sciezka}`);
      if (sciezka === "/v1/files/set-video") {
        return new Response(JSON.stringify({ id: "f-2", bytes: 10, mimeType: "video/mp4" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    });

    expect(await uploadSetVideo(api, wideo(10))).toBe("f-2");
    expect(trafienia).toEqual(["POST /v1/files/set-video", "POST /v1/files/f-2/confirm"]);
  });

  it("stosuje NIŻSZY limit wideo (30 MB) i odrzuca bez wywołania sieci", async () => {
    // Demo ćwiczenia ma limit ogólny (250 MB), nagranie serii — limit wideo.
    // Wspólna ścieżka musi wziąć limit z rodzaju, nie z jednej stałej.
    let wywolan = 0;
    const api = klientPlikow(() => {
      wywolan += 1;
      return new Response(null, { status: 201 });
    });

    const blad = await uploadSetVideo(api, oRozmiarze(wideo(1), 30_000_001)).catch(
      (e: unknown) => e,
    );

    expect(blad).toBeInstanceOf(UploadError);
    expect((blad as UploadError).userMessage).toContain("30 MB");
    expect(wywolan).toBe(0);
  });

  it("`413` z kontraktu wraca jako UploadError z komunikatem BE, a `500` jako ApiError", async () => {
    const zaDuzy = klientPlikow(
      () =>
        new Response(
          JSON.stringify({
            error: { code: "FILE_TOO_LARGE", message: "Plik przekracza limit rozmiaru." },
          }),
          {
            status: 413,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const awaria = klientPlikow(
      () =>
        new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Ups." } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    const odmowa = await uploadSetVideo(zaDuzy, wideo(10)).catch((e: unknown) => e);
    const blad = await uploadSetVideo(awaria, wideo(10)).catch((e: unknown) => e);

    expect(odmowa).toBeInstanceOf(UploadError);
    expect((odmowa as UploadError).userMessage).toBe("Plik przekracza limit rozmiaru.");
    expect(blad).toBeInstanceOf(ApiError);
  });
});

describe("uploadBodyPhoto — trzecia i ostatnia ścieżka wysyłki", () => {
  it("wysyła multipartem na `/v1/files/body-photo` i potwierdza plik", async () => {
    // Ten sam protokół co dwie pozostałe ścieżki; po nim na wolumenie FE nie
    // powstaje już żaden nowy plik.
    const trafienia: string[] = [];
    let typZawartosci = "";
    const api = klientPlikow((req) => {
      const sciezka = new URL(req.url).pathname;
      trafienia.push(`${req.method} ${sciezka}`);
      if (sciezka === "/v1/files/body-photo") {
        typZawartosci = req.headers.get("content-type") ?? "";
        return new Response(JSON.stringify({ id: "f-3", bytes: 10, mimeType: "image/jpeg" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    });

    expect(await uploadBodyPhoto(api, zdjecie(10))).toBe("f-3");
    expect(trafienia).toEqual(["POST /v1/files/body-photo", "POST /v1/files/f-3/confirm"]);
    expect(typZawartosci).toContain("multipart/form-data");
  });

  it("stosuje limit OGÓLNY (250 MB), nie limit wideo", async () => {
    // Zdjęcie z aparatu telefonu bywa duże; niższy limit wideo odrzucałby tu
    // pliki, które BE przyjmuje (`UPLOAD_LIMIT_SOURCE.body_photo`). Komunikat
    // niesie wartość limitu, więc odróżnia jeden próg od drugiego — a plik
    // przekraczający go odbija się BEZ wywołania sieci.
    let wywolan = 0;
    const api = klientPlikow(() => {
      wywolan += 1;
      return new Response(null, { status: 201 });
    });

    const blad = await uploadBodyPhoto(api, oRozmiarze(zdjecie(1), 250_000_001)).catch(
      (e: unknown) => e,
    );

    expect(blad).toBeInstanceOf(UploadError);
    expect((blad as UploadError).userMessage).toContain("250 MB");
    expect(wywolan).toBe(0);
  });

  it("pusty plik odrzuca bez wywołania sieci, a `500` przechodzi jako ApiError", async () => {
    let wywolan = 0;
    const pusty = klientPlikow(() => {
      wywolan += 1;
      return new Response(null, { status: 201 });
    });
    const awaria = klientPlikow(
      () =>
        new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Ups." } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(uploadBodyPhoto(pusty, zdjecie(0))).rejects.toBeInstanceOf(UploadError);
    expect(wywolan).toBe(0);

    const blad = await uploadBodyPhoto(awaria, zdjecie(10)).catch((e: unknown) => e);
    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(UploadError);
  });
});
