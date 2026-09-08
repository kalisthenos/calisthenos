import { useEffect, useMemo, useState } from "react";
import {
  Form,
  isRouteErrorResponse,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { z } from "zod";
import { Icons } from "~/components/icons";
import { LogExerciseCard } from "~/components/log-exercise-card";
import type { VideoUploadState } from "~/components/video-upload-field";
import { requireUser } from "~/lib/api/auth";
import { maxUploadBytesFor } from "~/lib/file-uploads";
import { pluralizePl, todayISO, type PlForms } from "~/lib/format";
import {
  draftHasContent,
  draftKey,
  parseDraft,
  serializeDraft,
  type SetDraft,
} from "~/lib/log-draft";
import {
  loadSessionForLogging,
  saveWorkoutLog,
  toLoggingEntries,
  WorkoutSaveError,
} from "~/lib/workouts";

const PerformedOnSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Nieprawidłowa data.");
const NoteSchema = z.string().max(2000).optional();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loader(args: LoaderFunctionArgs) {
  const { api, user } = requireUser(args.context, { role: "trainee" });
  const session = await loadSessionForLogging(api, args.params.sessionId ?? "");
  if (!session) throw new Response("not found", { status: 404 });

  return {
    user,
    session: { id: session.id, name: session.name },
    entries: toLoggingEntries(session),
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

  const session = await loadSessionForLogging(api, args.params.sessionId ?? "");
  if (!session) throw new Response("not found", { status: 404 });
  const entries = toLoggingEntries(session);

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

  try {
    const exercisesPayload: Array<{
      exerciseId: string;
      sets: Array<{
        ordinal: number;
        reps: number;
        difficulty: number | null;
        videoFileId: string | null;
      }>;
    }> = [];

    let anySetLogged = false;
    let allSetsFilled = true;

    for (const [eIdx, entry] of entries.entries()) {
      const sets: Array<{
        ordinal: number;
        reps: number;
        difficulty: number | null;
        videoFileId: string | null;
      }> = [];
      for (let sIdx = 0; sIdx < entry.expectedSets; sIdx++) {
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

        const tracksRpe = entry.tracksRpe;

        // Pusty wiersz: dla ćwiczeń z RPE „pusty” = brak reps/diff/wideo;
        // dla ćwiczeń bez RPE „pusty” = brak reps/wideo (trudności i tak nie ma).
        const isBlank = tracksRpe ? !hasReps && !hasDiff && !hasVideo : !hasReps && !hasVideo;
        if (isBlank) {
          allSetsFilled = false;
          continue;
        }

        // Wiersz częściowy: reps zawsze wymagane; trudność tylko gdy tracksRpe.
        if (!hasReps || (tracksRpe && !hasDiff)) {
          return {
            error: tracksRpe
              ? `Ćwiczenie ${entry.exerciseName}, seria #${sIdx + 1}: uzupełnij liczbę powtórzeń i trudność (1-10).`
              : `Ćwiczenie ${entry.exerciseName}, seria #${sIdx + 1}: uzupełnij liczbę powtórzeń.`,
          };
        }

        const reps = Number(repsRaw);
        if (!Number.isFinite(reps) || reps < 1 || reps > 1000) {
          return {
            error: `Ćwiczenie ${entry.exerciseName}, seria #${sIdx + 1}: liczba powtórzeń poza zakresem (1-1000).`,
          };
        }

        let difficulty: number | null = null;
        if (tracksRpe) {
          difficulty = Number(diffRaw);
          if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 10) {
            return {
              error: `Ćwiczenie ${entry.exerciseName}, seria #${sIdx + 1}: trudność musi być 1-10.`,
            };
          }
        }

        sets.push({ ordinal: sIdx, reps, difficulty, videoFileId: videoId });
        anySetLogged = true;
      }

      exercisesPayload.push({ exerciseId: entry.exerciseId, sets });
    }

    if (!anySetLogged) {
      return { error: "Zapisz co najmniej jedną serię." };
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

type SetState = SetDraft;

const CWICZENIE: PlForms = { one: "ćwiczenie", few: "ćwiczenia", many: "ćwiczeń" };
const SERIA: PlForms = { one: "seria", few: "serie", many: "serii" };

export default function LogForm() {
  const { user, session, entries, maxVideoBytes, idempotencyKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  // `formMethod != null` zamiast `state !== "idle"`: łapie wyłącznie wysyłkę
  // formularza (i przeżywa fazę `loading` po redircie, w której najłatwiej kliknąć
  // drugi raz), ale nie zwykłą nawigację — bez tego przycisk mrugałby
  // „Zapisywanie…” także po kliknięciu „Anuluj”.
  const isSubmitting = navigation.formMethod != null;

  // Lift set-level state up so we can compute progress + power the
  // "copy from #1" affordance. The form's submit still relies on the
  // name attributes on each input — we just control their values.
  //
  // reps starts empty (placeholder shows the target); picking difficulty
  // auto-fills reps with the target. This way an untouched row stays a
  // clean "skipped" submission instead of forcing the trainee to clear
  // pre-filled numbers.
  const [setStates, setSetStates] = useState<SetState[][]>(() =>
    entries.map((entry) =>
      Array.from({ length: entry.expectedSets }, () => ({
        reps: "",
        difficulty: "",
        skipped: false,
        videoFileId: null,
      })),
    ),
  );

  // Które pola aktualnie wysyłają nagranie — zapis jest zablokowany, dopóki cokolwiek
  // leci, żeby trening nie zapisał się bez wideo, na które podopieczny właśnie czeka.
  const [uploadingKeys, setUploadingKeys] = useState<Record<string, boolean>>({});
  const uploadingCount = Object.values(uploadingKeys).filter(Boolean).length;

  const handleVideoState = (eIdx: number, sIdx: number, state: VideoUploadState) => {
    const key = `${eIdx}-${sIdx}`;
    setUploadingKeys((prev) =>
      Boolean(prev[key]) === state.uploading ? prev : { ...prev, [key]: state.uploading },
    );
    setSetStates((prev) => {
      const current = prev[eIdx]?.[sIdx];
      if (!current || current.videoFileId === state.fileId) return prev;
      return prev.map((sets, i) =>
        i === eIdx
          ? sets.map((s, j) => (j === sIdx ? { ...s, videoFileId: state.fileId } : s))
          : sets,
      );
    });
  };

  const updateSet = (eIdx: number, sIdx: number, patch: Partial<SetState>) => {
    setSetStates((prev) =>
      prev.map((sets, i) =>
        i === eIdx ? sets.map((s, j) => (j === sIdx ? { ...s, ...patch } : s)) : sets,
      ),
    );
  };

  // Mark a set as explicitly skipped. Clears any partial input so it doesn't
  // resurface if the trainee later "Cofnij"-clicks it (they'll start fresh).
  const skipSet = (eIdx: number, sIdx: number) => {
    setSetStates((prev) =>
      prev.map((sets, i) =>
        i === eIdx
          ? sets.map((s, j) =>
              // Pominięta seria traci też odniesienie do nagrania — wgrany plik zostaje
              // sierotą i sprzątnie go sweeper.
              j === sIdx ? { reps: "", difficulty: "", skipped: true, videoFileId: null } : s,
            )
          : sets,
      ),
    );
  };

  const unskipSet = (eIdx: number, sIdx: number) => {
    setSetStates((prev) =>
      prev.map((sets, i) =>
        i === eIdx
          ? sets.map((s, j) =>
              j === sIdx ? { reps: "", difficulty: "", skipped: false, videoFileId: null } : s,
            )
          : sets,
      ),
    );
  };

  const copyFromFirst = (eIdx: number) => {
    setSetStates((prev) =>
      prev.map((sets, i) => {
        if (i !== eIdx) return sets;
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
      }),
    );
  };

  // Progress: filled = reps + difficulty set; skipped = explicitly opted-out.
  // Pending = neither (still needs trainee attention before submit feels done).
  const stats = useMemo(() => {
    let total = 0;
    let filled = 0;
    let skipped = 0;
    setStates.forEach((sets, eIdx) => {
      const tracksRpe = entries[eIdx]?.tracksRpe ?? true;
      for (const s of sets) {
        total++;
        if (s.skipped) skipped++;
        else if (s.reps.trim() !== "" && (!tracksRpe || s.difficulty !== "")) filled++;
      }
    });
    return { total, filled, skipped };
  }, [setStates, entries]);

  const setCounts = useMemo(() => entries.map((e) => e.expectedSets), [entries]);
  const exerciseIds = useMemo(() => entries.map((e) => e.exerciseId), [entries]);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  // Licznik przemontowań kart ćwiczeń. `VideoUploadField` trzyma stan wysyłki u siebie
  // i czyta `initialFileId` tylko raz, więc każde ZEWNĘTRZNE nadpisanie serii
  // (przywrócenie szkicu, wyczyszczenie go) musi go przemontować. Pola tekstowe są
  // kontrolowane przez `setStates`, więc remount karty niczego nie gubi.
  const [videoFieldsEpoch, setVideoFieldsEpoch] = useState(0);

  const emptyState = (): SetState[][] =>
    entries.map((entry) =>
      Array.from({ length: entry.expectedSets }, () => ({
        reps: "",
        difficulty: "",
        skipped: false,
        videoFileId: null,
      })),
    );

  // Po hydracji: przywróć szkic z sessionStorage — tylko gdy pasuje do bieżącego
  // planu (te same ćwiczenia w tej samej kolejności + liczby serii) i cokolwiek
  // zawiera. Celowo NIE w inicjalizatorze useState — SSR renderuje pusto, więc
  // odczyt storage tam rozjechałby hydrację.
  // biome-ignore lint/correctness/useExhaustiveDependencies: raz po zamontowaniu
  useEffect(() => {
    try {
      const restored = parseDraft(sessionStorage.getItem(draftKey(session.id)), {
        exerciseIds,
        setCounts,
      });
      if (restored && draftHasContent(restored)) {
        setSetStates(restored);
        setRestoredDraft(true);
        // Pola wideo czytają `initialFileId` tylko przy montowaniu, a tu jesteśmy już
        // po hydracji — bez przemontowania przywrócone nagrania by się nie pokazały.
        setVideoFieldsEpoch((n) => n + 1);
      }
    } catch {
      // sessionStorage niedostępny (tryb prywatny itd.) — pomijamy przywracanie.
    }
    setDraftReady(true);
  }, []);

  // Zapisuj szkic przy każdej zmianie serii — ale dopiero PO próbie przywrócenia,
  // żeby pusty stan startowy nie nadpisał zapisanego szkicu. Pusty stan czyścimy
  // zamiast zapisywać (mniej śmieci; spójne z „Wyczyść szkic").
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (draftHasContent(setStates)) {
        sessionStorage.setItem(draftKey(session.id), serializeDraft(exerciseIds, setStates));
      } else {
        sessionStorage.removeItem(draftKey(session.id));
      }
    } catch {
      // Best-effort — brak storage nie może wywrócić logowania.
    }
  }, [draftReady, setStates, session.id, exerciseIds]);

  const clearDraft = () => {
    setSetStates(emptyState());
    setRestoredDraft(false);
    setVideoFieldsEpoch((n) => n + 1);
    try {
      sessionStorage.removeItem(draftKey(session.id));
    } catch {
      // ignore
    }
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
            „Pomiń" obok serii, której nie zrobiłeś.
          </div>
        </div>
      </div>

      {/* Bez `encType="multipart/form-data"`: nagrania lecą osobno na `/upload/wideo`,
          a ten POST niesie już tylko tekst i identyfikatory plików. */}
      <Form method="post" style={{ display: "grid", gap: 14 }}>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
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
              key={`${entry.planItemId}-${eIdx}-${videoFieldsEpoch}`}
              entry={entry}
              eIdx={eIdx}
              totalEntries={entries.length}
              sets={setStates[eIdx] ?? []}
              maxVideoBytes={maxVideoBytes}
              onUpdateSet={(sIdx, patch) => updateSet(eIdx, sIdx, patch)}
              onSkipSet={(sIdx) => skipSet(eIdx, sIdx)}
              onUnskipSet={(sIdx) => unskipSet(eIdx, sIdx)}
              onCopyFromFirst={() => copyFromFirst(eIdx)}
              onVideoStateChange={(sIdx, state) => handleVideoState(eIdx, sIdx, state)}
            />
          ))
        )}

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
