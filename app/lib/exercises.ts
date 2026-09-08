import {
  exercisesControllerArchive,
  exercisesControllerCreate,
  exercisesControllerGet,
  exercisesControllerList,
  exercisesControllerRestore,
  exercisesControllerUpdate,
  myExercisesControllerList,
} from "@kalisthenos/api-client";
import type { ExerciseDetail, ExercisePage, UpdateExerciseDto } from "@kalisthenos/api-client";
import { orNull, publicFileUrl } from "~/lib/api/client";
import type { Api } from "~/lib/api/client";
import { ApiError } from "~/lib/api/errors";
import { UploadError, uploadExerciseDemo } from "~/lib/file-uploads";

/**
 * Aktywne ćwiczenia trenera do pickerów (edytor planu, formularz startowy).
 * Celowo BEZ filtra wariantów umiejętności — to robi `listAssignableExercises`
 * w `skills.ts` i jest to inna lista.
 *
 * Kontrakt stronicuje po 24 i nie ma parametru „wszystko", więc moduł skleja
 * strony sam, sekwencyjnie (`totalPages` z pierwszej odpowiedzi jest granicą,
 * więc pętla nie może się rozbiec). Wstawienie ćwiczenia MIĘDZY żądaniami może
 * przesunąć jedną pozycję — picker jest listą doradczą, a jedyną alternatywą
 * byłby dodatek do kontraktu.
 */
export async function listActiveExercisesForTrainer(
  api: Api,
): Promise<Array<{ id: string; name: string; unit: "REPS" | "SEC" }>> {
  const first = await activeExercisePage(api, 1);
  const items = [...first.items];
  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await activeExercisePage(api, page);
    items.push(...next.items);
  }
  return items.map((e) => ({ id: e.id, name: e.name, unit: e.unit }));
}

async function activeExercisePage(api: Api, page: number): Promise<ExercisePage> {
  const { data } = await exercisesControllerList({
    client: api,
    query: { page, sort: "name", status: "active" },
    throwOnError: true,
  });
  return data;
}

export interface PickableExercise {
  id: string;
  name: string;
  unit: "REPS" | "SEC";
  tracksRpe: boolean;
}

/**
 * Czynne ćwiczenia trenera, do którego podopieczny jest przypięty
 * (`GET /v1/me/exercises`, ADR-0038). Zakres najemcy niesie token — ten moduł
 * NIE ma i nie może mieć argumentu `trainerId`.
 *
 * Wszystkie strony naraz, jak u trenera: wybierak filtruje po stronie klienta,
 * bo tak robi `OnboardingPicker` i druga konwencja na to samo zadanie kosztuje
 * więcej, niż daje. Biblioteka ma rozmiar biblioteki jednego trenera, nie
 * katalogu — ta sama granica, którą przyjął i zapisał w docblocku
 * `listActiveExercisesForTrainer`.
 *
 * Bliźniak wariantu trenera, z jedną różnicą: wozi `tracksRpe`. Wybierak
 * trenera go nie potrzebował (ćwiczenie idzie DO PLANU, gdzie flaga nie wpływa
 * na formularz); podopieczny wybiera ćwiczenie DO ZALOGOWANIA, a od tej flagi
 * zależy, czy wiersz serii pokaże pole oceny trudności.
 *
 * **Pętla stron jest CELOWO powielona z `activeExercisePage`, nie wydzielona
 * do wspólnego helpera.** Wydzielenie zmieniłoby też wariant trenera, który
 * karmi edytor planu i formularz startowy — a bezpieczne potwierdzenie takiej
 * zmiany (zielone testy przed i po refaktorze) wymaga przebiegu testów poza
 * zakresem tego zadania. Sześć wierszy duplikatu jest tańsze niż niezamierzona
 * zmiana w dwóch działających ekranach.
 *
 * **`status` NIE wchodzi do zapytania** — `/v1/me/exercises` nie zna tego
 * parametru (wymusza `active` po swojej stronie); backend stoi na
 * whitelist + forbidNonWhitelisted, więc dopisanie `status` jak u trenera
 * wróciłoby jako `400`, nie jako ciche pominięcie.
 */
