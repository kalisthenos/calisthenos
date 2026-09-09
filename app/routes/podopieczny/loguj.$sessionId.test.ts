// @vitest-environment node
//
// `node`, nie happy-dom, z tego samego powodu co `upload.wideo.test.ts`: ten test
// buduje `Request` z `FormData` i sprawdza rzucony przez akcję `Response`
// (przekierowanie po udanym zapisie) razem z jego nagłówkiem `Location`.
// W happy-dom `Request`/`Response` są innymi klasami niż Node-owe, więc
// `instanceof Response` i `formData()` potrafią się rozjechać.
import { describe, expect, it, vi } from "vitest";

// `withPublicDemoUrls` w `loadSessionForLogging` woła `publicFileUrl`, a ten czyta
// `getEnv().API_PUBLIC_URL`. Wzorzec i uzasadnienie: `workouts.test.ts`.
vi.mock("~/lib/env", () => ({
  getEnv: () => ({
    MAX_UPLOAD_BYTES: 250_000_000,
    MAX_VIDEO_UPLOAD_BYTES: 30_000_000,
    API_URL: "http://be.internal",
    API_PUBLIC_URL: "https://api.kalisthenos.test",
  }),
}));

import { RouterContextProvider } from "react-router";
import { createApiClient } from "~/lib/api/client";
import { type AuthUser, apiContext } from "~/lib/api/context";
import type { EntryDescriptor } from "~/lib/log-draft";

/**
 * Bramka AKCJI ekranu logowania — pierwszy test w `app/routes/podopieczny/`.
 *
 * **Dlaczego istnieje mimo braku testów renderujących.** W tym drzewie nie ma
 * `@testing-library/react`, więc komponentu tej trasy przetestować się nie da —
 * i przez to cały ekran długo nie miał żadnej bramki poza `tsc`. To była zła
 * inferencja: logika, o którą tu chodzi, **nie mieszka w komponencie**. Mieszka
 * w `action`, która jest zwykłą funkcją biorącą `Request` i kontekst. Da się jej
 * dowieść bez przeglądarki, dokładnie tak jak `loader` w
 * `app/routes/biblioteka-cwiczen.test.ts` — `RouterContextProvider` plus
 * `apiContext` z podstawionym transportem. Brak biblioteki do renderowania nie
 * jest więc usprawiedliwieniem dla braku testu akcji.
 *
 * **Co jest tu stawką.** Akcja liczy `allDone`, czyli to, czy sesja planu
 * policzy się jako zrobiona. Regresja w tym rachunku jest NIEWIDOCZNA aż do
 * chwili, gdy trener zobaczy u podopiecznego sesję opisaną nieprawdą — nie ma
 * błędu, nie ma pustego ekranu, jest liczba, która kłamie. Cztery przypadki
 * niżej to cztery reguły produktowe, na których stoi ten ekran, i każdy z nich
 * sprawdza WYSŁANE ciało, nie wartość pośrednią.
 *
 * **Czego ta bramka NIE łapie:** niczego z warstwy widoku — czy przycisk gaśnie
 * przy pięćdziesiątej serii, czy wybierak odsiewa właściwe ćwiczenia, czy pasek
 * postępu pokazuje sensowną liczbę. To idzie do scenariusza Playwrighta.
 */
const PODOPIECZNA: AuthUser = {
  id: "u-1",
  email: "anna@example.pl",
  displayName: "Anna Kowalska",
  roles: ["trainee"],
  trainerId: "t-1",
  trainerName: "Trener",
};

