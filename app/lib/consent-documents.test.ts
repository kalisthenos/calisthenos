import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import { consentDocument } from "./consent-documents";

function klient(reguly: (req: Request) => Response | Promise<Response>) {
  return createApiClient({
    baseUrl: "http://be.test",
    // Trasa dokumentu jest publiczna: czyta ją też ktoś, kto jeszcze nie ma konta.
    getToken: () => undefined,
    fetch: (async (req: Request) => reguly(req)) as unknown as typeof fetch,
  });
}

function json(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Koperta błędu BE: `{ error: { code, message, details } }`.
function odmowa(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

const DOKUMENT = {
  key: "terms-of-service",
  versionNumber: 2,
  title: "Regulamin",
  content: "# Regulamin\n\nTreść **dokumentu** w Markdownie.",
  effectiveFrom: "2026-10-01T00:00:00.000Z",
};

describe("consentDocument — treść dokumentu zgody w wersji", () => {
  it("to `GET /v1/consents/{key}/versions/{versionNumber}` i oddaje dokument nietknięty", async () => {
    // Numer wersji jedzie w ścieżce jako liczba, klucz jako tekst — trasa dokumentu bierze
    // je z adresu `/dokumenty/:klucz/:wersja`, a odnośniki z formularza rejestracji mają
    // dokładnie tę parę (klucz i numer wersji z podglądu linku).
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return json(200, DOKUMENT);
    });

    const dokument = await consentDocument(api, "terms-of-service", 2);

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/consents/terms-of-service/versions/2");
    expect(dokument).toEqual(DOKUMENT);
  });

  it.each([
    ["CONSENT_DEFINITION_NOT_FOUND", "Nie ma zgody o tym kluczu."],
    ["CONSENT_VERSION_NOT_FOUND", "Ta zgoda nie ma wersji o tym numerze."],
  ])(
    "`404 %s` daje `null` — brak zgody i brak wersji nie są rozróżniane",
    async (code, message) => {
      // Reguła D3: funkcja z `| null` w sygnaturze łapie `404`. Trasa zamienia `null` na `404`.
      const api = klient(() => odmowa(404, code, message));

      await expect(consentDocument(api, "nie-ma", 1)).resolves.toBeNull();
    },
  );

  it("`500` przechodzi jako ApiError, nie jako brak dokumentu", async () => {
    // Gdyby awaria BE wracała tu jako `null`, trasa pokazałaby `404` — czyli „tego dokumentu
    // nie ma” — przy regulaminie, który istnieje.
    const api = klient(() => odmowa(500, "INTERNAL_ERROR", "Coś poszło nie tak."));

    const blad = await consentDocument(api, "terms-of-service", 2).catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(ApiError);
  });
});