export async function listActiveExercisesForTrainee(api: Api): Promise<PickableExercise[]> {
  const first = await myExercisePage(api, 1);
  const items = [...first.items];
  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await myExercisePage(api, page);
    items.push(...next.items);
  }
  return items.map((e) => ({ id: e.id, name: e.name, unit: e.unit, tracksRpe: e.tracksRpe }));
}

async function myExercisePage(api: Api, page: number): Promise<ExercisePage> {
  const { data } = await myExercisesControllerList({
    client: api,
    query: { page, sort: "name" },
    throwOnError: true,
  });
  return data;
}

/**
 * Kontrakt oddaje `demoUrl` PODPISANY (ADR-0023), ale jako **ścieżkę** —
 * `/v1/files/…`, bez origin. Trafia stamtąd prosto do `src` w `<video>`, więc
 * origin musi ktoś dołożyć; robi to moduł, nie trasa, bo trasa nie ma wiedzieć,
 * skąd biorą się dane (ten sam szew, przez który cały dostęp idzie przez
 * `app/lib`). Ta sama obróbka czeka `videoUrl` w dzienniku i `photoUrl`
 * w sylwetce — te obszary idą kolejnymi krokami.
 */
function withPublicDemoUrl<T extends { demoUrl: string | null }>(view: T): T {
  return view.demoUrl == null ? view : { ...view, demoUrl: publicFileUrl(view.demoUrl) };
}

/**
 * Szczegół ćwiczenia do widoku edycji.
 *
 * `| null` w sygnaturze jest tym, co włącza mapowanie `404` (`orNull`): cudze
 * ćwiczenie jest po tamtej stronie nieodróżnialne od nieistniejącego i oba mają
 * dać ten sam ekran co dziś.
 */
export async function getExerciseDetail(
  api: Api,
  exerciseId: string,
): Promise<ExerciseDetail | null> {
  const detail = await orNull(
    exercisesControllerGet({ client: api, path: { id: exerciseId }, throwOnError: true }).then(
      (r) => r.data,
    ),
  );
  return detail == null ? null : withPublicDemoUrl(detail);
}

/**
 * Własny typ błędu obszaru — powstaje wyłącznie dla tych odmów, dla których
 * trasa ma komunikat w formularzu (precedens: `CategoryError`, `AuthError`).
 */
export class ExerciseError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}

/**
 * Archiwizacja / przywrócenie. Bramka „ćwiczenie jest wariantem aktywnej
 * umiejętności" przeszła do BE — z trasy znika `findSkillForExercise`, a razem
 * z nim ostatnia zależność tego obszaru od `skills.ts`.
 *
 * Komunikat bierzemy z kontraktu DOSŁOWNIE. Jest krótszy od dotychczasowego:
 * nie nazywa umiejętności, choć `details.skillName` przychodzi w odpowiedzi.
 * To świadoma strata — treść komunikatów należy teraz do BE (spec: „ustalenia
 * po stronie BE są nadrzędne"), a wzbogacenie zdania jest zmianą TAM, nie tutaj.
 */
export async function setExerciseArchived(
  api: Api,
  exerciseId: string,
  archived: boolean,
): Promise<void> {
  try {
    if (archived) {
      await exercisesControllerArchive({
        client: api,
        path: { id: exerciseId },
        throwOnError: true,
      });
    } else {
      await exercisesControllerRestore({
        client: api,
        path: { id: exerciseId },
        throwOnError: true,
      });
    }
  } catch (e) {
    if (e instanceof ApiError && e.code === "EXERCISE_IS_SKILL_VARIATION") {
      throw new ExerciseError("archiving an active skill variation", e.message);
    }
    throw e;
  }
}