function json(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Sesja planu z `GET /v1/me/plan/sessions/{id}`. Akcja bierze z niej WYŁĄCZNIE
 * `id` (kanoniczne `planSessionId`) i fakt istnienia — kształt formularza
 * przychodzi ukrytym polem `entries`. Dlatego fixture jest minimalna: gdyby
 * akcja kiedykolwiek zaczęła znowu wyprowadzać kształt z sesji, testy niżej
 * zaczęłyby padać, i o to chodzi.
 */
const SESJA = {
  id: "s-1",
  name: "Push A",
  planId: "p-1",
  planStatus: "active" as const,
  blocks: [
    {
      id: "b-1",
      kind: "single" as const,
      sets: null,
      restSeconds: null,
      items: [
        {
          id: "i-1",
          exerciseId: "e-1",
          exerciseName: "Podciąganie",
          reps: 8,
          unit: "REPS" as const,
          tracksRpe: false,
          sets: 3,
          restSeconds: 90,
          note: null,
          demoUrl: null,
        },
      ],
    },
  ],
};

const UTWORZONY = {
  id: "l-1",
  performedOn: "2026-09-01",
  sessionName: "Push A",
  note: null,
  allDone: false,
  exercises: [],
  personalRecords: [],
};

interface Zapis {
  sciezka: string;
  cialo: Record<string, unknown>;
}

type Wynik =
  | { rodzaj: "blad"; error: string; zapisy: Zapis[] }
  | { rodzaj: "zapis"; location: string | null; zapisy: Zapis[] };

function deskryptor(over: Partial<EntryDescriptor> = {}): EntryDescriptor {
  return {
    exerciseId: "e-1",
    exerciseName: "Podciąganie",
    unit: "REPS",
    tracksRpe: false,
    origin: "planned",
    substitutedExerciseId: null,
    plannedSets: 3,
    setCount: 3,
    ...over,
  };
}

/** Formularz taki, jaki wysyła przeglądarka: deskryptory + pola `e_{i}_s_{j}_*`. */
function formularz(deskryptory: unknown, wiersze: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("performedOn", "2026-09-01");
  fd.set("entries", typeof deskryptory === "string" ? deskryptory : JSON.stringify(deskryptory));
  for (const [pole, wartosc] of Object.entries(wiersze)) fd.set(pole, wartosc);
  return fd;
}

/**
 * Wywołuje akcję przeciw podstawionemu transportowi. `GET` oddaje sesję planu,
 * `POST` jest ZAPISYWANY i oddaje `201` — dzięki temu każdy test może sprawdzić
 * nie tylko wynik, ale i to, czy żądanie w ogóle wyszło.
 *
 * Udany zapis kończy się `throw redirect(...)`, więc sukces przychodzi tu jako
 * rzucony `Response`, a nie jako wartość zwrócona. Rozróżnienie jest w `rodzaj`.
 */
async function wykonaj(fd: FormData): Promise<Wynik> {
  const zapisy: Zapis[] = [];
  const context = new RouterContextProvider();
  context.set(apiContext, {
    api: createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "A1",
      fetch: (async (req: Request) => {
        if (req.method !== "POST") return json(200, SESJA);
        zapisy.push({
          sciezka: new URL(req.url).pathname,
          cialo: (await req.json()) as Record<string, unknown>,
        });
        return json(201, UTWORZONY);
      }) as unknown as typeof fetch,
    }),
    user: PODOPIECZNA,
  });

  const args = {
    request: new Request("https://fe.test/podopieczny/loguj/s-1", { method: "POST", body: fd }),
    params: { sessionId: "s-1" },
    context,
  } as never;

  const { action } = await import("./loguj.$sessionId");
  try {
    const odpowiedz = await action(args);
    return { rodzaj: "blad", error: odpowiedz.error, zapisy };
  } catch (e) {
    if (e instanceof Response) {
      return { rodzaj: "zapis", location: e.headers.get("location"), zapisy };
    }
    throw e;
  }
}

/** Ciało wysłane do BE — z czytelną porażką, gdy zapis w ogóle nie wyszedł. */
function cialoZapisu(wynik: Wynik): Record<string, unknown> {
  const pierwszy = wynik.zapisy[0];
  if (!pierwszy) {
    throw new Error(
      `Zapis nie doszedł do backendu. Wynik akcji: ${
        wynik.rodzaj === "blad" ? wynik.error : "przekierowanie bez żądania"
      }`,
    );
  }
  expect(pierwszy.sciezka).toBe("/v1/workout-logs");
  return pierwszy.cialo;
}

