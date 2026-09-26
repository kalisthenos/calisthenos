import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import {
  OnboardingFormError,
  getFormForTrainer,
  getFormStatusForTrainee,
  getPendingFormForTrainee,
  hasPendingOnboarding,
  submitOnboardingForm,
} from "./onboarding-forms";

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

function pusto(status: number): Response {
  return new Response(null, { status });
}

// Koperta błędu BE: `{ error: { code, message, details } }` — dokładnie to, co
// rozbiera `parseApiError` (idiom z `plans.test.ts`).
function odmowa(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, { error: { code, message, details } });
}

const PULL_UP = {
  id: "i-1",
  exerciseId: "e-1",
  exerciseName: "Pull-up",
  unit: "REPS" as const,
  ordinal: 0,
};
const PLANK = {
  id: "i-2",
  exerciseId: "e-2",
  exerciseName: "Plank",
  unit: "SEC" as const,
  ordinal: 1,
};

const OCZEKUJACY = { id: "f-1", trainerNote: "Wykonaj na świeżo.", items: [PULL_UP, PLANK] };

const WYNIKI = {
  id: "f-1",
  trainerNote: "Wykonaj na świeżo.",
  traineeNote: "Byłem po treningu nóg.",
  completedAt: "2026-08-21T08:00:00.000Z",
  createdAt: "2026-08-20T10:00:00.000Z",
  items: [
    { ...PULL_UP, value: 8, comment: "ostatnie na siłę" },
    { ...PLANK, value: 45, comment: null },
  ],
};

const BRAK = () => odmowa(404, "RESOURCE_NOT_FOUND", "Nie znaleziono zasobu.");

describe("getPendingFormForTrainee / hasPendingOnboarding — bramka formularza startowego", () => {
  it("oczekujący formularz idzie z `GET /v1/me/onboarding-form` z zamrożoną jednostką pozycji", async () => {
    // Jednostka przychodzi z POZYCJI, nie z biblioteki: trener może później
    // przełączyć ćwiczenie na sekundy, a wynik ma znaczyć to, co znaczył.
    let sciezka = "";
    let metoda = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return json(200, OCZEKUJACY);
    });

    const wynik = await getPendingFormForTrainee(api);

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/me/onboarding-form");
    expect(wynik?.items.map((i) => [i.exerciseName, i.unit])).toEqual([
      ["Pull-up", "REPS"],
      ["Plank", "SEC"],
    ]);
    expect(wynik?.trainerNote).toBe("Wykonaj na świeżo.");
  });

  it("`404` (brak oczekującego formularza — także po wypełnieniu) daje `null`, a bramka `false`", async () => {
    // Kontrakt oddaje wyłącznie oczekujący: wypełniony i nigdy niedoczepiony
    // wyglądają tak samo, i oba znaczą „wpuść".
    const api = klient(BRAK);

    expect(await getPendingFormForTrainee(api)).toBeNull();
    expect(await hasPendingOnboarding(api)).toBe(false);
  });

  it("bramka mówi `true` przy `200` — jedno żądanie, żadnego liczenia", async () => {
    let wywolan = 0;
    const api = klient(() => {
      wywolan += 1;
      return json(200, OCZEKUJACY);
    });

    expect(await hasPendingOnboarding(api)).toBe(true);
    expect(wywolan).toBe(1);
  });

  it("awaria BE (`500`) NIE jest brakiem formularza — ApiError leci dalej, bramka nie mówi `false`", async () => {
    // `orNull` łyka wyłącznie `404`. Gdyby łykał wszystko, awaria BE wpuszczałaby
    // do aplikacji kogoś, kogo bramka ma zatrzymać.
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await hasPendingOnboarding(api).catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect((blad as ApiError).status).toBe(500);
  });
});

