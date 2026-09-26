import { describe, expect, it } from "vitest";
import { createApiClient } from "./api/client";
import { ApiError } from "./api/errors";
import {
  SkillError,
  addPrerequisite,
  addVariation,
  archiveSkill,
  createSkill,
  getSkillWithVariations,
  listSkillsForTrainer,
  removePrerequisite,
  removeVariation,
  reorderVariations,
  updateSkill,
} from "./skills";

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

const GRUPY = [
  {
    tier: "basic" as const,
    skills: [{ id: "s-1", name: "Pull-up", description: "", variationCount: 3 }],
  },
  {
    tier: "advanced" as const,
    skills: [
      { id: "s-2", name: "Front Lever", description: "Dźwignia przodem", variationCount: 5 },
    ],
  },
];

describe("listSkillsForTrainer — lista umiejętności na kontrakcie", () => {
  it("pyta `GET /v1/skills` bez parametrów i oddaje grupy po stopniu nietknięte", async () => {
    // Kontrakt nie ma sortowania ani filtra stopnia — obie kontrolki zostają
    // w trasie, a test pilnuje, żeby nikt nie dopisał tu słownika „dla symetrii".
    let sciezka = "";
    let zapytanie = "";
    let metoda = "";
    const api = klient((req) => {
      const url = new URL(req.url);
      sciezka = url.pathname;
      zapytanie = url.search;
      metoda = req.method;
      return json(200, GRUPY);
    });

    const wynik = await listSkillsForTrainer(api);

    expect(metoda).toBe("GET");
    expect(sciezka).toBe("/v1/skills");
    expect(zapytanie).toBe("");
    expect(wynik).toEqual(GRUPY);
  });
});

const SZCZEGOL = {
  id: "s-2",
  name: "Front Lever",
  description: "Dźwignia przodem",
  tier: "advanced" as const,
  variations: [
    { id: "v-1", exerciseId: "e-1", exerciseName: "Tuck FL", unit: "SEC" as const, ordinal: 1 },
  ],
  prerequisites: [{ id: "s-1", name: "Pull-up", tier: "basic" as const }],
  assignablePrerequisites: [{ id: "s-3", name: "Dip", tier: "basic" as const }],
  tierConflicts: [
    { requiresSkillId: "s-9", requiresSkillName: "Planche", requiresTier: "expert" as const },
  ],
  assignableExercises: [{ id: "e-7", name: "Adv Tuck FL", unit: "SEC" as const }],
};

describe("getSkillWithVariations — szczegół z listami edytora", () => {
  it("jedno `GET /v1/skills/{id}` niesie warianty, prerekwizyty, kandydatów, konflikty i wolne ćwiczenia", async () => {
    // Do integracji edytor składał to z pięciu zapytań (`listAssignableExercises`,
    // `listPrerequisitesForSkill`, `listAssignablePrerequisites`,
    // `listConflictingPrerequisites` + szczegół). Teraz to pola jednej odpowiedzi.
    let sciezka = "";
    const api = klient((req) => {
      sciezka = new URL(req.url).pathname;
      return json(200, SZCZEGOL);
    });

    const wynik = await getSkillWithVariations(api, "s-2");

    expect(sciezka).toBe("/v1/skills/s-2");
    expect(wynik?.variations[0]?.exerciseName).toBe("Tuck FL");
    expect(wynik?.prerequisites.map((p) => p.id)).toEqual(["s-1"]);
    expect(wynik?.assignablePrerequisites.map((p) => p.id)).toEqual(["s-3"]);
    expect(wynik?.tierConflicts[0]?.requiresSkillName).toBe("Planche");
    expect(wynik?.assignableExercises.map((e) => e.id)).toEqual(["e-7"]);
  });

  it("`404` daje `null` — cudza umiejętność jest nieodróżnialna od nieistniejącej", async () => {
    const api = klient(() => odmowa(404, "SKILL_NOT_FOUND", "Nie znaleziono umiejętności."));

    expect(await getSkillWithVariations(api, "s-x")).toBeNull();
  });
});

