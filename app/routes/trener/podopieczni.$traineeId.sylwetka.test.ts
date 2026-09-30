import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { createApiClient } from "~/lib/api/client";
import { apiContext } from "~/lib/api/context";
import { loader } from "./podopieczni.$traineeId.sylwetka";

/**
 * Loader galerii sylwetki u trenera — dwie własności, których nie pilnuje ani
 * test modułu (`body-photos.test.ts`), ani zawężanie typów w komponencie:
 *
 * - bez zgody na dane o zdrowiu (ADR-0047 BE) loader oddaje WYŁĄCZNIE
 *   `{ trainee, shared: false }`. Dopisane „dla wygody" `photos: []` przeszłoby
 *   przez typy, a pusta lista to dokładnie ten kształt, który ekran wziąłby
 *   za „jeszcze nie wgrał zdjęć";
 * - cudzy podopieczny kończy się `404` ZANIM trasa zapyta o galerię. Loader nie
 *   przepuszcza błędu galerii przez `toRouteResponse`, więc po zamianie kolejności
 *   cudzy dostawałby granicę błędu z `500`, nie `404`.
 *
 * Wzorzec: `integracje.notatki-ai.test.tsx` — `RouterContextProvider`,
 * `apiContext` i podstawiony `fetch`, bez przeglądarki i bez bazy.
 */

const TRENER = {
  id: "u-1",
  email: "t@example.pl",
  displayName: "Trener",
  roles: ["trainer"] as const,
  trainerId: null,
  trainerName: null,
};

const PODOPIECZNY = {
  id: "t-1",
  displayName: "Anna Kowalska",
  sessionCount: 12,
  lastSessionOn: "2026-09-20",
  hasActivePlan: true,
};

function json(status: number, cialo: unknown): Response {
  return new Response(JSON.stringify(cialo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Lista podopiecznych (`findTraineeRef`) zawsze zna wyłącznie `t-1`; galerię
 * odpowiada `galeria`. Każda ścieżka trafia do `sciezki` — drugi test pyta
 * o żądanie, którego NIE wysłano.
 */
function scenariusz(galeria: () => Response) {
  const sciezki: string[] = [];
  const context = new RouterContextProvider();
  context.set(apiContext, {
    api: createApiClient({
      baseUrl: "http://be.test",
      getToken: () => "T",
      fetch: (async (req: Request) => {
        const sciezka = new URL(req.url).pathname;
        sciezki.push(sciezka);
        if (sciezka === "/v1/trainees") {
          return json(200, { items: [PODOPIECZNY], page: 1, totalPages: 1, total: 1 });
        }
        return galeria();
      }) as unknown as typeof fetch,
    }),
    user: TRENER as never,
  });
  return { context, sciezki };
}

function wywolaj(context: RouterContextProvider, traineeId: string) {
  return loader({
    request: new Request(`https://fe.test/trener/podopieczni/${traineeId}/sylwetka`),
    params: { traineeId },
    context,
  } as never);
}

describe("loader galerii sylwetki u trenera", () => {
  it("bez zgody oddaje wyłącznie `{ trainee, shared: false }` — bez zdjęć i bez par", async () => {
    const { context } = scenariusz(() =>
      json(403, {
        error: {
          code: "BODY_PHOTOS_NOT_SHARED",
          message: "Podopieczny nie udostępnia zdjęć sylwetki.",
        },
      }),
    );

    const wynik = await wywolaj(context, "t-1");

    expect(wynik).toStrictEqual({
      trainee: { id: "t-1", displayName: "Anna Kowalska" },
      shared: false,
    });
  });

  it("cudzy podopieczny kończy się `404`, zanim trasa zapyta o galerię", async () => {
    // Galeria odpowiada `500`: gdyby jednak padło o nią pytanie, loader
    // odrzuciłby `ApiError`-em, a nie odpowiedzią `404` — i test to pokaże.
    const { context, sciezki } = scenariusz(() =>
      json(500, { error: { code: "INTERNAL", message: "Ups." } }),
    );

    const blad = await wywolaj(context, "t-obcy").catch((e) => e);

    expect(blad).toBeInstanceOf(Response);
    expect((blad as Response).status).toBe(404);
    expect(sciezki).toEqual(["/v1/trainees"]);
  });
});
