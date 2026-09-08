import { describe, expect, it } from "vitest";

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

describe("biblioteka-cwiczen — trasa zasobowa wybieraka", () => {
  it("oddaje czynne ćwiczenia trenera podopiecznej", async () => {
    const { loader } = await import("./biblioteka-cwiczen");
    const wynik = await loader(kontekstPodopiecznej());
    expect(wynik.exercises.map((e) => e.name)).toEqual(["Deska", "Podciąganie"]);
  });

  it("odmawia trenerowi", async () => {
    const { loader } = await import("./biblioteka-cwiczen");
    await expect(loader(kontekstTrenera())).rejects.toThrow();
  });
});
