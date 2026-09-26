import type { ConsultationView } from "@kalisthenos/api-client";

/**
 * Plakietka terminu konsultacji — etykieta i ton — **wyliczana z klucza, który
 * przysyła serwer**, nie z własnej tabeli przejść.
 *
 * Do 2026-09-21 ten moduł liczył klucz sam, z `status` i `scheduledAt`, mimo że
 * kontrakt niesie gotowe `presentation.key` przy każdym terminie. Dwie kopie
 * jednej reguły rozjechały się dokładnie tak, jak zapowiadał docblock
 * `CONSULTATION_ACTION` po stronie BE — D-FE-4.
 *
 * **Etykieta nie zależy już od roli.** `docs/02` §5 podnosi to do rangi
 * niezmiennika: ten sam termin nie może wyglądać inaczej u trenera
 * i u podopiecznego. Dawne „do potwierdzenia" u podopiecznego łamało go wprost;
 * to, co podopieczny ma zrobić, mówią teraz `allowedActions`, czyli przyciski,
 * a nie plakietka.
 *
 * **Ton zostaje słownikiem TEGO drzewa**, nie kontraktu. Kontraktowe
 * `neutral | positive | warning | muted` nie odróżnia „potwierdzony" od
 * „udokumentowany", a design-system je rozróżnia — i te same tony noszą
 * zgłoszenia (`feature-request-badge.tsx`). Przeliczanie tonu z kontraktu
 * zubożyłoby wygląd i zabrałoby zgłoszeniom ich własny słownik.
 */

export type ConsultationTone =
  | "scheduled"
  | "pending"
  | "confirmed"
  | "change"
  | "cancelled"
  | "done";

export interface ConsultationBadge {
  label: string;
  tone: ConsultationTone;
}

/** Kolor tekstu badge per ton (zmienne z tokens.css). */
export const TONE_TEXT: Record<ConsultationTone, string> = {
  scheduled: "var(--ink-2)",
  pending: "var(--warn)",
  confirmed: "var(--ok)",
  change: "var(--warn)",
  cancelled: "var(--muted)",
  done: "var(--muted)",
};

/** Kolor kropki statusu (badge + kropka dnia w kalendarzu). */
export const TONE_DOT: Record<ConsultationTone, string> = {
  scheduled: "var(--muted-2)",
  pending: "var(--warn)",
  confirmed: "var(--ok)",
  change: "var(--warn)",
  cancelled: "var(--muted-2)",
  done: "var(--ok)",
};

/** Priorytet tonu na zbiorczej kropce dnia (wyższy = ważniejszy). */
const TONE_PRIORITY: Record<ConsultationTone, number> = {
  pending: 5,
  change: 4,
  confirmed: 3,
  scheduled: 2,
  done: 1,
  cancelled: 0,
};

/** Najważniejszy ton z listy (dla dnia z kilkoma terminami). Null gdy pusto. */
export function mostUrgentTone(tones: ConsultationTone[]): ConsultationTone | null {
  let best: ConsultationTone | null = null;
  for (const t of tones) {
    if (best === null || TONE_PRIORITY[t] > TONE_PRIORITY[best]) best = t;
  }
  return best;
}

/**
 * Klucze znane dziś. **Celowo `Record<string, …>`, nie
 * `Record<ConsultationPresentationKey, …>`** — patrz `presentationFor` niżej.
 *
 * `in_progress` i `confirmed_past` są tu **wcześniej, niż pojawią się w typach
 * pakietu**: backend zaczyna je zwracać po wydaniu rozszerzającym (ADR-0042),
 * a klient ma je rozumieć od pierwszej odpowiedzi, nie od kolejnego podbicia.
 * `planned_past` i `confirmed_past` dzielą etykietę, bo z punktu widzenia
 * trenera znaczą to samo: spotkanie się odbyło i czeka na dokumentację.
 */
const BADGE: Record<string, ConsultationBadge> = {
  planned: { label: "zaplanowany", tone: "scheduled" },
  planned_past: { label: "do udokumentowania", tone: "pending" },
  confirmed: { label: "potwierdzony", tone: "confirmed" },
  in_progress: { label: "trwa teraz", tone: "confirmed" },
  confirmed_past: { label: "do udokumentowania", tone: "pending" },
  change_requested: { label: "prośba o zmianę", tone: "change" },
  cancelled: { label: "odwołany", tone: "cancelled" },
  documented: { label: "udokumentowany", tone: "done" },
};

/**
 * Wartość zapasowa dla klucza, którego ten klient jeszcze nie zna.
 *
 * **Nie jest ostrożnością — jest zobowiązaniem z ADR-0042.** `presentation.key`
 * jest w kontrakcie zadeklarowany jako `x-extensible-enum`, czyli zbiór, który
 * ma rosnąć; w zamian każdy konsument obowiązany jest obsłużyć wartość nieznaną.
 * Wyczerpujący `Record` po unii z pakietu spełniałby ten obowiązek pozornie:
 * kompilowałby się, a w czasie wykonania oddawał `undefined` i wywracał render
 * na pierwszej nowej wartości.
 */
const NIEZNANY: ConsultationBadge = { label: "termin", tone: "scheduled" };

/**
 * Plakietka dla terminu. Bierze **całe** `presentation` z kontraktu, nie sam
 * klucz — dzięki temu wołający nie ma jak podać klucza z innego miejsca.
 */
export function presentationFor(presentation: ConsultationView["presentation"]): ConsultationBadge {
  return BADGE[presentation.key] ?? NIEZNANY;
}