describe("submitOnboardingForm — wysyłka kompletu odpowiedzi", () => {
  const ODPOWIEDZI = {
    answers: [
      { itemId: "i-1", value: 8, comment: "ostatnie na siłę" },
      { itemId: "i-2", value: 45, comment: null },
    ],
    traineeNote: "Byłem po treningu nóg.",
  };

  it("to `POST /v1/me/onboarding-form` z ciałem składanym pole po polu", async () => {
    // Bez identyfikatora formularza ani podopiecznego — formularz wybiera BE po
    // tożsamości z tokenu. Klucze dokładnie z `SubmitOnboardingFormDto`: pole
    // spoza DTO to `400` (forbidNonWhitelisted), a typy nadmiaru nie zgłoszą.
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return pusto(204);
    });

    await submitOnboardingForm(api, ODPOWIEDZI);

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/me/onboarding-form");
    expect(cialo).toEqual(ODPOWIEDZI);
  });

  it("`409 ONBOARDING_FORM_ALREADY_COMPLETED` i `409 ONBOARDING_FORM_INCOMPLETE` idą do formularza jako OnboardingFormError", async () => {
    // Drugie kliknięcie „Gotowe" odbija się od bazy po stronie BE; niekomplet
    // to też niezmiennik domenowy, więc `409`, nie `400`. Oba mają zostać
    // zdaniem w formularzu, nie ekranem błędu.
    const wypelniony = klient(() =>
      odmowa(409, "ONBOARDING_FORM_ALREADY_COMPLETED", "Ten formularz jest już wypełniony."),
    );
    const niekomplet = klient(() =>
      odmowa(
        409,
        "ONBOARDING_FORM_INCOMPLETE",
        "Formularz jest niekompletny — wypełnij wszystkie pozycje.",
      ),
    );

    const bladDrugiego = await submitOnboardingForm(wypelniony, ODPOWIEDZI).catch((e) => e);
    const bladNiekompletu = await submitOnboardingForm(niekomplet, ODPOWIEDZI).catch((e) => e);

    expect(bladDrugiego).toBeInstanceOf(OnboardingFormError);
    expect((bladDrugiego as OnboardingFormError).userMessage).toBe(
      "Ten formularz jest już wypełniony.",
    );
    expect(bladNiekompletu).toBeInstanceOf(OnboardingFormError);
    expect((bladNiekompletu as OnboardingFormError).userMessage).toBe(
      "Formularz jest niekompletny — wypełnij wszystkie pozycje.",
    );
  });

  it("`404` (trener nie doczepił formularza) przelatuje jako ApiError", async () => {
    // Loader odesłałby taką osobę z trasy, zanim zobaczyłaby przycisk — `404`
    // w akcji jest anomalią, nie zdaniem do formularza.
    const api = klient(BRAK);

    const blad = await submitOnboardingForm(api, ODPOWIEDZI).catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(OnboardingFormError);
  });

  it("`500` przechodzi jako ApiError — awaria BE ma zostać awarią", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await submitOnboardingForm(api, ODPOWIEDZI).catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(OnboardingFormError);
  });
});

describe("getFormForTrainer / getFormStatusForTrainee — wyniki u trenera", () => {
  it("wyniki idą z `GET /v1/trainees/{traineeId}/onboarding-form` z wartościami i komentarzami", async () => {
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, WYNIKI);
    });

    const wynik = await getFormForTrainer(api, "t-1");

    expect(sciezka).toBe("/v1/trainees/t-1/onboarding-form");
    expect(wynik?.completedAt).toBe("2026-08-21T08:00:00.000Z");
    expect(wynik?.traineeNote).toBe("Byłem po treningu nóg.");
    expect(wynik?.items.map((i) => [i.value, i.comment])).toEqual([
      [8, "ostatnie na siłę"],
      [45, null],
    ]);
  });

  it("`404` (cudzy podopieczny ALBO formularz nie doczepiony) daje `null`", async () => {
    // Jedno i drugie wygląda po tamtej stronie tak samo — trasa robi z `null`
    // własne 404, a przegląd klienta chowa link do formularza.
    const api = klient(BRAK);

    expect(await getFormForTrainer(api, "t-x")).toBeNull();
  });

  it("status plakietki wyprowadza się z `completedAt` TEJ SAMEJ odpowiedzi: `null` czeka, data — wypełniony, `404` — brak", async () => {
    // Kontrakt nie ma osobnej trasy statusu; projekcja zostaje w kształcie,
    // który czyta przegląd klienta (`completedAtISO`), do przepięcia tamtego
    // ekranu w fali 2.
    const czeka = klient(() => json(200, { ...WYNIKI, completedAt: null, traineeNote: null }));
    const wypelniony = klient(() => json(200, WYNIKI));
    const brak = klient(BRAK);

    expect(await getFormStatusForTrainee(czeka, "t-1")).toEqual({ completedAtISO: null });
    expect(await getFormStatusForTrainee(wypelniony, "t-1")).toEqual({
      completedAtISO: "2026-08-21T08:00:00.000Z",
    });
    expect(await getFormStatusForTrainee(brak, "t-x")).toBeNull();
  });
});