function cwiczeniaZapisu(wynik: Wynik): Array<Record<string, unknown>> {
  return cialoZapisu(wynik).exercises as Array<Record<string, unknown>>;
}

/** Komunikat odmowy — z czytelną porażką, gdy akcja jednak zapisała trening. */
function bladAkcji(wynik: Wynik): string {
  if (wynik.rodzaj !== "blad") {
    throw new Error("Akcja ZAPISAŁA trening zamiast odmówić.");
  }
  return wynik.error;
}

/** Adres przekierowania po udanym zapisie. */
function przekierowanie(wynik: Wynik): string {
  if (wynik.rodzaj !== "zapis") {
    throw new Error(`Akcja odmówiła zamiast zapisać: ${wynik.error}`);
  }
  return wynik.location ?? "";
}

describe("loguj/:sessionId — akcja liczy `allDone`", () => {
  it("`allDone` fałszywe, gdy planowana seria została pusta", async () => {
    // Pusty wiersz PLANOWANY znaczy „serii nie zrobiłem". Sesja z niezrobioną
    // serią nie jest sesją wykonaną — i to jest jedyny przypadek, w którym flaga
    // ma spaść. Trzy przypadki niżej pilnują, żeby nie spadała z innych powodów.
    const wynik = await wykonaj(
      formularz([deskryptor({ plannedSets: 3, setCount: 3 })], {
        e_0_s_0_reps: "8",
        e_0_s_1_reps: "7",
      }),
    );

    expect(cialoZapisu(wynik).allDone).toBe(false);
  });

  it("`allDone` prawdziwe, gdy WYMIENIONY wpis ma wypełnione wszystkie planowane serie", async () => {
    // Nagroda za wymianę W MIEJSCU: wpis zamieniony JEST wpisem, więc liczy się
    // normalnie i nie ma czego wyłączać z rachunku. Gdyby zamiana dokładała się
    // obok zamiast podmieniać, ćwiczenie z planu zostałoby tu puste i flaga by
    // spadła — a podopieczny zrobił przecież całą sesję, tylko innym ćwiczeniem.
    const wynik = await wykonaj(
      formularz(
        [
          deskryptor({
            exerciseId: "z",
            exerciseName: "Australian pull-up",
            origin: "substitute",
            substitutedExerciseId: "e-1",
            plannedSets: 2,
            setCount: 2,
          }),
        ],
        { e_0_s_0_reps: "12", e_0_s_1_reps: "10" },
      ),
    );

    expect(cialoZapisu(wynik).allDone).toBe(true);
    // Przy okazji ścieżka sukcesu w całości: udany zapis kończy się
    // przekierowaniem na szczegół z sygnałem `saved`, po którym tamta strona
    // czyści szkic tej sesji z `sessionStorage`. Bez `pr`, bo rekordów nie było.
    expect(przekierowanie(wynik)).toBe("/podopieczny/historia/l-1?saved=s-1");
  });

  it("`allDone` fałszywe, gdy WYMIENIONY wpis ma pustą planowaną serię", async () => {
    // Druga połowa poprzedniego przypadku i dopiero razem z nią jest on bramką.
    // Sam „zamiennik wypełniony → prawda" przeszedłby na zielono także wtedy,
    // gdyby wpisy `substitute` w ogóle WYPADAŁY z rachunku — bo wypadnięty wpis
    // też niczego nie psuje. Dopiero pusta seria pokazuje różnicę: wpis
    // zamieniony JEST wpisem, więc jego niezrobiona seria ma zdjąć flagę tak
    // samo, jak zdjęłaby ją seria ćwiczenia z planu.
    const wynik = await wykonaj(
      formularz(
        [
          deskryptor({
            exerciseId: "z",
            exerciseName: "Australian pull-up",
            origin: "substitute",
            substitutedExerciseId: "e-1",
            plannedSets: 2,
            setCount: 2,
          }),
        ],
        { e_0_s_0_reps: "12" },
      ),
    );

    expect(cialoZapisu(wynik).allDone).toBe(false);
  });

  it("`allDone` prawdziwe mimo PUSTEGO ćwiczenia spoza planu", async () => {
    // Ćwiczenie dorzucone przez podopiecznego nie może sprawić, że plan wygląda
    // na niewykonany: dołożyć może wyłącznie wykonanie ponad plan. Przy okazji
    // druga reguła — wpis bez ani jednej wypełnionej serii wypada z ładunku
    // CAŁKOWICIE, więc do BE jedzie jedno ćwiczenie, nie dwa z pustymi seriami.
    const wynik = await wykonaj(
      formularz(
        [
          deskryptor({ plannedSets: 1, setCount: 1 }),
          deskryptor({
            exerciseId: "x",
            exerciseName: "Rower",
            origin: "extra",
            plannedSets: null,
            setCount: 1,
          }),
        ],
        { e_0_s_0_reps: "8" },
      ),
    );

    expect(cialoZapisu(wynik).allDone).toBe(true);
    expect(cwiczeniaZapisu(wynik)).toHaveLength(1);
  });

  it("`allDone` prawdziwe mimo pustej serii DOŁOŻONEJ ponad plan", async () => {
    // Podopieczny dołożył czwarty wiersz i go nie wypełnił. Plan prosił o dwie
    // serie i dwie są zrobione — wiersz ponad plan nie ma prawa tego odwrócić,
    // bo inaczej dołożenie wiersza karałoby za samo dołożenie.
    const wynik = await wykonaj(
      formularz([deskryptor({ plannedSets: 2, setCount: 3 })], {
        e_0_s_0_reps: "8",
        e_0_s_1_reps: "7",
      }),
    );

    expect(cialoZapisu(wynik).allDone).toBe(true);
  });
});

