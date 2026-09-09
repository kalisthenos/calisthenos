/**
 * Szkic logu treningu przechowywany w `sessionStorage`. Chroni wpisane serie
 * przed utratą, gdy wysyłka formularza zerwie się na poziomie sieci (np.
 * `TypeError: Failed to fetch` przy uploadzie wideo) — wtedy React Router
 * renderuje ErrorBoundary i odmontowuje komponent, kasując stan Reacta.
 *
 * Trzymamy dane tekstowe serii (powtórzenia / trudność / pominięcie) ORAZ
 * identyfikator wgranego nagrania. Samych bajtów wideo nadal nie da się sensownie
 * trzymać w storage, ale po rozdzieleniu uploadu od zapisu sesji plik leci na serwer
 * od razu po wybraniu, a w formularzu zostaje tylko `fileId` — zwykły string, który
 * przeżywa ubicie karty.
 *
 * Od wersji 4 szkic wozi WPISY (`DraftEntry[]`), nie samą macierz serii — lista
 * ćwiczeń formularza przestała być odbiciem planu (wymiana ćwiczenia W MIEJSCU,
 * dodatek spoza planu) i stała się stanem, więc szkic musi to umieć odwzorować:
 * `origin` per wpis i własna, zmienna liczba serii zamiast stałej wziętej z planu.
 *
 * Od wersji 5 wozi też KLUCZ wpisu — bo od chwili, gdy ćwiczenia da się
 * PRZESTAWIĆ (`moveEntry`), pozycja w tablicy przestała mówić, do której pozycji
 * planu wpis należy.
 */

// MUSI zostać `import type`, i to nie jest preferencja stylu. `workouts.ts`
// woła klienta kontraktu, a ten plik jedzie do przeglądarki — import WARTOŚCI
// stąd wciągnąłby serwer do bundla klienta. `tsc` milczy na to, wywala się
// dopiero `npm run build`. W drugą stronę zależność już istnieje (`workouts.ts`
// bierze stąd `DraftEntry`/`SetDraft`), też wyłącznie typem, więc cykl znika
// przy kompilacji i żaden bundler go nie widzi.
import type { LogEntry } from "./workouts";

export type SetDraft = {
  reps: string;
  difficulty: string;
  skipped: boolean;
  /** Identyfikator nagrania wgranego przez `/upload/wideo`; `null` = brak. */
  videoFileId: string | null;
};

export type DraftEntry = {
  /**
   * Klucz wpisu formularza: dla wpisu z planu — identyfikator POZYCJI planu
   * (`plan_items.id`, patrz `toLogEntries`); dla dodatku spoza planu — klucz
   * nadany przy dołożeniu. Wozimy go od v5 i jest to jedyny powód tej wersji.
   *
   * Bez niego przywracanie parowało szkic z planem po POZYCJI w tablicy, co było
   * prawdą dokładnie tak długo, jak długo wpisy planu stały w kolejności planu.
   * Po przestawieniu ćwiczeń dawałoby to każdemu wpisowi cel, notatkę i nazwę
   * zastąpionego ćwiczenia od CUDZEJ pozycji planu — po cichu.
   */
  key: string;
  exerciseId: string;
  /** Etykieta, nie klucz — do backendu jedzie wyłącznie `exerciseId`. */
  exerciseName: string;
  unit: "REPS" | "SEC";
  tracksRpe: boolean;
  origin: "planned" | "substitute" | "extra";
  substitutedExerciseId: string | null;
  sets: SetDraft[];
};

