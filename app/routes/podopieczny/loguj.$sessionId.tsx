import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  isRouteErrorResponse,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { z } from "zod";
import { ExercisePicker } from "~/components/exercise-picker";
import { Icons } from "~/components/icons";
import { LogExerciseCard } from "~/components/log-exercise-card";
import type { VideoUploadState } from "~/components/video-upload-field";
import { requireUser } from "~/lib/api/auth";
import type { PickableExercise } from "~/lib/exercises";
import { maxUploadBytesFor } from "~/lib/file-uploads";
import { type PlForms, pluralizePl, todayISO } from "~/lib/format";
import {
  type EntryDescriptor,
  type PayloadEntry,
  type SetDraft,
  descriptorOf,
  draftHasContent,
  draftKey,
  moveEntry,
  parseDraft,
  rehydrateEntries,
  serializeDraft,
} from "~/lib/log-draft";
import {
  type LogEntry,
  WorkoutSaveError,
  buildLogPayload,
  loadSessionForLogging,
  saveWorkoutLog,
  toLogEntries,
} from "~/lib/workouts";

const PerformedOnSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data.");
const NoteSchema = z.string().max(2000).optional();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deskryptor wpisu — KSZTAŁT formularza przysłany przez klienta w ukrytym polu
 * `entries`, nie źródło prawdy o treningu.
 *
 * **Dlaczego z formularza, a nie wyprowadzone z planu w akcji:** od „sesji poza
 * planem" lista ćwiczeń formularza przestała być odbiciem sesji. Akcja nie ma
 * jak znać wpisu spoza planu — z definicji nie ma go w sesji — ani tego, ile
 * wierszy podopieczny dołożył ponad plan. Deskryptory mówią więc wyłącznie
 * dwie rzeczy: KTÓRE pola odczytać (`setCount`) i jak ułożyć komunikat po
 * polsku (`exerciseName`, `tracksRpe`).
 *
 * **Czego NIE rozstrzygają:** przynależności ćwiczenia do sesji (N5′), reguł
 * oceny trudności (N2, po `origin` z BIBLIOTEKI, nie z deskryptora), poprawności
 * wskaźnika zamiany (N13, N14) ani sufitów rozmiaru (N15). To wszystko
 * egzekwuje backend na własnych faktach. Najgorszy skutek podrobionego
 * deskryptora jest więc taki, że komunikat w formularzu będzie mniej trafny niż
 * `409`, który i tak przyjdzie.
 *
 * `plannedSets` jest w deskryptorze PONAD listę z planu wdrożenia, bo bez niego
 * akcja nie umie policzyć `allDone` zgodnie z regułą „wiersze ponad plan nie
 * mogą go zepsuć" — nie ma jak odróżnić wiersza planowanego od dołożonego.
 * `allDone` i tak jest flagą deklarowaną przez klienta (`LogWorkoutDto`), więc
 * podrobienie go nie otwiera niczego, czego nie dałoby się zrobić wprost.
 *
 * Adnotacja `z.ZodType<EntryDescriptor>` jest bramką, nie ozdobą: kształt jest
 * własnością `log-draft.ts` (razem z `descriptorOf`, które go produkuje), a tu
 * stoi już tylko jego WALIDACJA. Rozjazd między jednym a drugim czerwieni się
 * na `tsc`, zamiast objawić się polem, którego akcja nie odczyta.
 */
const DescriptorSchema: z.ZodType<EntryDescriptor> = z.object({
  exerciseId: z.string().min(1),
  exerciseName: z.string(),
  unit: z.enum(["REPS", "SEC"]),
  tracksRpe: z.boolean(),
  origin: z.enum(["planned", "substitute", "extra"]),
  substitutedExerciseId: z.string().min(1).nullable(),
  /** Cel z planu; `null` dla wpisu spoza planu. */
  plannedSets: z.number().int().min(0).max(1000).nullable(),
  /** Ile wierszy serii formularz naprawdę wyrenderował. */
  setCount: z.number().int().min(0).max(1000),
});

/**
 * Górne ograniczenia są tu wyłącznie po to, żeby podrobiony ładunek nie kazał
 * akcji przemielić miliona nieistniejących pól — NIE są odtworzeniem sufitów
 * domenowych (N15: 50 serii na ćwiczenie oraz 20 wpisów o pochodzeniu innym niż
 * `planned` — czyli zamienniki RAZEM z dodatkami, nie same dodatki). Te pilnuje
 * backend i wracają jako `400` z `details.limit`; celowo są niższe niż to, co
 * przepuszczamy tutaj, żeby nikt nie wziął tej liczby za regułę produktu.
 */
const DescriptorsSchema = z.array(DescriptorSchema).max(200);