describe("loguj/:sessionId — akcja pilnuje kształtu ładunku", () => {
  it("konflikt „zamiast i oraz” wraca komunikatem Z NAZWĄ i nie dochodzi do backendu", async () => {
    // Plan wolno ułożyć tak, że to samo ćwiczenie stoi w dwóch blokach. Wymiana
    // jednego wystąpienia przy zalogowanym drugim to `SUBSTITUTED_EXERCISE_ALSO_
    // LOGGED` (N14) — a komunikat backendu ćwiczenia NIE NAZYWA (identyfikator
    // siedzi w `details`, których formularz nie pokazuje). Podopieczny dostawał
    // zdanie bez nazwy przy dwóch kartach o tej samej nazwie i nie miał jak
    // zapisać sesji. NAZWA jest więc całą treścią tej poprawki i dlatego stoi
    // w asercji; sama obecność jakiegokolwiek błędu niczego by tu nie dowiodła.
    const wynik = await wykonaj(
      formularz(
        [
          deskryptor({ exerciseName: "Podciąganie", plannedSets: 1, setCount: 1 }),
          deskryptor({
            exerciseId: "z",
            exerciseName: "Australian pull-up",
            origin: "substitute",
            substitutedExerciseId: "e-1",
            plannedSets: 1,
            setCount: 1,
          }),
        ],
        { e_0_s_0_reps: "5", e_1_s_0_reps: "12" },
      ),
    );

    expect(bladAkcji(wynik)).toContain("Podciąganie");
    expect(bladAkcji(wynik)).toContain("cofnij wymianę");
    // Odmowa ma paść PRZED wysyłką — inaczej cała poprawka sprowadza się do
    // ładniejszego opisu tego samego `409`, który i tak przyjdzie z BE.
    expect(wynik.zapisy).toHaveLength(0);
  });

  it("`origin` i wskaźnik zamiany dojeżdżają z akcji do WYSŁANEGO ciała", async () => {
    // Druga bramka tego samego szwu, tym razem od strony trasy: `workouts.test.ts`
    // dowodzi, że `saveWorkoutLog` przepisuje te pola do JSON-a, ale nic nie
    // dowodziło, że akcja w ogóle je tam wkłada. Deskryptor jest jedynym
    // źródłem `origin` po tej stronie — zgubienie go w akcji dałoby log,
    // w którym zamiennik udaje ćwiczenie z planu, i BE przyjąłby to bez słowa.
    const wynik = await wykonaj(
      formularz(
        [
          deskryptor({
            exerciseId: "z",
            exerciseName: "Australian pull-up",
            origin: "substitute",
            substitutedExerciseId: "e-1",
            plannedSets: 1,
            setCount: 1,
          }),
        ],
        { e_0_s_0_reps: "12" },
      ),
    );

    expect(cwiczeniaZapisu(wynik)[0]).toMatchObject({
      exerciseId: "z",
      origin: "substitute",
      substitutedExerciseId: "e-1",
    });
  });

  it("kolejność ćwiczeń w ciele idzie ZA deskryptorami, nie za planem", async () => {
    // Kolejność wpisów JEST kolejnością wykonania, a backend nie ma na nią
    // osobnego pola: agregat nadaje `ordinal` z INDEKSU tablicy `exercises`,
    // a oba szczegóły logu oddają wpisy `order by ordinal`. Przestawienie kart
    // (`moveEntry`) zmienia więc wyłącznie kolejność deskryptorów — i albo
    // dojedzie tędy do ciała, albo zniknie BEZ ŚLADU: zapis powiedzie się tak
    // samo, tylko log skłamie o przebiegu treningu.
    const wynik = await wykonaj(
      formularz(
        [
          deskryptor({ exerciseId: "e-2", exerciseName: "Dip", plannedSets: 1, setCount: 1 }),
          deskryptor({ plannedSets: 1, setCount: 1 }),
        ],
        { e_0_s_0_reps: "10", e_1_s_0_reps: "8" },
      ),
    );

    expect(cwiczeniaZapisu(wynik).map((c) => c.exerciseId)).toEqual(["e-2", "e-1"]);
  });

  it("ukryte pole, które nie jest JSON-em, odrzuca zapis zamiast go przepuścić", async () => {
    // Ukryte pole jest wejściem NIEZAUFANYM tak samo jak ciało żądania. Bez tego
    // sprawdzenia śmieć w `entries` dawałby po prostu zero wpisów, czyli zapis
    // „pustego" treningu albo cichy `409` z BE — zamiast zdania, po którym widać,
    // co zrobić.
    const wynik = await wykonaj(formularz("{to nie jest JSON"));

    expect(bladAkcji(wynik)).toContain("Odśwież stronę");
    expect(wynik.zapisy).toHaveLength(0);
  });

  it("deskryptor o niepoprawnym kształcie odrzuca zapis", async () => {
    // JSON poprawny, kształt nie: `setCount` jako łańcuch i nieznane `origin`.
    // Zod ma to odciąć PRZED pętlą pól — inaczej `setCount: "3"` dałoby pętlę
    // bez ani jednego obiegu (`0 < "3"` jest prawdą, ale `sIdx < "3"` też, więc
    // zachowanie zależałoby od koercji), a nieznane `origin` poleciałoby do BE.
    const zlyTyp = await wykonaj(
      formularz([{ ...deskryptor(), setCount: "3" }], { e_0_s_0_reps: "8" }),
    );
    const zleOrigin = await wykonaj(
      formularz([{ ...deskryptor(), origin: "wymyslone" }], { e_0_s_0_reps: "8" }),
    );

    expect(bladAkcji(zlyTyp)).toContain("Odśwież stronę");
    expect(zlyTyp.zapisy).toHaveLength(0);
    expect(bladAkcji(zleOrigin)).toContain("Odśwież stronę");
    expect(zleOrigin.zapisy).toHaveLength(0);
  });
});