describe("createSkill / updateSkill / archiveSkill — zapisy nagłówka", () => {
  it("tworzenie wysyła wyłącznie `name`, `description`, `tier` i oddaje identyfikator", async () => {
    // `trainerId` w ciele byłoby polem spoza DTO, czyli `400` (forbidNonWhitelisted).
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return json(201, { id: "s-9" });
    });

    const wynik = await createSkill(api, "Planche", "", "expert");

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/skills");
    expect(cialo).toEqual({ name: "Planche", description: "", tier: "expert" });
    expect(wynik).toEqual({ id: "s-9" });
  });

  it("`409` (nazwa zajęta) idzie do formularza jako SkillError z komunikatem BE", async () => {
    // Dawniej zdanie składał FE po nazwie indeksu Postgresa; teraz należy do koperty.
    const api = klient(() =>
      odmowa(409, "SKILL_NAME_TAKEN", "Umiejętność o tej nazwie już istnieje."),
    );

    const blad = await createSkill(api, "Planche", "", "expert").catch((e) => e);

    expect(blad).toBeInstanceOf(SkillError);
    expect((blad as SkillError).userMessage).toBe("Umiejętność o tej nazwie już istnieje.");
  });

  it("`500` przechodzi jako ApiError — awaria BE ma zostać awarią", async () => {
    const api = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    const blad = await createSkill(api, "Planche", "", "expert").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(SkillError);
  });

  it("aktualizacja to `PATCH /v1/skills/{id}` ze WSZYSTKIMI trzema polami, a konflikty stopni wracają w odpowiedzi", async () => {
    // Kontrakt: pełne zastąpienie, pominięte pole daje `400` — inaczej niż
    // w ćwiczeniach. Zmiana stopnia nie jest blokowana; konflikty wracają.
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return json(200, {
        id: "s-2",
        tierConflicts: [
          { requiresSkillId: "s-9", requiresSkillName: "Planche", requiresTier: "expert" },
        ],
      });
    });

    const wynik = await updateSkill(api, "s-2", "Front Lever", "Dźwignia przodem", "basic");

    expect(metoda).toBe("PATCH");
    expect(sciezka).toBe("/v1/skills/s-2");
    expect(cialo).toEqual({ name: "Front Lever", description: "Dźwignia przodem", tier: "basic" });
    expect(wynik.tierConflicts).toHaveLength(1);
  });

  it("archiwizacja to `POST /v1/skills/{id}/archive`, a `404` zamienia na SkillError do formularza", async () => {
    let sciezka = "";
    let metoda = "";
    const ok = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return pusto(204);
    });
    const cudza = klient(() => odmowa(404, "SKILL_NOT_FOUND", "Nie znaleziono umiejętności."));

    await archiveSkill(ok, "s-2");
    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/skills/s-2/archive");

    const blad = await archiveSkill(cudza, "s-x").catch((e) => e);

    expect(blad).toBeInstanceOf(SkillError);
    expect((blad as SkillError).userMessage).toBe("Nie znaleziono umiejętności.");
  });
});