/**
 * Wersja 4: wpisy (`DraftEntry[]`) zamiast macierzy serii — niosą pochodzenie
 * (`origin`) i własną liczbę serii, bo lista ćwiczeń przestała być odbiciem
 * planu i stała się stanem (wymiana ćwiczenia W MIEJSCU, dodatek spoza planu).
 *
 * Szkice v3 (i starsze) są ODRZUCANE, nie migrowane — ta sama decyzja co przy
 * odrzuceniu v2: szkic żyje tylko przez sesję przeglądarki, więc migracja nie
 * jest warta kodu. **Konsekwencja, którą łatwo przeoczyć:** ktoś, kto w chwili
 * wdrożenia tej zmiany ma w przeglądarce niezapisany szkic v3 (bo właśnie w tej
 * chwili ćwiczy), zostanie odrzucony CICHO — `parseDraft` odda `null`, formularz
 * wstanie pusty, bez komunikatu i bez śladu w logach. To jest zamierzone:
 * wstawienie danych o kształcie sprzed „origin + zmienna liczba serii" byłoby
 * gorsze niż start od zera — szkic v3 nie ma jak powiedzieć, który wpis jest
 * zamianą ani ile serii ma dodatek spoza planu, bo v3 tych pojęć nie znało.
 * Ten komentarz jest jedynym miejscem, w którym ta wiedza ma szansę przetrwać.
 *
 * `planExerciseIds` (od v2, wtedy `exerciseIds`) zostaje kryterium zgodności,
 * ale znaczy teraz ćwiczenia PLANU, nie ćwiczenia szkicu: te drugie mogą się od
 * planu różnić i o to w tej zmianie chodzi. Liczba serii przestaje być
 * kryterium — była nim dopóty, dopóki pochodziła z planu.
 */
type DraftShape = { v: 5; planExerciseIds: string[]; entries: DraftEntry[] };

/** Klucz storage per sesja planu — różne sesje mają niezależne szkice. */
export function draftKey(sessionId: string): string {
  return `kalisthenos:log-draft:${sessionId}`;
}

export function serializeDraft(planExerciseIds: string[], entries: DraftEntry[]): string {
  return JSON.stringify({ v: 5, planExerciseIds, entries } satisfies DraftShape);
}

/**
 * Parsuje szkic, ale zwraca go tylko gdy pasuje do bieżącego PLANU: te same
 * ćwiczenia planu w tej samej kolejności (`planExerciseIds`). Liczba serii
 * i pochodzenie (`origin`) każdego wpisu jadą w samym szkicu i NIE są już
 * kryterium zgodności — to one są treścią tej zmiany (wymiana, dodatek spoza
 * planu). Jakikolwiek rozjazd `planExerciseIds` oznacza, że trener zmienił
 * plan — wtedy `null`, żeby nie wstawiać danych do niepasującego formularza.
 *
 * **Szkic v4 jest MIGROWANY, nie odrzucany — i jest to odstępstwo od decyzji
 * podjętej przy v2 i v3.** Tamte odrzucono, bo migracja była NIEMOŻLIWA: v3 nie
 * miało jak powiedzieć, który wpis jest zamianą ani ile serii ma dodatek, bo
 * tych pojęć nie znało. Tu brakuje wyłącznie `key`, a w v4 wpisy z planu stały
 * z definicji w kolejności planu (parował je kursor) — klucz odtwarza się więc
 * dokładnie, bez zgadywania. Cena odrzucenia byłaby przy tym najwyższa z całej
 * serii: wdrożenie w trakcie czyjegoś treningu kasowałoby wypełniony formularz
 * bez słowa, bo trasa po nieudanym parsowaniu USUWA szkic ze storage.
 *
 * `planKeys` to klucze pozycji planu w kolejności planu. Służą dwóm rzeczom:
 * odtworzeniu kluczy w szkicu v4 oraz sprawdzeniu, że klucze szkicu v5 to
 * DOKŁADNIE klucze pozycji tego planu — bez powtórzeń i bez obcych. Bez tego
 * drugiego sprawdzenia trener, który skasował i dodał z powrotem tę samą pozycję
 * planu (te same `planExerciseIds`, nowe `plan_items.id`), zostawiłby szkic,
 * który `rehydrateEntries` degraduje wpis po wpisie do „spoza planu" — cicho,
 * z utratą celu, notatki i wskaźnika zamiany. Rozjazd kluczy to ten sam fakt co
 * rozjazd `planExerciseIds` — trener zmienił plan — więc i ta sama odpowiedź.
 */
