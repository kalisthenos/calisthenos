import { describe, expect, it, vi } from "vitest";

// Awaria biblioteki jest w tym pliku ścieżką TESTOWANĄ, nie usterką — bez tego
// mocka każdy przebieg drukowałby jej log na stderr i wyglądał na czerwony,
// choć jest zielony (wzorem `upload.wideo.test.ts`).
vi.mock("~/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorMeta: () => ({}),
}));

import { RouterContextProvider } from "react-router";
import { createApiClient } from "~/lib/api/client";
import { type AuthUser, apiContext } from "~/lib/api/context";

const PODOPIECZNA: AuthUser = {
  id: "u-1",
  email: "anna@example.pl",
  displayName: "Anna Kowalska",
  roles: ["trainee"],
  trainerId: "t-1",
  trainerName: "Trener",
};

const TRENER: AuthUser = {
  id: "u-2",
  email: "trener@example.pl",
  displayName: "Trener Testowy",
  roles: ["trainer"],
  trainerId: null,
  trainerName: null,
};

function json(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function strona(items: unknown[]) {
  return { items, page: 1, totalPages: 1, total: items.length };
}

function kontekst(user: AuthUser, reguly: (req: Request) => Response) {
  const context = new RouterContextProvider();
  context.set(apiContext, {
    api: createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "A1",
      fetch: (async (req: Request) => reguly(req)) as unknown as typeof fetch,
    }),
    user,
  });
  return {
    request: new Request("https://fe.test/biblioteka-cwiczen"),
    params: {},
    context,
  } as never;
}

function kontekstPodopiecznej() {
  // Jedna strona (`totalPages: 1`) — pętla stron w `listActiveExercisesForTrainee`
  // wykona dokładnie jedno żądanie do `GET /v1/me/exercises`.
  return kontekst(PODOPIECZNA, () =>
    json(
      200,
      strona([
        { id: "e-1", name: "Deska", unit: "REPS", tracksRpe: false },
        { id: "e-2", name: "Podciąganie", unit: "REPS", tracksRpe: true },
      ]),
    ),
  );
}

function kontekstTrenera() {
  // Odpowiedź jest CELOWO poprawna (200, jak u podopiecznej), nie odmową ani
  // wyjątkiem: gdyby `requireUser` przepuścił trenera, loader dostałby dane i
  // `rejects.toThrow()` niżej by nie zaszło. Odmowa musi więc wynikać wyłącznie
  // z roli — nie z tego, że BE akurat nie odpowiada.
  return kontekst(TRENER, () => json(200, strona([])));
}

function kontekstAwarii() {
  // `500`, nie `404`: `listActiveExercisesForTrainee` woła kontrakt z
  // `throwOnError`, więc awaria BE wychodzi z modułu jako `ApiError`.
  return kontekst(PODOPIECZNA, () => json(500, { error: { code: "INTERNAL", message: "boom" } }));
}

describe("biblioteka-cwiczen — trasa zasobowa wybieraka", () => {
  it("oddaje czynne ćwiczenia trenera podopiecznej", async () => {
    const { loader } = await import("./biblioteka-cwiczen");
    const wynik = await loader(kontekstPodopiecznej());
    expect(wynik.exercises.map((e) => e.name)).toEqual(["Deska", "Podciąganie"]);
    expect(wynik.error).toBeNull();
  });

  it("awaria biblioteki wraca DANYMI, nie wyjątkiem", async () => {
    // Ta asercja jest o czymś innym niż komunikat: `useFetcher` rejestruje się pod
    // trasą, która go RENDERUJE, więc rzucenie z tego loadera nie ląduje we własnym
    // miejscu — ląduje w `ErrorBoundary` trasy logowania treningu. Podopieczny
    // z wypełnionymi trzema ćwiczeniami, któremu mrugnął zasięg, kliknąłby
    // „Wymień" i zobaczył, jak cały formularz znika pod zdaniem „Nie udało się
    // zapisać treningu" — o zapisie, którego nie było. `rejects.toThrow()` na
    // tym teście byłoby więc zieloną bramką pod utratą treningu.
    const { loader } = await import("./biblioteka-cwiczen");
    const wynik = await loader(kontekstAwarii());
    expect(wynik.exercises).toEqual([]);
    expect(wynik.error).toContain("Nie udało się wczytać biblioteki");
  });

  it("odmawia trenerowi", async () => {
    const { loader } = await import("./biblioteka-cwiczen");
    await expect(loader(kontekstTrenera())).rejects.toThrow();
  });
});
