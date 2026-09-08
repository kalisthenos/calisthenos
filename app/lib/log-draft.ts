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
 */

export type SetDraft = {
  reps: string;
  difficulty: string;
  skipped: boolean;
  /** Identyfikator nagrania wgranego przez `/upload/wideo`; `null` = brak. */
  videoFileId: string | null;
};

export type DraftEntry = {
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
type DraftShape = { v: 4; planExerciseIds: string[]; entries: DraftEntry[] };

/** Klucz storage per sesja planu — różne sesje mają niezależne szkice. */
export function draftKey(sessionId: string): string {
  return `kalisthenos:log-draft:${sessionId}`;
}

export function serializeDraft(planExerciseIds: string[], entries: DraftEntry[]): string {
  return JSON.stringify({ v: 4, planExerciseIds, entries } satisfies DraftShape);
}

/**
 * Parsuje szkic, ale zwraca go tylko gdy pasuje do bieżącego PLANU: te same
 * ćwiczenia planu w tej samej kolejności (`planExerciseIds`). Liczba serii
 * i pochodzenie (`origin`) każdego wpisu jadą w samym szkicu i NIE są już
 * kryterium zgodności — to one są treścią tej zmiany (wymiana, dodatek spoza
 * planu). Jakikolwiek rozjazd `planExerciseIds` oznacza, że trener zmienił
 * plan — wtedy `null`, żeby nie wstawiać danych do niepasującego formularza.
 */
export function parseDraft(
  raw: string | null,
  expected: { planExerciseIds: string[] },
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
  if (d.v !== 4 || !Array.isArray(d.planExerciseIds) || !Array.isArray(d.entries)) return null;

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
      exerciseId?: unknown;
      exerciseName?: unknown;
      unit?: unknown;
      tracksRpe?: unknown;
      origin?: unknown;
      substitutedExerciseId?: unknown;
      sets?: unknown;
    };
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
  return d.entries as DraftEntry[];
}

/**
 * Czy szkic niesie cokolwiek wartego przywrócenia. Prawda, gdy KTÓRYKOLWIEK
 * wpis ma pochodzenie inne niż `"planned"` — wymiana i dodatek są treścią same
 * w sobie, nawet z samymi pustymi seriami, bo to decyzje podopiecznego, których
 * nie chcemy mu kazać podejmować drugi raz — albo gdy którakolwiek seria niesie
 * coś wartego zapisania (dotychczasowy warunek, bez zmian).
 */
export function draftHasContent(entries: DraftEntry[]): boolean {
  return entries.some(
    (entry) =>
      entry.origin !== "planned" ||
      entry.sets.some(
        (s) => s.skipped || s.reps.trim() !== "" || s.difficulty !== "" || s.videoFileId !== null,
      ),
  );
}