export function parseDraft(
  raw: string | null,
  expected: { planExerciseIds: string[]; planKeys: readonly string[] },
): DraftEntry[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const d = parsed as { v?: unknown; planExerciseIds?: unknown; entries?: unknown };
  const wersja = d.v;
  if (wersja !== 5 && wersja !== 4) return null;
  if (!Array.isArray(d.planExerciseIds) || !Array.isArray(d.entries)) return null;

  // Plan: ta sama liczba i te same identyfikatory w tej samej kolejności.
  if (d.planExerciseIds.length !== expected.planExerciseIds.length) return null;
  for (let i = 0; i < expected.planExerciseIds.length; i++) {
    if (d.planExerciseIds[i] !== expected.planExerciseIds[i]) return null;
  }

  // Wpisy: typ każdego pola, w tym każdej serii — sessionStorage jest danymi
  // niezaufanymi tak samo jak ciało żądania.
  for (const e of d.entries) {
    if (!e || typeof e !== "object") return null;
    const entry = e as {
      key?: unknown;
      exerciseId?: unknown;
      exerciseName?: unknown;
      unit?: unknown;
      tracksRpe?: unknown;
      origin?: unknown;
      substitutedExerciseId?: unknown;
      sets?: unknown;
    };
    // Klucza wymaga wyłącznie v5 — w v4 go nie było i to on jest całą różnicą
    // między wersjami; migracja niżej nadaje go z kolejności planu.
    if (wersja === 5 && typeof entry.key !== "string") return null;
    if (
      typeof entry.exerciseId !== "string" ||
      typeof entry.exerciseName !== "string" ||
      (entry.unit !== "REPS" && entry.unit !== "SEC") ||
      typeof entry.tracksRpe !== "boolean" ||
      (entry.origin !== "planned" && entry.origin !== "substitute" && entry.origin !== "extra") ||
      !(typeof entry.substitutedExerciseId === "string" || entry.substitutedExerciseId === null) ||
      !Array.isArray(entry.sets)
    ) {
      return null;
    }
    for (const s of entry.sets) {
      if (!s || typeof s !== "object") return null;
      const set = s as {
        reps?: unknown;
        difficulty?: unknown;
        skipped?: unknown;
        videoFileId?: unknown;
      };
      if (
        typeof set.reps !== "string" ||
        typeof set.difficulty !== "string" ||
        typeof set.skipped !== "boolean" ||
        !(typeof set.videoFileId === "string" || set.videoFileId === null)
      ) {
        return null;
      }
    }
  }
  return wersja === 4
    ? odtworzKluczeV4(d.entries as Omit<DraftEntry, "key">[], expected.planKeys)
    : sprawdzKluczeV5(d.entries as DraftEntry[], expected.planKeys);
}

/**
 * Szkic v4 → v5. W v4 wpisy z planu stały w kolejności planu, bo przywracanie
 * parowało je KURSOREM — ten sam kursor odtwarza więc klucze bez zgadywania.
 *
 * Wpisy spoza planu dostają klucz zastępczy: `rehydrateEntries` i tak nada im
 * własny, a bez niego nie dałoby się zbudować `DraftEntry`. Rozjazd liczby
 * wpisów z planu wobec liczby pozycji znaczy szkic uszkodzony albo podrobiony —
 * wtedy `null`, jak przy każdym innym rozjeździe z planem.
 */
function odtworzKluczeV4(
  entries: Omit<DraftEntry, "key">[],
  planKeys: readonly string[],
): DraftEntry[] | null {
  let cursor = 0;
  const wynik: DraftEntry[] = [];
  for (const [i, entry] of entries.entries()) {
    if (entry.origin === "extra") {
      wynik.push({ ...entry, key: `extra:v4-${i}` });
      continue;
    }
    const key = planKeys[cursor++];
    if (key === undefined) return null;
    wynik.push({ ...entry, key });
  }
  return cursor === planKeys.length ? wynik : null;
}

/**
 * Klucze wpisów z planu muszą być DOKŁADNIE kluczami pozycji tego planu: tyle
 * samo, żadnego obcego, żadnego dwa razy. Kolejność jest wolna — to ona jest
 * treścią przestawienia.
 *
 * `rehydrateEntries` broni się przed tym samym drugi raz (klucz nieznany albo
 * powtórzony degraduje wpis do „spoza planu") i **te dwie bariery są nadmiarowe
 * świadomie**: ta zamyka drogę ze `sessionStorage`, tamta obowiązuje każdego
 * wołającego, także przyszłego, który nie przyjdzie przez `parseDraft`.
 */
function sprawdzKluczeV5(entries: DraftEntry[], planKeys: readonly string[]): DraftEntry[] | null {
  const zPlanu = entries.filter((entry) => entry.origin !== "extra");
  if (zPlanu.length !== planKeys.length) return null;

  const dozwolone = new Set(planKeys);
  const widziane = new Set<string>();
  for (const entry of zPlanu) {
    if (!dozwolone.has(entry.key) || widziane.has(entry.key)) return null;
    widziane.add(entry.key);
  }
  return entries;
}