/**
 * Tworzy ćwiczenie razem z opcjonalnym demo. Do integracji była to JEDNA
 * transakcja; teraz to sekwencja żądań, bo `CreateExerciseDto` nie przyjmuje
 * `demoFileId` — podpięcie jest osobnym `PATCH`-em.
 *
 * **Kolejność jest decyzją:** wysyłka idzie PIERWSZA, bo to krok najbardziej
 * podatny na odmowę (`413`), a jego porażka ma nie zostawić po sobie ćwiczenia —
 * tak jak dziś rollback. Cena nowego układu: gdy padnie `POST` albo `PATCH` PO
 * udanej wysyłce, plik zostaje niepodpięty (sprzątnie go `orphan-files-sweep`
 * w BE po 24 h), a ćwiczenie może istnieć bez demo.
 *
 * **Dlatego wynik nie jest `void`, a odmowa podpięcia nie jest wyjątkiem.**
 * Sekwencja ma dwie fazy o przeciwnych skutkach: przed `POST` porażka nie
 * zostawia niczego i wolno ponowić cały formularz, po `POST` ćwiczenie JUŻ
 * ISTNIEJE i ponowienie utworzyłoby drugie. Pierwsza faza leci wyjątkiem
 * (`UploadError`), druga wraca w `demoError` — trasa ma wtedy zaprowadzić
 * trenera do ćwiczenia, które powstało, zamiast oddawać mu wypełniony formularz.
 */
export interface CreatedExercise {
  id: string;
  /** Komunikat dla użytkownika, gdy ćwiczenie powstało, ale demo nie dało się podpiąć. */
  demoError: string | null;
}

export async function createExercise(
  api: Api,
  input: {
    name: string;
    unit: "REPS" | "SEC";
    /** Kolumna po tamtej stronie jest NOT NULL DEFAULT '' — brak opisu to pusty string. */
    description: string;
    tags: string[];
    tracksRpe: boolean;
    demo: File | null;
  },
): Promise<CreatedExercise> {
  const demoFileId = input.demo != null ? await uploadExerciseDemo(api, input.demo) : null;

  const { data: created } = await exercisesControllerCreate({
    client: api,
    body: {
      name: input.name,
      unit: input.unit,
      description: input.description,
      tags: input.tags,
      tracksRpe: input.tracksRpe,
    },
    throwOnError: true,
  });

  if (demoFileId != null) {
    try {
      await patchExercise(api, created.id, { demoFileId });
    } catch (e) {
      // Wyłącznie odmowa podpięcia — awaria BE ma dalej być awarią.
      if (e instanceof UploadError) return { id: created.id, demoError: e.userMessage };
      throw e;
    }
  }

  return { id: created.id, demoError: null };
}

/**
 * Jedyne miejsce, w którym `demoFileId` trafia do kontraktu — razem z jedynym
 * mapowaniem odmowy podpięcia. Odmowa jest dla użytkownika problemem z PLIKIEM,
 * a nie z ćwiczeniem, więc niesie ją `UploadError`: trasa ma dla niego miejsce
 * w formularzu, a `ApiError` poszedłby na granicę błędu, czyli na inny ekran.
 */
async function patchExercise(api: Api, exerciseId: string, body: UpdateExerciseDto): Promise<void> {
  try {
    await exercisesControllerUpdate({
      client: api,
      path: { id: exerciseId },
      body,
      throwOnError: true,
    });
  } catch (e) {
    if (e instanceof ApiError && e.code === "EXERCISE_DEMO_FILE_UNAVAILABLE") {
      throw new UploadError(`demo not attachable: ${body.demoFileId}`, e.message);
    }
    throw e;
  }
}