export async function loader(args: LoaderFunctionArgs) {
  const { api, user } = requireUser(args.context, { role: "trainee" });
  const session = await loadSessionForLogging(api, args.params.sessionId ?? "");
  if (!session) throw new Response("not found", { status: 404 });

  return {
    user,
    session: { id: session.id, name: session.name },
    // Wpisy PLANU — punkt wyjścia stanu formularza i jedyne, do czego wraca
    // „Cofnij wymianę" i „Wyczyść szkic".
    entries: toLogEntries(session),
    // Klient egzekwuje ten sam limit co serwer PRZED wysłaniem — za duże nagranie
    // nie opuszcza urządzenia (unikamy zerwanego uploadu: timeout proxy / OOM).
    maxVideoBytes: maxUploadBytesFor("set_video"),
    // Klucz idempotencji zapisu (`docs/04` §6) — jeden na WYŚWIETLENIE formularza:
    // chroni drugie kliknięcie i ponowiony `fetch` tego samego renderu, bo BE oddaje
    // wtedy pierwotny log. NIE chroni ponowienia po przemontowaniu trasy (powrót po
    // `ErrorBoundary` ze szkicem z `sessionStorage`) — tam klucz jest już nowy.
    idempotencyKey: crypto.randomUUID(),
  };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });

  // Sesja jest tu nadal wczytywana, choć KSZTAŁTU formularza już z niej nie
  // wyprowadzamy: daje `404` przed zapisem (cudza albo nieistniejąca sesja
  // trafia do `ErrorBoundary`, nie w komunikat pod formularzem) i kanoniczne
  // `planSessionId`.
  const session = await loadSessionForLogging(api, args.params.sessionId ?? "");
  if (!session) throw new Response("not found", { status: 404 });

  const fd = await args.request.formData();
  const performedOnParse = PerformedOnSchema.safeParse(fd.get("performedOn"));
  if (!performedOnParse.success) {
    return { error: "Sprawdź pole daty." };
  }
  const noteParse = NoteSchema.safeParse(fd.get("note") ?? undefined);
  const note = (noteParse.success ? noteParse.data?.trim() : "") || null;

  // Dane niezaufane (ukryte pole): tylko kształt UUID idzie do nagłówka — śmieć
  // wywróciłby `Headers` (CR/LF) albo wrócił z BE jako `400` o kluczu.
  const idempotencyKeyRaw = fd.get("idempotencyKey");
  const idempotencyKey =
    typeof idempotencyKeyRaw === "string" && UUID_RE.test(idempotencyKeyRaw)
      ? idempotencyKeyRaw
      : undefined;

  // Deskryptory idą przez Zoda, nie przez samo `JSON.parse`: ukryte pole jest
  // tym samym rodzajem wejścia co ciało żądania (i co `sessionStorage`).
  const descriptorsRaw = fd.get("entries");
  const descriptorsParse = DescriptorsSchema.safeParse(
    safeJson(typeof descriptorsRaw === "string" ? descriptorsRaw : null),
  );
  if (!descriptorsParse.success) {
    return { error: "Nie udało się odczytać listy ćwiczeń. Odśwież stronę i spróbuj ponownie." };
  }
  const descriptors: EntryDescriptor[] = descriptorsParse.data;

  try {
    // `PayloadEntry`, nie `DraftEntry`: deskryptory ukrytego pola nie niosą klucza
    // wpisu, bo akcja niczego po nim nie paruje — kolejność bierze z tablicy,
    // a resztę z pól formularza.
    const logged: PayloadEntry[] = [];
    // Zaczyna od prawdy i psuje się na PIERWSZYM pustym wierszu planowanym.
    // Wiersze ponad plan i całe wpisy `extra` nie mają jak go zepsuć — mogą
    // wyłącznie dołożyć wykonanie ponad to, o co prosił plan.
    let allSetsFilled = true;

    for (const [eIdx, descriptor] of descriptors.entries()) {
      const countsTowardsPlan = descriptor.origin !== "extra" && descriptor.plannedSets != null;
      const plannedRows = countsTowardsPlan ? (descriptor.plannedSets ?? 0) : 0;
      const sets: SetDraft[] = [];

      for (let sIdx = 0; sIdx < descriptor.setCount; sIdx++) {
        const repsRaw = fd.get(`e_${eIdx}_s_${sIdx}_reps`);
        const diffRaw = fd.get(`e_${eIdx}_s_${sIdx}_diff`);
        // Po rozdzieleniu uploadu formularz niesie już tylko IDENTYFIKATOR nagrania —
        // plik poleciał wcześniej na `/upload/wideo`. Identyfikator pochodzi od
        // klienta, więc jego własność i dostępność sprawdza BE przy zapisie
        // (`409 SET_VIDEO_UNAVAILABLE`), nie ta akcja.
        const videoIdRaw = fd.get(`e_${eIdx}_s_${sIdx}_video_id`);
        const videoId = typeof videoIdRaw === "string" && videoIdRaw !== "" ? videoIdRaw : null;
        const hasReps = repsRaw != null && repsRaw !== "";
        const hasDiff = diffRaw != null && diffRaw !== "";
        const hasVideo = videoId != null;

        const tracksRpe = descriptor.tracksRpe;

        // Pusty wiersz: dla ćwiczeń z RPE „pusty” = brak reps/diff/wideo;
        // dla ćwiczeń bez RPE „pusty” = brak reps/wideo (trudności i tak nie ma).
        const isBlank = tracksRpe ? !hasReps && !hasDiff && !hasVideo : !hasReps && !hasVideo;
        if (isBlank) {
          if (sIdx < plannedRows) allSetsFilled = false;
          // Pusty wiersz JEDZIE do `buildLogPayload` i wypada tam z ładunku —
          // dzięki temu dziura w `ordinal` zostaje dziurą („seria pominięta"),
          // a nie przenumerowaniem serii następnych.
          sets.push({ reps: "", difficulty: "", skipped: false, videoFileId: null });
          continue;
        }

        // Wiersz częściowy: reps zawsze wymagane; trudność tylko gdy tracksRpe.
        if (!hasReps || (tracksRpe && !hasDiff)) {
          return {
            error: tracksRpe
              ? `Ćwiczenie ${descriptor.exerciseName}, seria #${sIdx + 1}: uzupełnij liczbę powtórzeń i trudność (1-10).`
              : `Ćwiczenie ${descriptor.exerciseName}, seria #${sIdx + 1}: uzupełnij liczbę powtórzeń.`,
          };
        }

        const reps = Number(repsRaw);
        if (!Number.isFinite(reps) || reps < 1 || reps > 1000) {
          return {
            error: `Ćwiczenie ${descriptor.exerciseName}, seria #${sIdx + 1}: liczba powtórzeń poza zakresem (1-1000).`,
          };
        }

        let difficulty = "";
        if (tracksRpe) {
          const parsed = Number(diffRaw);
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
            return {
              error: `Ćwiczenie ${descriptor.exerciseName}, seria #${sIdx + 1}: trudność musi być 1-10.`,
            };
          }
          difficulty = String(parsed);
        }

        sets.push({ reps: String(reps), difficulty, skipped: false, videoFileId: videoId });
      }

      // Wpis planowany przysłany z mniejszą liczbą wierszy, niż planował trener
      // (dziś niewyrażalne w UI — „–" nie tyka wierszy planu — ale deskryptory
      // są danymi od klienta): brakujące wiersze to serie niezrobione.
      if (descriptor.setCount < plannedRows) allSetsFilled = false;

      logged.push({
        exerciseId: descriptor.exerciseId,
        exerciseName: descriptor.exerciseName,
        unit: descriptor.unit,
        tracksRpe: descriptor.tracksRpe,
        origin: descriptor.origin,
        substitutedExerciseId: descriptor.substitutedExerciseId,
        sets,
      });
    }

    // Wpis bez ani jednej wypełnionej serii wypada z ładunku CAŁKOWICIE — także
    // zamiennik, którego podopieczny ostatecznie nie zrobił. Wtedy log nie niesie
    // ani zamiennika, ani wskaźnika na zastąpione, więc N14 nie ma o co zahaczyć.
    const exercisesPayload = buildLogPayload(logged);
    if (exercisesPayload.length === 0) {
      return { error: "Zapisz co najmniej jedną serię." };
    }

    // N14 sprawdzany TUTAJ, choć rozstrzyga go backend — i to nie jest
    // odtwarzanie cudzej reguły na zapas. Plan wolno ułożyć tak, że to samo
    // ćwiczenie stoi w dwóch blokach (`plan-tree.ts` nie ma reguły unikalności),
    // a wtedy wymiana JEDNEGO wystąpienia przy zalogowanym drugim daje odmowę,
    // której komunikat z BE **nie nazywa ćwiczenia** — identyfikator siedzi
    // w `details`, których formularz nie pokazuje. Podopieczny dostaje więc
    // zdanie bez nazwy przy dwóch kartach o tej samej nazwie i nie ma jak
    // zapisać sesji: klika ponownie i dostaje to samo. Tu zamieniamy odmowę
    // nie do naprawienia w zdanie mówiące, CO KLIKNĄĆ.
    //
    // Blokady w chwili WYMIANY świadomie nie ma: konflikt powstaje dopiero, gdy
    // drugie wystąpienie naprawdę dostanie serię, a zabieranie „Wymień" za
    // przewinę jeszcze niepopełnioną jest karą bez winy.
    const zalogowaneZPlanu = new Set(
      exercisesPayload.filter((e) => e.origin === "planned").map((e) => e.exerciseId),
    );
    const konflikt = exercisesPayload.find(
      (e) => e.substitutedExerciseId != null && zalogowaneZPlanu.has(e.substitutedExerciseId),
    );
    if (konflikt != null) {
      const nazwa = logged.find(
        (e) => e.origin === "planned" && e.exerciseId === konflikt.substitutedExerciseId,
      )?.exerciseName;
      return {
        error: `Ćwiczenie ${nazwa ?? "z planu"} wymieniłeś w jednym miejscu planu, a w innym je zalogowałeś — cofnij wymianę albo nie loguj drugiego wystąpienia.`,
      };
    }

    const saved = await saveWorkoutLog(
      api,
      {
        planSessionId: session.id,
        performedOn: performedOnParse.data,
        note,
        allDone: allSetsFilled,
        exercises: exercisesPayload,
      },
      { idempotencyKey },
    );

    // Pobite rekordy przychodzą w odpowiedzi `201` — identyfikatory ćwiczeń idą
    // w adresie, żeby strona szczegółu odpaliła toast. Sygnał `saved` każe jej
    // wyczyścić szkic tej sesji z sessionStorage.
    const params = new URLSearchParams();
    if (saved.personalRecords.length > 0) {
      params.set("pr", saved.personalRecords.map((p) => p.exerciseId).join(","));
    }
    params.set("saved", session.id);
    throw redirect(`/podopieczny/historia/${saved.id}?${params.toString()}`);
  } catch (e) {
    if (e instanceof Response) throw e; // redirect bubbles
    // Nieużyte nagrania sprząta zamiatacz sierot po stronie BE (24 h karencji).
    if (e instanceof WorkoutSaveError) return { error: e.userMessage };
    throw e;
  }
}

function safeJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type SetState = SetDraft;

const CWICZENIE: PlForms = { one: "ćwiczenie", few: "ćwiczenia", many: "ćwiczeń" };
const SERIA: PlForms = { one: "seria", few: "serie", many: "serii" };

const blankSet = (): SetState => ({
  reps: "",
  difficulty: "",
  skipped: false,
  videoFileId: null,
});

const blankSets = (count: number): SetState[] => Array.from({ length: count }, blankSet);

type PickerState = { mode: "swap"; key: string } | { mode: "extra" };

export default function LogForm() {
  const {
    user,
    session,
    entries: planEntries,
    maxVideoBytes,
    idempotencyKey,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  // `formMethod != null` zamiast `state !== "idle"`: łapie wyłącznie wysyłkę
  // formularza (i przeżywa fazę `loading` po redircie, w której najłatwiej kliknąć
  // drugi raz), ale nie zwykłą nawigację — bez tego przycisk mrugałby
  // „Zapisywanie…” także po kliknięciu „Anuluj”.
  const isSubmitting = navigation.formMethod != null;

  // Lista WPISÓW, nie macierz serii: od „sesji poza planem" może urosnąć
  // (ćwiczenie spoza planu), a jej element może zostać podmieniony (wymiana
  // W MIEJSCU). Wysyłkę nadal niosą atrybuty `name` pól — my sterujemy ich
  // wartościami, a kształt listy jedzie osobno w ukrytym polu `entries`.
  //
  // reps startuje puste (cel widać w placeholderze); wybór trudności dopełnia
  // reps celem. Nietknięty wiersz zostaje więc czystym „pominięciem", zamiast
  // kazać podopiecznemu kasować podstawione liczby.
  const [entries, setEntries] = useState<LogEntry[]>(planEntries);
  const [picker, setPicker] = useState<PickerState | null>(null);
  // Numeruje klucze Reacta wpisów spoza planu. Nie `exerciseId`: to samo
  // ćwiczenie wolno dołożyć raz, ale klucz musi przeżyć jego usunięcie
  // i ponowne dodanie bez kolizji z instancją, która właśnie odchodzi.
  const extraSeq = useRef(0);

  const planExerciseIds = useMemo(() => planEntries.map((e) => e.exerciseId), [planEntries]);
  // Klucze pozycji planu W KOLEJNOŚCI PLANU — po nich `draftHasContent` poznaje,
  // że podopieczny przestawił ćwiczenia, a nie tylko jeszcze nic nie wpisał.
  const planKeys = useMemo(() => planEntries.map((e) => e.key), [planEntries]);

  // Które pola aktualnie wysyłają nagranie — zapis jest zablokowany, dopóki cokolwiek
  // leci, żeby trening nie zapisał się bez wideo, na które podopieczny właśnie czeka.
  // Klucz idzie po `entry.key`, nie po indeksie: wpisy da się teraz usuwać, a klucz
  // po indeksie zostawiłby po usuniętym wpisie wieczne „trwa wysyłka".
  const [uploadingKeys, setUploadingKeys] = useState<Record<string, boolean>>({});
  // Liczone PER WPIS, nie tylko sumarycznie: karta musi wiedzieć, czy to ONA ma
  // wysyłkę w toku, bo tylko wtedy gasi „–" (docblock `LogExerciseCard`, punkt 3).
  // Iterowanie po bieżących wpisach i wierszach jest zarazem sprzątaniem — klucze
  // po wpisie usuniętym albo po wierszu zdjętym po prostu nie są liczone.
  const uploadingPerEntry = useMemo(() => {
    const licznik: Record<string, number> = {};
    for (const entry of entries) {
      let n = 0;
      for (let j = 0; j < entry.sets.length; j++) {
        if (uploadingKeys[`${entry.key}-${j}`]) n++;
      }
      licznik[entry.key] = n;
    }
    return licznik;
  }, [entries, uploadingKeys]);
  const uploadingCount = useMemo(
    () => Object.values(uploadingPerEntry).reduce((suma, n) => suma + n, 0),
    [uploadingPerEntry],
  );

  const [restoredDraft, setRestoredDraft] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  // Liczniki przemontowań kart. `VideoUploadField` trzyma stan wysyłki u siebie
  // i czyta `initialFileId` tylko raz, więc każde ZEWNĘTRZNE nadpisanie serii
  // musi go przemontować. Pola tekstowe są kontrolowane przez `entries`, więc
  // remount niczego nie gubi — ale remount PRZERYWA trwającą wysyłkę, i to po
  // cichu: `abort()` idzie ścieżką `ABORTED`, która celowo milczy, bo zakłada,
  // że anulował użytkownik.
  //
  // Dlatego liczniki są DWA. Per wpis — dla „–" i „Wymień", czyli przycisków,
  // których cały sens polega na klikaniu W TRAKCIE treningu: zdjęcie wiersza
  // w ćwiczeniu 4 nie ma prawa zabić nagrania lecącego w ćwiczeniu 1. Globalny —
  // wyłącznie dla szkicu (przywrócenie, wyczyszczenie), bo tam nadpisujemy
  // WSZYSTKIE wpisy naraz, a dzieje się to przy montowaniu albo na wyraźne
  // żądanie, nie w tle wysyłki.
  const [videoFieldsEpoch, setVideoFieldsEpoch] = useState(0);
  const [entryVideoEpochs, setEntryVideoEpochs] = useState<Record<string, number>>({});
  const remountAllVideoFields = () => setVideoFieldsEpoch((n) => n + 1);
  const remountEntryVideoFields = (key: string) =>
    setEntryVideoEpochs((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));

  const patchEntry = (key: string, fn: (entry: LogEntry) => LogEntry) =>
    setEntries((prev) => prev.map((entry) => (entry.key === key ? fn(entry) : entry)));

  const patchSets = (key: string, fn: (sets: SetState[]) => SetState[]) =>
    patchEntry(key, (entry) => ({ ...entry, sets: fn(entry.sets) }));

  const handleVideoState = (key: string, sIdx: number, state: VideoUploadState) => {
    const slot = `${key}-${sIdx}`;
    setUploadingKeys((prev) =>
      Boolean(prev[slot]) === state.uploading ? prev : { ...prev, [slot]: state.uploading },
    );
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.key !== key) return entry;
        const current = entry.sets[sIdx];
        if (!current || current.videoFileId === state.fileId) return entry;
        return {
          ...entry,
          sets: entry.sets.map((s, j) => (j === sIdx ? { ...s, videoFileId: state.fileId } : s)),
        };
      }),
    );
  };

  const updateSet = (key: string, sIdx: number, patch: Partial<SetState>) =>
    patchSets(key, (sets) => sets.map((s, j) => (j === sIdx ? { ...s, ...patch } : s)));

  // Mark a set as explicitly skipped. Clears any partial input so it doesn't
  // resurface if the trainee later "Cofnij"-clicks it (they'll start fresh).
  const skipSet = (key: string, sIdx: number) =>
    // Pominięta seria traci też odniesienie do nagrania — wgrany plik zostaje
    // sierotą i sprzątnie go sweeper.
    patchSets(key, (sets) =>
      sets.map((s, j) => (j === sIdx ? { ...blankSet(), skipped: true } : s)),
    );

  const unskipSet = (key: string, sIdx: number) =>
    patchSets(key, (sets) => sets.map((s, j) => (j === sIdx ? blankSet() : s)));

  const copyFromFirst = (key: string) =>
    patchSets(key, (sets) => {
      const first = sets[0];
      if (!first || first.skipped) return sets;
      return sets.map((s, j) =>
        j === 0 || s.skipped
          ? s
          : {
              reps: s.reps || first.reps,
              difficulty: s.difficulty || first.difficulty,
              skipped: false,
              // NIE kopiujemy nagrania z pierwszej serii — jedno wgranie może być
              // podpięte tylko do jednej serii, a duplikat jest odrzucany przy zapisie.
              videoFileId: s.videoFileId,
            },
      );
    });

  /** Kolejny wiersz PONAD plan. Sufit 50 (N15) pilnuje backend; przycisk gaśnie w karcie. */
  const addSet = (key: string) => patchSets(key, (sets) => [...sets, blankSet()]);

  /**
   * Zdejmuje wiersz. Karta podaje `onRemove` wyłącznie dla wiersza ponad plan,
   * ale warunek stoi też tutaj — wiersz planowany zostawiony pusty JEST
   * informacją („seria pominięta"), a nie śmieciem do posprzątania.
   *
   * **Przemontowanie karty jest tu konieczne i jest bezpieczne wyłącznie dzięki
   * blokadzie w karcie.** Konieczne, bo zdjęcie wiersza przesuwa indeksy serii,
   * a `VideoUploadField` czyta `initialFileId` tylko przy montowaniu — bez
   * remountu wiersz pokazywałby nagranie sąsiada. Bezpieczne, bo karta gasi „–",
   * dopóki cokolwiek w niej leci (`uploadInFlight`), więc nie ma wysyłki, którą
   * remount mógłby po cichu przerwać.
   *
   * Rozważane i ODRZUCONE: nadanie wierszom trwałej tożsamości, żeby remount był
   * niepotrzebny. Klucz musiałby zamieszkać w `SetDraft`, a ten jedzie do
   * `sessionStorage` i do `buildLogPayload`.
   *
   * **Cena tego wariantu zmieniła się 2026-09-09 i argument trzeba było przepisać.**
   * Brzmiał: „podniesienie wersji szkicu i odrzucenie szkiców u wszystkich, którzy
   * właśnie ćwiczą". Wersja została podniesiona (v5, klucz WPISU dla przestawiania),
   * a szkice poprzedniej wersji są dziś MIGROWANE, nie odrzucane (`parseDraft`) —
   * więc bump nie kosztuje już cudzego treningu. Zostaje argument słabszy, ale
   * wystarczający: `SetDraft` urósłby o pole, którego jedynym odbiorcą jest
   * uniknięcie remountu jednego przycisku, i o własną ścieżkę migracji przy każdej
   * kolejnej wersji. Nieproporcjonalne do przycisku, który i tak jest do kliknięcia
   * sekundę później.
   */
  const removeSet = (key: string, sIdx: number) => {
    patchEntry(key, (entry) => {
      if (sIdx < (entry.plannedSets ?? 1)) return entry;
      return { ...entry, sets: entry.sets.filter((_, j) => j !== sIdx) };
    });
    remountEntryVideoFields(key);
  };

  /**
   * Wymiana ćwiczenia — podmienia wpis W MIEJSCU, nie dokłada się obok niego.
   * Dzięki temu ćwiczenie zastąpione nigdy nie jedzie w logu jako `planned`,
   * więc `SUBSTITUTED_EXERCISE_ALSO_LOGGED` (N14) nie ma o co zahaczyć,
   * kolejność ćwiczeń zostaje z planu, a pasek postępu liczy się bez wyjątków.
   *
   * Serie CZYŚCIMY, liczbę wierszy zostawiamy: zamiennik może mieć inną flagę
   * oceny trudności, więc wiersze wypełnione pod stare ćwiczenie byłyby
   * niepoprawne — ale liczba serii z planu nadal obowiązuje.
   *
   * ZERUJEMY za to `expectedReps` i `note`, i to jest poprawka o wadze błędu,
   * nie porządki: cel „× 8" pod „Podciąganie 3×8" jest WPISYWANY do pola
   * powtórzeń, gdy podopieczny kliknie trudność (`log-exercise-card`), więc
   * przy zamienniku „Plank" (jednostka SEC) wpisałby plank na osiem sekund —
   * i nikt nie musi tego zauważyć. Notatka trenera dotyczyła ćwiczenia,
   * którego już tu nie ma.
   *
   * **Druga wymiana pod rząd NIE robi łańcucha, i pilnuje tego TERNARY niżej —
   * nie widoczność przycisku.** Karta pokazuje „Wymień" przy każdym wpisie, który
   * nie jest `extra`, więc TAKŻE przy zamienniku; wpis już zamieniony trafia tu
   * ponownie i wtedy `entry.origin === "substitute"` każe zachować PIERWOTNY
   * `substitutedExerciseId`. Gdyby ten warunek uprościć do `entry.exerciseId`,
   * druga wymiana wskazałaby ćwiczenie spoza sesji planu, a to jest N13
   * (`SUBSTITUTED_EXERCISE_NOT_IN_SESSION`) — odbite dopiero przy zapisie, po
   * całym treningu. Ternary NIE jest martwym warunkiem: jest jedyną ochroną tej
   * reguły po stronie klienta.
   *
   * Wpisu `extra` ta funkcja nie obsługuje i karta „Wymień" przy nim nie pokazuje:
   * ćwiczenie spoza planu nie ma czego zastępować, a poprawia się je usunięciem
   * i dodaniem właściwego.
   */
  const swapEntry = (key: string, picked: PickableExercise) => {
    patchEntry(key, (entry) => ({
      ...entry,
      exerciseId: picked.id,
      exerciseName: picked.name,
      unit: picked.unit,
      tracksRpe: picked.tracksRpe,
      origin: "substitute",
      substitutedExerciseId:
        entry.origin === "substitute" ? entry.substitutedExerciseId : entry.exerciseId,
      substitutedExerciseName:
        entry.origin === "substitute" ? entry.substitutedExerciseName : entry.exerciseName,
      expectedReps: null,
      note: null,
      sets: blankSets(entry.sets.length),
    }));
    remountEntryVideoFields(key);
  };

  /** Przywraca wpis z planu po tym samym kluczu — z planową liczbą pustych wierszy. */
  const undoSwap = (key: string) => {
    const base = planEntries.find((p) => p.key === key);
    if (!base) return;
    patchEntry(key, () => ({ ...base, sets: blankSets(base.plannedSets ?? 1) }));
    remountEntryVideoFields(key);
  };

  /** Ćwiczenie spoza planu — na KOŃCU listy, bez celu, z jednym pustym wierszem. */
  const addExtraEntry = (picked: PickableExercise) => {
    const key = `extra:n${extraSeq.current++}`;
    setEntries((prev) => [
      ...prev,
      {
        key,
        exerciseId: picked.id,
        exerciseName: picked.name,
        unit: picked.unit,
        tracksRpe: picked.tracksRpe,
        origin: "extra",
        substitutedExerciseId: null,
        substitutedExerciseName: null,
        plannedSets: null,
        expectedReps: null,
        note: null,
        isDropsetItem: false,
        sets: [blankSet()],
      },
    ]);
  };

  /**
   * Przestawia wpis o jedno miejsce. Kolejność wpisów jest kolejnością
   * WYKONANIA i jedzie do backendu pozycją w tablicy `exercises` ładunku —
   * osobnego pola na nią nie ma i nie potrzeba (`moveEntry`, `lib/log-draft`).
   *
   * Nagrań to NIE dotyka i dlatego nie woła `remountEntryVideoFields`:
   * `entry.key` się nie zmienia, więc React przenosi poddrzewo karty zamiast je
   * przemontować, a przemontowanie ubiłoby trwającą wysyłkę po cichu (ścieżka
   * `ABORTED`). Przestawianie jest z tego powodu jedyną operacją tego ekranu,
   * której nie trzeba blokować na czas wysyłki.
   *
   * `findIndex` oddaje -1, gdy wpis zniknął między renderem a kliknięciem —
   * `moveEntry` oddaje wtedy tę samą tablicę, więc nie ma tu czego sprawdzać
   * drugi raz.
   */
  const moveEntryBy = (key: string, delta: -1 | 1) =>
    setEntries((prev) => {
      const from = prev.findIndex((entry) => entry.key === key);
      return moveEntry(prev, from, from + delta);
    });

  /**
   * Usuwa wpis — WYŁĄCZNIE spoza planu. Bez tego pomyłka w wybieraku jest nie do
   * cofnięcia bez przeładowania strony, czyli utraty całego formularza. Wpisu
   * z planu usunąć nie wolno: pominięcie ćwiczenia wyraża się pustymi seriami.
   */
  const removeEntry = (key: string) => {
    setEntries((prev) => prev.filter((entry) => entry.key !== key || entry.origin !== "extra"));
  };

  // Progress: filled = reps + difficulty set; skipped = explicitly opted-out.
  // Pending = neither (still needs trainee attention before submit feels done).
  //
  // Pasek liczy WSZYSTKIE wiersze formularza — także dołożone ponad plan i te
  // z ćwiczeń spoza planu — a `allDone` w ładunku liczy wyłącznie wiersze
  // planowane (akcja wyżej). Asymetria jest celowa i idzie w stronę bezpieczną:
  // zielony pasek zawsze znaczy `allDone`, ale `allDone` nie musi znaczyć
  // zielonego paska. Odwrotnie byłoby kłamstwem o wykonaniu planu.
  const stats = useMemo(() => {
    let total = 0;
    let filled = 0;
    let skipped = 0;
    for (const entry of entries) {
      for (const s of entry.sets) {
        total++;
        if (s.skipped) skipped++;
        else if (s.reps.trim() !== "" && (!entry.tracksRpe || s.difficulty !== "")) filled++;
      }
    }
    return { total, filled, skipped };
  }, [entries]);

  // Po hydracji: przywróć szkic z sessionStorage — tylko gdy pasuje do bieżącego
  // PLANU (te same ćwiczenia planu w tej samej kolejności) i cokolwiek zawiera.
  // Liczba serii i pochodzenie wpisów jadą w samym szkicu i NIE są kryterium
  // zgodności — to one są treścią wymiany i dodatku. Celowo NIE w inicjalizatorze
  // useState — SSR renderuje pusto, więc odczyt storage tam rozjechałby hydrację.
  // biome-ignore lint/correctness/useExhaustiveDependencies: raz po zamontowaniu
  useEffect(() => {
    try {
      const restored = parseDraft(sessionStorage.getItem(draftKey(session.id)), {
        planExerciseIds,
        planKeys,
      });
      if (restored && draftHasContent(restored, planKeys)) {
        setEntries(rehydrateEntries(planEntries, restored));
        setRestoredDraft(true);
        // Pola wideo czytają `initialFileId` tylko przy montowaniu, a tu jesteśmy już
        // po hydracji — bez przemontowania przywrócone nagrania by się nie pokazały.
        // Wysyłki w tle być tu nie może: to pierwszy render po zamontowaniu.
        remountAllVideoFields();
      }
    } catch {
      // sessionStorage niedostępny (tryb prywatny itd.) — pomijamy przywracanie.
    }
    setDraftReady(true);
  }, []);

  // Zapisuj szkic przy każdej zmianie wpisów — ale dopiero PO próbie przywrócenia,
  // żeby pusty stan startowy nie nadpisał zapisanego szkicu. Pusty stan czyścimy
  // zamiast zapisywać (mniej śmieci; spójne z „Wyczyść szkic").
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (draftHasContent(entries, planKeys)) {
        sessionStorage.setItem(draftKey(session.id), serializeDraft(planExerciseIds, entries));
      } else {
        sessionStorage.removeItem(draftKey(session.id));
      }
    } catch {
      // Best-effort — brak storage nie może wywrócić logowania.
    }
  }, [draftReady, entries, session.id, planExerciseIds, planKeys]);

  // Wraca do NIETKNIĘTEGO planu: znikają też wymiany i ćwiczenia spoza planu,
  // bo one też są treścią szkicu, a nie ozdobą nad nim.
  const clearDraft = () => {
    setEntries(planEntries.map((e) => ({ ...e, sets: blankSets(e.plannedSets ?? 1) })));
    setRestoredDraft(false);
    remountAllVideoFields();
    try {
      sessionStorage.removeItem(draftKey(session.id));
    } catch {
      // ignore
    }
  };

  const swapTarget =
    picker?.mode === "swap" ? (entries.find((e) => e.key === picker.key) ?? null) : null;

  // JEDEN odsiew dla OBU trybów, i to jest poprawka po przeglądzie: wcześniej
  // tryb zamiany odsiewał tylko dwa identyfikatory, więc na sesji „Podciąganie +
  // Pompki" wymiana Podciągania na Pompki dawała dwie karty „Pompki". Backend to
  // przyjmuje (duplikat `exerciseId` jest legalny — robi go dropset), więc nie
  // byłoby żadnej odmowy; był tylko ekran, na którym ta sama reguła obowiązywała
  // w jednym wybieraku i nie obowiązywała w drugim.
  //
  // Odsiewamy każde ćwiczenie, które ten formularz już niesie, ORAZ każde, które
  // został w nim zastąpione — po wymianie W MIEJSCU takiego w `entries` już nie
  // ma, a „Australian pull-up zamiast Podciąganie" obok „Podciąganie poza planem"
  // to „zamiast" i „oraz" naraz, czyli dokładnie to, czego zabrania reguła.
  // AKURAT TEJ kombinacji backend nie łapie, bo N14 patrzy wyłącznie na wpisy
  // `origin === "planned"`.
  //
  // Wpis właśnie zastępowany wpada w ten sam odsiew bez osobnego warunku: stoi
  // w `entries`, więc jego `exerciseId` (wskaźnik na samego siebie —
  // `400 SUBSTITUTION_MISPLACED`) i jego `substitutedExerciseId` już tam są.
  const pickerExcludeIds = useMemo(() => {
    if (picker == null) return [];
    return entries.flatMap((e) =>
      e.substitutedExerciseId == null ? [e.exerciseId] : [e.exerciseId, e.substitutedExerciseId],
    );
  }, [picker, entries]);

  const handlePick = (picked: PickableExercise) => {
    if (picker == null) return;
    if (picker.mode === "extra") addExtraEntry(picked);
    else swapEntry(picker.key, picked);
  };

  return (
    <div>
      <div className="crumbs">
        <Link to="/podopieczny">Mój plan</Link>
        <span className="sep">›</span>
        <span className="current">{session.name}</span>
      </div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Nowa sesja · {entries.length} {pluralizePl(entries.length, CWICZENIE)}
          </div>
          <h1>{session.name}</h1>
          <div className="sub">
            Zarejestruj wykonane serie. Pominięte serie nie wliczają się do statystyk — kliknij
            „Pomiń" obok serii, której nie zrobiłeś. Zrobiłeś coś inaczej, niż planował trener?
            Wymień ćwiczenie albo dorzuć własne.
          </div>
        </div>
      </div>

      {/* Bez `encType="multipart/form-data"`: nagrania lecą osobno na `/upload/wideo`,
          a ten POST niesie już tylko tekst i identyfikatory plików. */}
      <Form method="post" style={{ display: "grid", gap: 14 }}>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {/* Kształt formularza dla akcji — patrz `DescriptorSchema`. Bez tego akcja
            nie ma jak wiedzieć o wpisie spoza planu ani o wierszu ponad plan. */}
        <input type="hidden" name="entries" value={JSON.stringify(entries.map(descriptorOf))} />
        {restoredDraft && (
          <output
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              background: "var(--accent-soft)",
              borderColor: "var(--accent)",
            }}
          >
            <span style={{ fontSize: 13 }}>
              <Icons.Check /> Przywrócono niezapisany szkic tej sesji.{" "}
              <span className="muted">Wgrane nagrania też zostały przywrócone.</span>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={clearDraft}
              style={{ flexShrink: 0 }}
            >
              Wyczyść szkic
            </button>
          </output>
        )}
        <div className="card">
          <div className="grid grid-2" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="log-date">Data</label>
              <input
                id="log-date"
                name="performedOn"
                type="date"
                required
                defaultValue={todayISO()}
                className="input"
              />
            </div>
            <div className="field">
              <label htmlFor="log-note">Notatka (opcjonalnie)</label>
              <input
                id="log-note"
                name="note"
                type="text"
                maxLength={2000}
                placeholder="Jak było? Co czuć, co poszło dobrze…"
                className="input"
              />
            </div>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="empty">
            <h3>Brak ćwiczeń</h3>
            <div>Ta sesja nie ma jeszcze ćwiczeń. Trener musi wypełnić plan.</div>
          </div>
        ) : (
          entries.map((entry, eIdx) => (
            <LogExerciseCard
              key={`${entry.key}-${videoFieldsEpoch}-${entryVideoEpochs[entry.key] ?? 0}`}
              entry={entry}
              eIdx={eIdx}
              totalEntries={entries.length}
              maxVideoBytes={maxVideoBytes}
              uploadInFlight={(uploadingPerEntry[entry.key] ?? 0) > 0}
              onUpdateSet={(sIdx, patch) => updateSet(entry.key, sIdx, patch)}
              onSkipSet={(sIdx) => skipSet(entry.key, sIdx)}
              onUnskipSet={(sIdx) => unskipSet(entry.key, sIdx)}
              onCopyFromFirst={() => copyFromFirst(entry.key)}
              onVideoStateChange={(sIdx, state) => handleVideoState(entry.key, sIdx, state)}
              onAddSet={() => addSet(entry.key)}
              onRemoveSet={(sIdx) => removeSet(entry.key, sIdx)}
              onMoveUp={() => moveEntryBy(entry.key, -1)}
              onMoveDown={() => moveEntryBy(entry.key, 1)}
              onSwap={() => setPicker({ mode: "swap", key: entry.key })}
              onUndoSwap={() => undoSwap(entry.key)}
              onRemoveEntry={() => removeEntry(entry.key)}
            />
          ))
        )}

        <div>
          <button type="button" className="btn" onClick={() => setPicker({ mode: "extra" })}>
            <Icons.Plus /> Dodaj ćwiczenie spoza planu
          </button>
        </div>

        {actionData?.error != null && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
            {actionData.error}
          </p>
        )}

        {entries.length > 0 && (
          <ProgressBar filled={stats.filled} skipped={stats.skipped} total={stats.total} />
        )}

        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          {/* Blokada podwójnej wysyłki: drugie kliknięcie (albo niecierpliwe tapnięcie
              na telefonie, gdy upload wideo trwa kilkadziesiąt sekund) poleciałoby
              z tym samym kluczem idempotencji, więc BE oddałby PIERWOTNY log zamiast
              drugiego. Blokada zostaje jako pierwsza linia obrony — oszczędza zbędny
              obieg i nie każe podopiecznemu zgadywać, czy zapis w ogóle się liczy. */}
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={entries.length === 0 || isSubmitting || uploadingCount > 0}
            aria-busy={isSubmitting}
          >
            <Icons.Check /> {isSubmitting ? "Zapisywanie…" : "Zapisz sesję"}
          </button>
          <Link to="/podopieczny" className="btn btn-ghost btn-lg">
            Anuluj
          </Link>
        </div>

        {/* Widoczny status wysyłki. `disabled` na przycisku zabiera mu fokus, a sama
            zmiana etykiety nie zostaje ogłoszona czytnikowi ekranu — `role="status"`
            to naprawia. Przy nagraniach idących kilkadziesiąt sekund informacja
            „nie zamykaj strony” przydaje się zresztą każdemu. */}
        {isSubmitting && (
          <output className="text-xs muted" style={{ display: "block" }}>
            Zapisywanie treningu… nie zamykaj tej strony.
          </output>
        )}

        {uploadingCount > 0 && (
          <output className="text-xs muted" style={{ display: "block" }}>
            {uploadingCount === 1
              ? "Trwa wysyłka nagrania… zapis ruszy sam, gdy się skończy."
              : `Trwa wysyłka ${uploadingCount} nagrań… zapis ruszy sam, gdy się skończą.`}
          </output>
        )}
      </Form>

      {/* POZA formularzem, i to jest decyzja, nie porządki: modal ma pole szukajki,
          a Enter w polu tekstowym wewnątrz `<form>` wysyła ten formularz. Natywny
          `<dialog>` idzie do warstwy wierzchniej, ale zostaje w tym samym drzewie
          formularza, więc jedynym pewnym rozwiązaniem jest wyjęcie go stąd.
          Renderowany BEZWARUNKOWO — `open` przełącza widoczność, nie montaż:
          odmontowanie gubi `useFetcher` i drugie otwarcie pyta o bibliotekę od nowa. */}
      <ExercisePicker
        open={picker != null}
        onClose={() => setPicker(null)}
        onPick={handlePick}
        title={
          picker?.mode === "swap"
            ? `Zamiennik dla: ${swapTarget?.exerciseName ?? ""}`
            : "Ćwiczenie spoza planu"
        }
        excludeIds={pickerExcludeIds}
        excludedNote={
          picker?.mode === "swap"
            ? "To ćwiczenie już stoi w tym formularzu albo właśnie je zastąpiłeś — wybierz inne."
            : "To ćwiczenie jest już w tym formularzu albo właśnie je zastąpiłeś. Dodatkowe serie dokładasz przyciskiem „Dodaj serię” w jego karcie."
        }
      />

      <div className="text-xs muted" style={{ marginTop: 18 }}>
        Zalogowany jako {user.displayName}.
      </div>
    </div>
  );
}