/**
 * Czy szkic niesie cokolwiek wartego przywrócenia. Prawda w trzech przypadkach,
 * a wszystkie trzy są tą samą regułą: **decyzja podopiecznego jest treścią sama
 * w sobie**, choćby nie wpisał jeszcze ani jednej liczby, bo nie chcemy mu kazać
 * podejmować jej drugi raz.
 *
 * 1. którykolwiek wpis ma pochodzenie inne niż `"planned"` — wymiana albo dodatek;
 * 2. wpisy z planu NIE stoją w kolejności planu — przestawienie (`moveEntry`);
 * 3. którakolwiek seria niesie coś wpisanego (warunek najstarszy, bez zmian).
 *
 * `planKeys` to klucze pozycji planu W KOLEJNOŚCI PLANU (`toLogEntries`), czyli
 * dokładnie to, wobec czego mierzy się punkt 2. Argument jest WYMAGANY, choć dwa
 * pozostałe punkty go nie potrzebują: wartość domyślna wyłączałaby sprawdzenie
 * kolejności u wołającego, który o nim nie wie, a objawem byłby szkic skasowany
 * zamiast zapisanego — czyli nic.
 */
export function draftHasContent(entries: DraftEntry[], planKeys: readonly string[]): boolean {
  if (kolejnoscInnaNizPlan(entries, planKeys)) return true;
  return entries.some(
    (entry) =>
      entry.origin !== "planned" ||
      entry.sets.some(
        (s) => s.skipped || s.reps.trim() !== "" || s.difficulty !== "" || s.videoFileId !== null,
      ),
  );
}

/**
 * Wpis w postaci, która wystarcza do ZBUDOWANIA ŁADUNKU — czyli `DraftEntry`
 * bez klucza (`buildLogPayload`, `lib/workouts`).
 *
 * Klucz jest tożsamością wpisu W FORMULARZU: po nim wraca szkic, po nim React
 * trzyma stan karty i po nim przestawia się kolejność. Do backendu nie jedzie
 * i nie ma tam czego znaczyć. AKCJA trasy składa wpisy z deskryptorów ukrytego
 * pola, które klucza nie niosą — i słusznie, bo niczego nie parują. Ten typ
 * pozwala jej zostać uczciwą zamiast wymyślać klucz, który nic nie znaczy.
 */
export type PayloadEntry = Omit<DraftEntry, "key">;

// ============================================================
// Druga granica tego samego wpisu: ukryte pole formularza
// ============================================================

/**
 * Wpis w postaci, w jakiej jedzie z formularza do AKCJI trasy (ukryte pole
 * `entries`) — KSZTAŁT, nie treść. Serii tu nie ma: ich wartości lecą zwykłymi
 * polami (`e_{i}_s_{j}_*`), a `setCount` mówi wyłącznie, ile ich odczytać.
 *
 * Mieszka w tym pliku, nie w trasie, bo jest dopełnieniem `serializeDraft`:
 * ta sama wiedza o tym, co z wpisu trzeba przenieść przez granicę, i ten sam
 * rodzaj wejścia po drugiej stronie — niezaufany. W trasie ta para nie miałaby
 * jak dostać testu (`@testing-library/react` nie jest zależnością tego drzewa),
 * a to dokładnie ten szew, który raz już pękł po cichu.
 *
 * **Czego deskryptor NIE rozstrzyga:** przynależności ćwiczenia do sesji (N5′),
 * reguł oceny trudności (N2 — po faktach z BIBLIOTEKI, nie stąd), poprawności
 * wskaźnika zamiany (N13, N14) ani sufitów rozmiaru (N15). To wszystko
 * egzekwuje backend na własnych faktach.
 */
export type EntryDescriptor = {
  exerciseId: string;
  exerciseName: string;
  unit: "REPS" | "SEC";
  tracksRpe: boolean;
  origin: DraftEntry["origin"];
  substitutedExerciseId: string | null;
  /**
   * Cel z planu; `null` dla wpisu spoza planu. Bez tego pola akcja nie odróżnia
   * wiersza planowanego od dołożonego, więc reguła „wiersze ponad plan nie mogą
   * zepsuć `allDone`" jest po tamtej stronie niewyrażalna.
   */
  plannedSets: number | null;
  /** Ile wierszy serii formularz naprawdę wyrenderował. */
  setCount: number;
};