describe("addVariation / removeVariation / reorderVariations — drabina wariantów", () => {
  it("dodanie wariantu to `POST …/variations` z samym `exerciseId`", async () => {
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return json(201, { id: "v-9" });
    });

    await addVariation(api, "s-2", "e-7");

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/skills/s-2/variations");
    expect(cialo).toEqual({ exerciseId: "e-7" });
  });

  it("`409` (ćwiczenie już wariantem albo zarchiwizowane) to SkillError z komunikatem BE", async () => {
    // Obie bramki — unikat `exercise_id` i stan ćwiczenia — są teraz po stronie BE;
    // picker pokazuje tylko wolne, ale POST wprost trafia na te same sprawdzenia.
    const api = klient(() =>
      odmowa(
        409,
        "EXERCISE_ALREADY_VARIATION",
        "To ćwiczenie jest już wariantem innej umiejętności.",
      ),
    );

    const blad = await addVariation(api, "s-2", "e-1").catch((e) => e);

    expect(blad).toBeInstanceOf(SkillError);
    expect((blad as SkillError).userMessage).toBe(
      "To ćwiczenie jest już wariantem innej umiejętności.",
    );
  });

  it("usunięcie to `DELETE …/variations/{variationId}`; `409` przy historii awansów to SkillError", async () => {
    let sciezka = "";
    let metoda = "";
    const ok = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return pusto(204);
    });
    const uzyty = klient(() =>
      odmowa(409, "VARIATION_IN_USE", "Wariant jest użyty w historii awansów."),
    );

    await removeVariation(ok, "s-2", "v-1");
    expect(metoda).toBe("DELETE");
    expect(sciezka).toBe("/v1/skills/s-2/variations/v-1");

    const blad = await removeVariation(uzyty, "s-2", "v-1").catch((e) => e);

    expect(blad).toBeInstanceOf(SkillError);
    expect((blad as SkillError).userMessage).toBe("Wariant jest użyty w historii awansów.");
  });

  it("kolejność to `PUT …/variations/order` z ciałem `{ order }`, a `400` idzie do formularza", async () => {
    // Porównanie „lista = dokładnie bieżące warianty" robi BE; FE nie ma już
    // dwufazowej zmiany ordinali ani własnego sprawdzenia zbiorów.
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const ok = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return pusto(204);
    });
    const niezgodna = klient(() =>
      odmowa(400, "VARIATION_ORDER_MISMATCH", "Lista wariantów nie zgadza się z umiejętnością."),
    );

    await reorderVariations(ok, "s-2", ["v-2", "v-1"]);
    expect(metoda).toBe("PUT");
    expect(sciezka).toBe("/v1/skills/s-2/variations/order");
    expect(cialo).toEqual({ order: ["v-2", "v-1"] });

    const blad = await reorderVariations(niezgodna, "s-2", ["v-2"]).catch((e) => e);

    expect(blad).toBeInstanceOf(SkillError);
    expect((blad as SkillError).userMessage).toBe(
      "Lista wariantów nie zgadza się z umiejętnością.",
    );
  });
});

describe("addPrerequisite / removePrerequisite — krawędzie prerekwizytów", () => {
  it("dodanie krawędzi to `POST …/prerequisites` z samym `requiresSkillId` — bez pre-checków w FE", async () => {
    // Samopętla, cykl i stopień prereka to reguły BE (docblok: „409 przy cyklu
    // oraz przy prerekwizycie o wyższym stopniu"). Test wysyła samopętlę, żeby
    // pilnować, że moduł NIE odrzuca jej sam — dwie kopie reguły rozjechałyby się.
    let sciezka = "";
    let metoda = "";
    let cialo: unknown;
    const api = klient(async (req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      cialo = await req.json();
      return pusto(204);
    });

    await addPrerequisite(api, "s-2", "s-2");

    expect(metoda).toBe("POST");
    expect(sciezka).toBe("/v1/skills/s-2/prerequisites");
    expect(cialo).toEqual({ requiresSkillId: "s-2" });
  });

  it("`409` (cykl, wyższy stopień, duplikat) to SkillError z komunikatem BE", async () => {
    const api = klient(() =>
      odmowa(409, "SKILL_PREREQUISITE_CYCLE", "To połączenie utworzyłoby cykl w drzewie."),
    );

    const blad = await addPrerequisite(api, "s-2", "s-1").catch((e) => e);

    expect(blad).toBeInstanceOf(SkillError);
    expect((blad as SkillError).userMessage).toBe("To połączenie utworzyłoby cykl w drzewie.");
  });

  it("usunięcie krawędzi to `DELETE …/prerequisites/{requiresSkillId}`; `500` przelatuje jako ApiError", async () => {
    let sciezka = "";
    let metoda = "";
    const ok = klient((req) => {
      sciezka = new URL(req.url).pathname;
      metoda = req.method;
      return pusto(204);
    });
    const awaria = klient(() => odmowa(500, "INTERNAL", "Coś poszło nie tak."));

    await removePrerequisite(ok, "s-2", "s-1");
    expect(metoda).toBe("DELETE");
    expect(sciezka).toBe("/v1/skills/s-2/prerequisites/s-1");

    const blad = await removePrerequisite(awaria, "s-2", "s-1").catch((e) => e);

    expect(blad).toBeInstanceOf(ApiError);
    expect(blad).not.toBeInstanceOf(SkillError);
  });
});