/**
 * Łapie błędy loadera/akcji tej trasy — w szczególności zerwaną wysyłkę
 * formularza (`TypeError: Failed to fetch`), gdy upload wideo nie dojdzie do
 * serwera. Zamiast surowego „Application Error" pokazujemy czytelny komunikat.
 * Wpisane serie są bezpieczne w sessionStorage — powrót do formularza je odtworzy.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div>
      <div className="crumbs">
        <Link to="/podopieczny">Mój plan</Link>
      </div>
      <div className="empty" style={{ marginTop: 24 }}>
        <h3>{isNotFound ? "Nie znaleziono sesji" : "Nie udało się zapisać treningu"}</h3>
        <div style={{ maxWidth: 460, margin: "8px auto 0", lineHeight: 1.5 }}>
          {isNotFound ? (
            "Ta sesja nie istnieje albo nie masz do niej dostępu."
          ) : (
            <>
              Coś przerwało zapis — najczęściej słabe połączenie. Twoje wpisane serie oraz wgrane
              nagrania zostały zachowane w tej przeglądarce; wróć do formularza i spróbuj ponownie.
            </>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <Link to={isNotFound ? "/podopieczny" : "."} className="btn btn-primary">
            {isNotFound ? "Wróć do planu" : "Wróć do formularza"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  filled,
  skipped,
  total,
}: {
  filled: number;
  skipped: number;
  total: number;
}) {
  const accounted = filled + skipped;
  const pct = total === 0 ? 0 : Math.round((accounted / total) * 100);
  const filledPct = total === 0 ? 0 : (filled / total) * 100;
  const skippedPct = total === 0 ? 0 : (skipped / total) * 100;
  const allFilled = filled === total && total > 0;
  const allAccounted = accounted === total && total > 0;
  const pending = total - accounted;

  return (
    <div
      className="card"
      style={{
        padding: "10px 14px",
        background: allFilled ? "var(--accent-soft)" : "var(--surface)",
        borderColor: allFilled ? "var(--accent)" : undefined,
      }}
    >
      <div className="row between" style={{ marginBottom: 6, gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {allFilled ? (
            <>
              <Icons.Check style={{ color: "var(--ok)" }} /> Wszystkie serie wypełnione
            </>
          ) : allAccounted ? (
            <>
              <span className="mono">{filled}</span> wypełnion
              {filled === 1 ? "a" : "ych"}
              {skipped > 0 && (
                <>
                  {" · "}
                  <span className="mono" style={{ color: "var(--muted)" }}>
                    {skipped}
                  </span>{" "}
                  <span className="muted">
                    {pluralizePl(skipped, {
                      one: "pominięta",
                      few: "pominięte",
                      many: "pominiętych",
                    })}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <span className="mono">{filled}</span> z <span className="mono">{total}</span>{" "}
              {pluralizePl(total, SERIA)} wypełnion{filled === 1 ? "a" : "ych"}
              {skipped > 0 && (
                <>
                  {" · "}
                  <span className="mono" style={{ color: "var(--muted)" }}>
                    {skipped}
                  </span>{" "}
                  <span className="muted">pominięte</span>
                </>
              )}
              {pending > 0 && (
                <>
                  {" · "}
                  <span className="mono" style={{ color: "var(--muted)" }}>
                    {pending}
                  </span>{" "}
                  <span className="muted">do uzupełnienia</span>
                </>
              )}
            </>
          )}
        </span>
        <span className="mono text-xs muted">{pct}%</span>
      </div>
      <div
        style={{
          display: "flex",
          height: 4,
          background: "var(--surface-2)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${filledPct}%`,
            height: "100%",
            background: allFilled ? "var(--ok)" : "var(--accent)",
            transition: "width .15s ease, background .15s ease",
          }}
        />
        <div
          style={{
            width: `${skippedPct}%`,
            height: "100%",
            background: "var(--muted-2)",
            transition: "width .15s ease",
          }}
        />
      </div>
    </div>
  );
}