/** Wpis formularza → kształt dla akcji. */
export function descriptorOf(entry: LogEntry): EntryDescriptor {
  return {
    exerciseId: entry.exerciseId,
    exerciseName: entry.exerciseName,
    unit: entry.unit,
    tracksRpe: entry.tracksRpe,
    origin: entry.origin,
    substitutedExerciseId: entry.substitutedExerciseId,
    plannedSets: entry.plannedSets,
    setCount: entry.sets.length,
  };
}

/**
 * Szkic → wpisy formularza. Szkic wozi `DraftEntry`, czyli wszystko, co trzeba
 * ZAPISAĆ, ale nie wozi pól służących wyłącznie do NARYSOWANIA karty
 * (`plannedSets`, `expectedReps`, `note`, `isDropsetItem`, nazwa zastąpionego).
 * Te wracają z planu.
 *
 * Dopasowanie idzie po KLUCZU wpisu, nie po jego pozycji — ani w tablicy szkicu,
 * ani w tablicy planu. Do v4 szło kursorem po pozycjach planu i było poprawne
 * dokładnie tak długo, jak długo wpisy planu stały w kolejności planu: dodatki
 * doklejały się na końcu, a wymiana podmieniała W MIEJSCU. `moveEntry` znosi to
 * założenie — po przestawieniu ćwiczeń kursor dałby drugiemu wpisowi cel, notatkę
 * i nazwę zastąpionego ćwiczenia od PIERWSZEJ pozycji planu, bez komunikatu
 * i z liczbami na tyle prawdopodobnymi, że nikt nie musi tego zauważyć.
 *
 * Kolejność w szkicu jest więc od v5 ODTWARZANA, nie prostowana — bo jest treścią,
 * a nie przypadkiem.
 *
 * Wpis, którego klucza nie ma w planie ALBO którego klucz już się w tym szkicu
 * pojawił, degraduje się do `extra` bez wskaźnika zamiany — czyli do czegoś, czego
 * backend na pewno nie odrzuci jako źle postawionej zamiany. Pierwszy przypadek to
 * szkic z planu, który trener przebudował; drugi jest ceną parowania po kluczu
 * i domyka się razem z nim: `sessionStorage` to dane niezaufane, a dwie karty
 * o tym samym `key` to dla Reacta nie ostrzeżenie, tylko przepisanie stanu jednej
 * karty na drugą — z wpisanymi seriami i trwającą wysyłką nagrania włącznie.
 * Klucz dodatku ze szkicu jest z tego samego powodu nadawany na nowo z pozycji
 * w tablicy: tak nie ma jak zderzyć się z kluczem pozycji planu.
 *
 * **Zamiennik NIE dziedziczy `expectedReps` ani `note` po ćwiczeniu, które
 * zastąpił** — i to nie jest kosmetyka. Cel „× 8" pod planem „Podciąganie 3×8"
 * jest wpisywany do pola powtórzeń, gdy podopieczny kliknie trudność; przy
 * zamienniku „Plank" (jednostka SEC) dałoby to plank na osiem sekund, którego
 * nikt nie musi zauważyć. `plannedSets` ZOSTAJE: liczba serii jest celem planu
 * niezależnie od tego, czym się je wykona.
 */
export function rehydrateEntries(planEntries: LogEntry[], draft: DraftEntry[]): LogEntry[] {
  const planByKey = new Map(planEntries.map((p) => [p.key, p]));
  const zajeteKlucze = new Set<string>();
  return draft.map((d, i) => {
    const base = d.origin === "extra" ? undefined : planByKey.get(d.key);
    if (base == null || zajeteKlucze.has(d.key)) {
      return {
        key: `extra:r${i}`,
        exerciseId: d.exerciseId,
        exerciseName: d.exerciseName,
        unit: d.unit,
        tracksRpe: d.tracksRpe,
        origin: "extra" as const,
        substitutedExerciseId: null,
        substitutedExerciseName: null,
        plannedSets: null,
        expectedReps: null,
        note: null,
        isDropsetItem: false,
        sets: d.sets,
      };
    }
    zajeteKlucze.add(d.key);
    const zamieniony = d.origin === "substitute";
    return {
      key: base.key,
      exerciseId: d.exerciseId,
      exerciseName: d.exerciseName,
      unit: d.unit,
      tracksRpe: d.tracksRpe,
      origin: d.origin,
      substitutedExerciseId: d.substitutedExerciseId,
      substitutedExerciseName: zamieniony ? base.exerciseName : null,
      plannedSets: base.plannedSets,
      expectedReps: zamieniony ? null : base.expectedReps,
      note: zamieniony ? null : base.note,
      isDropsetItem: base.isDropsetItem,
      sets: d.sets,
    };
  });
}

