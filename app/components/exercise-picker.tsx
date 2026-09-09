import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { PickableExercise } from "~/lib/exercises";
import { Icons } from "./icons";
import { Modal } from "./modal";

/**
 * Wybierak ćwiczenia z biblioteki podopiecznego (`GET /biblioteka-cwiczen`) —
 * modal jednokrotnego wyboru: zamiennik ćwiczenia w sesji albo dodatek spoza
 * planu. Biblioteka schodzi LENIWIE przez `useFetcher`, dopiero przy
 * pierwszym `open`. Renderuj ten komponent NA STAŁE, tak jak `Modal`, na
 * którym stoi — `open` ma przełączać WIDOCZNOŚĆ, nie montaż. Odmontowanie
 * między otwarciami gubi stan `fetcher` i drugie otwarcie pyta backend od
 * nowa, mimo że biblioteka się nie zmieniła.
 *
 * **Granica testu:** niżej jest test WYŁĄCZNIE dla `filterExercises` —
 * czystej funkcji wydzielonej z komponentu. `@testing-library/react` nie
 * jest dziś zależnością tego drzewa, więc sam modal (otwarcie, wybór klikiem,
 * Esc, komunikat pustej biblioteki, wybór między `excludedNote` a „Nic nie
 * pasuje…") nie ma tu testu renderującego — pokrywa go scenariusz Playwrighta
 * z Zadania 10. Brak tego testu TUTAJ jest granicą zakresu, nie przeoczeniem.
 */
export interface ExercisePickerProps {
  open: boolean;
  onClose: () => void;
  /** Wybór jest JEDNOKROTNY — modal zamyka się zaraz po wywołaniu. */
  onPick: (exercise: PickableExercise) => void;
  title: string;
  /**
   * Ćwiczenia do odsiania z listy — typowo ćwiczenie właśnie zastępowane,
   * żeby nie dało się wybrać go jako swojego własnego zamiennika (backend
   * odmówiłby `SUBSTITUTION_MISPLACED`).
   */
  excludeIds?: string[];
  /**
   * Zdanie pokazywane zamiast „Nic nie pasuje do…", gdy szukajka COŚ znalazła,
   * ale wszystko wypadło przez `excludeIds`. Bez tego odsiew wygląda jak awaria
   * biblioteki: użytkownik wpisuje nazwę ćwiczenia, o którym wie, że trener je
   * ma, i dostaje komunikat sugerujący, że go nie ma.
   */
  excludedNote?: string;
}

export function ExercisePicker({
  open,
  onClose,
  onPick,
  title,
  excludeIds,
  excludedNote,
}: ExercisePickerProps) {
  const fetcher = useFetcher<{ exercises: PickableExercise[]; error: string | null }>();
  const [q, setQ] = useState("");
  // Czy w ogóle prosiliśmy o bibliotekę. Bez tego pierwsza klatka po otwarciu
  // (jeszcze przed efektem) wyglądałaby jak awaria: dane puste, fetcher `idle`.
  const proszono = useRef(false);

  const wczytaj = () => {
    proszono.current = true;
    fetcher.load("/biblioteka-cwiczen");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `fetcher` zmienia referencję co render — start wczytywania ma sterować wyłącznie `open`
  useEffect(() => {
    if (open) {
      // Ponawiamy też po nieudanej próbie: `fetcher.data` jest wtedy OBECNE
      // (trasa zasobowa nie rzuca, tylko oddaje `error`), więc sam warunek
      // „brak danych" zamroziłby wybierak na komunikacie o awarii na zawsze.
      if (fetcher.state === "idle" && (fetcher.data === undefined || fetcher.data.error != null)) {
        wczytaj();
      }
    } else {
      setQ("");
    }
  }, [open]);

  function pick(exercise: PickableExercise) {
    onPick(exercise);
    onClose();
  }

  // Awaria przychodzi DANYMI z trasy zasobowej (`error`). Drugi człon łapie
  // przypadek, w którym `fetcher` osiadł bez żadnych danych — wtedy komunikat
  // jest ogólny, ale wybierak nadal ma przycisk, zamiast kręcić się w kółko.
  const blad =
    fetcher.data?.error ??
    (proszono.current && fetcher.state === "idle" && fetcher.data === undefined
      ? "Nie udało się wczytać biblioteki ćwiczeń."
      : null);
  const loading = fetcher.data === undefined && blad == null;
  const library = fetcher.data?.exercises ?? [];
  const visible = filterExercises(library, q, excludeIds);
  // Ile ćwiczeń pasowało do szukajki, ale wypadło przez odsiew — rozróżnia
  // „biblioteka tego nie ma" od „tego akurat nie wolno tu wybrać".
  const odsiane = filterExercises(library, q).length - visible.length;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="modal-body">
        {loading ? (
          <div className="text-sm muted">Wczytywanie ćwiczeń…</div>
        ) : blad != null ? (
          <div className="empty">
            <h3>Nie udało się wczytać biblioteki</h3>
            <div>{blad} Twój formularz jest cały — nic z niego nie zniknęło.</div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-sm" onClick={wczytaj}>
                Spróbuj ponownie
              </button>
            </div>
          </div>
        ) : library.length === 0 ? (
          <div className="empty">
            <h3>Biblioteka jest pusta</h3>
            <div>Trener nie dodał jeszcze żadnego ćwiczenia.</div>
          </div>
        ) : (
          <>
            <div className="input-search">
              <Icons.Search />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Szukaj ćwiczenia…"
                className="input"
                autoComplete="off"
                aria-label="Szukaj ćwiczenia"
              />
            </div>
            {visible.length === 0 ? (
              <div className="text-sm muted">
                {odsiane > 0 && excludedNote != null
                  ? excludedNote
                  : q.trim() === ""
                    ? "Brak innych ćwiczeń do wyboru."
                    : `Nic nie pasuje do „${q}".`}
              </div>
            ) : (
              <div className="col" style={{ gap: 10, maxHeight: 360, overflowY: "auto" }}>
                {visible.map((exercise) => (
                  <button
                    key={exercise.id}
                    type="button"
                    onClick={() => pick(exercise)}
                    className="card card-hover row between"
                    style={{ width: "100%", textAlign: "left" }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{exercise.name}</span>
                    <span
                      className="mono text-xs muted"
                      style={{ textTransform: "uppercase", letterSpacing: ".08em" }}
                    >
                      {exercise.unit === "SEC" ? "sek." : "powt."}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Czysty filtr biblioteki: szukajka po nazwie (bez względu na wielkość
 * liter, z przyciętymi białymi znakami) i odsianie `excludeIds`. Wydzielona
 * z komponentu właśnie po to, żeby dało się ją przetestować bez renderowania
 * (patrz docblock wyżej).
 */
export function filterExercises(
  exercises: PickableExercise[],
  query: string,
  excludeIds: string[] = [],
): PickableExercise[] {
  const needle = query.trim().toLowerCase();
  return exercises.filter((e) => {
    if (excludeIds.includes(e.id)) return false;
    return needle === "" || e.name.toLowerCase().includes(needle);
  });
}