/**
 * Zapis edycji z opcjonalną PODMIANĄ demo — jednym `PATCH`-em, bo `UpdateExerciseDto`
 * przyjmuje `demoFileId` razem z polami.
 *
 * **`currentDemoFileId` znika z sygnatury.** Do integracji wywołujący podawał je
 * z wiersza wczytanego przy sprawdzeniu własności, a moduł kasował wiersz starego
 * pliku w transakcji i blob po commicie. Całą tę ostrożność — łącznie z kolejnością
 * „najpierw dane, potem zawartość" — trzyma teraz BE (`ExercisesService.update`
 * oddaje `staleStoragePath` i kasuje po zatwierdzeniu).
 *
 * **To samo okno osierocenia co w `createExercise`:** gdy wysyłka nowego demo
 * się powiedzie, a `PATCH` zawiedzie PO niej, plik zostaje niepodpięty i czeka
 * na `orphan-files-sweep` w BE (24 h) — ćwiczenie zostaje wtedy przy starym
 * demo, nie bez demo.
 *
 * **`demo === null` znaczy „zostaw dotychczasowe", nie „odepnij".** W kontrakcie
 * `demoFileId: null` ODPINA demo; „zostaw dotychczasowe" to brak tego klucza
 * w ciele w ogóle — typy tej różnicy nie pilnują, `demoFileId?: string | null`
 * przyjmuje pominięcie i `null` jednakowo chętnie. Rozłożenie warunkowe niżej
 * (`!= null`, nie `!== undefined`) razem z testem obok („brak nowego pliku NIE
 * odpina istniejącego demo") są tym, co tę różnicę faktycznie utrzymuje.
 */
export async function updateExercise(
  api: Api,
  input: {
    exerciseId: string;
    name: string;
    unit: "REPS" | "SEC";
    description: string;
    tags: string[];
    tracksRpe: boolean;
    /** `null` = zostaw dotychczasowe demo bez zmian. */
    demo: File | null;
  },
): Promise<void> {
  const demoFileId = input.demo != null ? await uploadExerciseDemo(api, input.demo) : undefined;

  await patchExercise(api, input.exerciseId, {
    name: input.name,
    unit: input.unit,
    description: input.description,
    tags: input.tags,
    tracksRpe: input.tracksRpe,
    ...(demoFileId != null ? { demoFileId } : {}),
  });
}

export type ExerciseSort = "name_asc" | "name_desc" | "newest" | "oldest";

export interface ExerciseFilter {
  q?: string;
  /** Nazwa kategorii. Nieznaną u tego trenera kontrakt ignoruje sam. */
  tag?: string;
  unit?: "REPS" | "SEC";
}

/**
 * Słownik FE→kontrakt. Wartości po lewej są w ZAKŁADKOWALNYCH adresach list
 * (`?sort=name_desc`), więc zostają; kontrakt nazywa to samo inaczej i to on
 * jest nadrzędny. Tłumaczy moduł — trasa nie zna nazw z kontraktu.
 */
const CONTRACT_SORT: Record<ExerciseSort, "name" | "-name" | "newest" | "oldest"> = {
  name_asc: "name",
  name_desc: "-name",
  newest: "newest",
  oldest: "oldest",
};

/**
 * Jedno żądanie: kontrakt oddaje `total` RAZEM z listą. Stronę spoza zakresu
 * przycina BE (`paginate`) — dokładnie tak, jak robiła to dawniej `safePage`
 * w trasie.
 *
 * `status: "active"` jest jawny: biblioteka pokazuje wyłącznie aktywne, a
 * zarchiwizowane są osiągalne wyłącznie adresem szczegółu (tam widnieją z odznaką).
 */
export async function listExercisesForTrainer(
  api: Api,
  opts: ExerciseFilter & { sort: ExerciseSort; page: number },
): Promise<ExercisePage> {
  const { data } = await exercisesControllerList({
    client: api,
    query: {
      page: opts.page,
      sort: CONTRACT_SORT[opts.sort],
      status: "active",
      // Rozłożone warunkowo, nie przez `q: opts.q`: klucz z wartością `undefined`
      // i BRAK klucza to dla serializatora zapytań dwie różne rzeczy, a puste
      // `q=` znaczy w kontrakcie „szukaj pustego łańcucha", nie „bez filtra".
      ...(opts.q != null && opts.q.length > 0 ? { q: opts.q } : {}),
      ...(opts.tag != null ? { tag: opts.tag } : {}),
      ...(opts.unit != null ? { unit: opts.unit } : {}),
    },
    throwOnError: true,
  });
  // Kafelki listy renderują `<video src={demoUrl}>` tak samo jak szczegół,
  // więc origin dokładamy i tu — inaczej biblioteka pokazuje same puste ramki.
  return { ...data, items: data.items.map(withPublicDemoUrl) };
}