// ============================================================
// Kolejność wpisów — stan formularza, nie odbicie planu
// ============================================================

/**
 * Czy wpisy Z PLANU stoją inaczej, niż stoją w planie.
 *
 * Dodatki są pomijane, bo pozycji planu nie mają. Filtr niczego przez to nie
 * przesądza — dodatek i tak jest treścią, punktem 1 `draftHasContent` — ale
 * trzyma to porównanie przy jego znaczeniu: mierzy KOLEJNOŚĆ, nie skład.
 *
 * Inna DŁUGOŚĆ też znaczy „inaczej", i to jest wybór w stronę bezpieczną: szkic,
 * w którym wpisów z planu jest mniej albo więcej niż pozycji, jest podrobiony
 * albo pochodzi z planu przebudowanego przez trenera. Lepiej go zachować
 * i pozwolić `rehydrateEntries` zdegradować, co trzeba, niż skasować bez śladu.
 */
function kolejnoscInnaNizPlan(entries: DraftEntry[], planKeys: readonly string[]): boolean {
  const zPlanu = entries.filter((entry) => entry.origin !== "extra");
  if (zPlanu.length !== planKeys.length) return true;
  return zPlanu.some((entry, i) => entry.key !== planKeys[i]);
}

/**
 * Przestawia wpis z pozycji `from` na `to`. Jedyne miejsce, w którym ekran
 * logowania zmienia KOLEJNOŚĆ ćwiczeń — „dziś zacząłem od rowerka, podciąganie
 * poszło na koniec".
 *
 * **Backend nie potrzebuje na to ani jednej zmiany** i to nie jest przeoczenie:
 * `LogWorkoutExerciseDto` nie ma pola na kolejność, bo niesie ją POZYCJA
 * w tablicy `exercises` ładunku. Agregat zapisuje ją jako `ordinal` wpisu,
 * a szczegół logu oddaje `order by ordinal` — po obu stronach, podopiecznemu
 * i trenerowi. Kolejność zaplanowana (`plan_items.ordinal`) i kolejność
 * wykonana (`workout_exercise_logs.ordinal`) były od początku dwiema
 * niezależnymi kolumnami; pokrywały się wyłącznie dlatego, że ten formularz
 * wysyłał wpisy w kolejności planu.
 *
 * **Mieszka w tym pliku, nie w `workouts.ts`** — mimo że to tamten moduł jest
 * właścicielem `LogEntry`. Wołającym jest KOMPONENT, na kliknięcie, a
 * `workouts.ts` woła klienta kontraktu: import WARTOŚCI stamtąd wciągnąłby
 * serwer do bundla przeglądarki, a `tsc` milczałby na to (dokładnie ten sam
 * powód, dla którego `LogEntry` przychodzi tu jako `import type`).
 *
 * Poza zakresem oddaje TĘ SAMĄ tablicę, nie kopię: „wyżej" z pierwszego wiersza
 * i „niżej" z ostatniego są w tym ekranie zwykłym kliknięciem w wyszarzony
 * przycisk, a nowa tablica kazałaby Reactowi przerysować wszystkie karty za nic.
 *
 * Żadna kolejność nie jest zabroniona — dodatek spoza planu wolno wciągnąć nad
 * ćwiczenia planowane, zamiennik zostaje tam, dokąd go przesunięto. Ograniczenia
 * po stronie backendu (N5′, N13–N16) mówią o PRZYNALEŻNOŚCI wpisu, nigdy o jego
 * miejscu w liście.
 */
export function moveEntry(entries: LogEntry[], from: number, to: number): LogEntry[] {
  const przenoszony = entries[from];
  // Jedno sprawdzenie zamiast trzech: indeks ujemny (`findIndex` oddaje -1, gdy
  // wpisu już nie ma), za końcem tablicy i ułamkowy dają `undefined` tak samo.
  if (przenoszony === undefined) return entries;
  if (!Number.isInteger(to) || to < 0 || to >= entries.length || to === from) return entries;

  const next = entries.filter((_, i) => i !== from);
  next.splice(to, 0, przenoszony);
  return next;
}
