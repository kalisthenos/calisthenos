import { describe, expect, it } from "vitest";
import { ApiError, komunikatLimitu, parseApiError, toRouteResponse } from "./errors";

describe("parseApiError — koperta kontraktu", () => {
  it("wyjmuje kod, komunikat i szczegóły", () => {
    const blad = parseApiError(409, {
      error: {
        code: "TRAINEE_HAS_OTHER_TIES",
        message: "Ten podopieczny prowadzi kogoś innego.",
        details: { reason: "coaches-others" },
      },
    });

    expect(blad.status).toBe(409);
    expect(blad.code).toBe("TRAINEE_HAS_OTHER_TIES");
    expect(blad.message).toBe("Ten podopieczny prowadzi kogoś innego.");
    expect(blad.details).toEqual({ reason: "coaches-others" });
  });

  it.each([
    ["ciało nie-JSON (proxy oddało HTML)", "<html>502</html>"],
    ["JSON bez koperty", { statusCode: 500, message: "Internal" }],
    ["koperta bez kodu", { error: { message: "coś" } }],
    ["null", null],
  ])("%s → błąd zastępczy, bez wyjątku", (_opis, cialo) => {
    // Nie każda odpowiedź na drodze do BE pochodzi z BE: proxy, load balancer
    // i przerwane połączenie oddają co innego. Wyjątek przy parsowaniu błędu
    // zamieniłby czytelny komunikat w `500` bez śladu, co się stało.
    const blad = parseApiError(502, cialo);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad.status).toBe(502);
    expect(blad.code).toBe("UNKNOWN");
    expect(blad.message.length).toBeGreaterThan(0);
  });

  it("niesie Retry-After, gdy wywołujący go poda", () => {
    // Nagłówek jest jedynym miejscem, gdzie BE podaje czas oczekiwania —
    // koperta błędu go nie zawiera. Bez tego pola komunikat traci minuty.
    const blad = parseApiError(429, { error: { code: "RATE_LIMITED", message: "Za dużo." } }, 900);

    expect(blad.status).toBe(429);
    expect(blad.retryAfter).toBe(900);
  });

  it("bez nagłówka zostawia retryAfter pustym, nie zerowym", () => {
    // `0` znaczyłoby „próbuj teraz" — czyli co innego niż „nie wiem".
    expect(parseApiError(500, {}).retryAfter).toBeUndefined();
  });
});

describe("komunikatLimitu — treść dla `429`, wspólna dla logowania, zaproszenia i rejestracji", () => {
  it.each([
    [
      "brak nagłówka — ogólnie, nigdy „za NaN min”",
      undefined,
      "Za dużo prób. Spróbuj ponownie za chwilę.",
    ],
    ["0 s — nie mniej niż minuta", 0, "Za dużo prób. Spróbuj ponownie za 1 min."],
    ["61 s — minuty zaokrąglane w górę", 61, "Za dużo prób. Spróbuj ponownie za 2 min."],
    ["120 s — równe minuty bez naddatku", 120, "Za dużo prób. Spróbuj ponownie za 2 min."],
  ])("%s", (_opis, retryAfter, komunikat) => {
    // `0` pilnuje `Math.max(1, …)`, `61` pilnuje `Math.ceil`: bez pierwszego komunikat kazałby
    // próbować „za 0 min”, czyli od razu i na darmo; bez drugiego 61 s znaczyłoby jedną minutę
    // i użytkownik trafiłby jeszcze w okno limitu.
    expect(komunikatLimitu(retryAfter)).toBe(komunikat);
  });
});

describe("toRouteResponse — bramki przenoszone z zapytań na kody HTTP", () => {
  it("`403 ONBOARDING_FORM_PENDING` przekierowuje na formularz startowy", () => {
    // Do integracji ta bramka była zapytaniem do bazy w `_layout.tsx`
    // (`hasPendingOnboarding`). Po integracji niesie ją BE jako kod błędu —
    // ekran ma zostać ten sam.
    const odpowiedz = toRouteResponse(
      new ApiError(403, "ONBOARDING_FORM_PENDING", "Wypełnij formularz startowy."),
    );

    expect(odpowiedz.status).toBe(302);
    expect(odpowiedz.headers.get("Location")).toBe("/podopieczny/formularz");
  });

  it("`401` przekierowuje na logowanie", () => {
    // Osiągalne dopiero PO nieudanym odświeżeniu: token unieważniony po
    // stronie BE (wylogowanie ze wszystkich urządzeń).
    const odpowiedz = toRouteResponse(new ApiError(401, "UNAUTHORIZED", "Zaloguj się ponownie."));

    expect(odpowiedz.status).toBe(302);
    expect(odpowiedz.headers.get("Location")).toBe("/login");
  });

  it("`404` zostaje `404` — cudzy zasób jest nieodróżnialny od nieistniejącego", () => {
    const odpowiedz = toRouteResponse(new ApiError(404, "NOT_FOUND", "Nie znaleziono."));

    expect(odpowiedz.status).toBe(404);
  });

  it("`403` z innym kodem zostaje `403`, nie przekierowaniem", () => {
    // Przekierowanie na formularz w odpowiedzi na brak roli zapętliłoby
    // nawigację: formularz też odmawia, więc trasa odsyłałaby sama do siebie.
    const odpowiedz = toRouteResponse(new ApiError(403, "FORBIDDEN", "Brak dostępu."));

    expect(odpowiedz.status).toBe(403);
  });

  it("niesie komunikat BE dalej — jest już po polsku i dla użytkownika", async () => {
    const odpowiedz = toRouteResponse(
      new ApiError(409, "EXERCISE_IS_SKILL_VARIATION", "Ćwiczenie jest wariantem umiejętności."),
    );

    expect(odpowiedz.status).toBe(409);
    await expect(odpowiedz.text()).resolves.toContain("Ćwiczenie jest wariantem umiejętności.");
  });
});
