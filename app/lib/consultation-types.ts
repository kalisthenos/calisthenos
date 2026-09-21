import type { ConsultationView } from "@kalisthenos/api-client";
import { z } from "zod";

// Status z kontraktu, nie ze schematu Drizzle — od przepięcia konsultacji na BE
// to kontrakt jest źródłem zbioru wartości. Nazwa zostaje, żeby guardy i testy
// nie zauważyły zmiany.
type ConsultationStatus = ConsultationView["status"];

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Niepoprawna data.");
// datetime-local z <input type="datetime-local"> ma format "YYYY-MM-DDTHH:MM".
const dateTimeLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Niepoprawna data/godzina.");
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Niepoprawna godzina.");
// Link spotkania trafia do `<a href>` widzianego przez podopiecznego — ograniczamy
// do http(s), by URL `javascript:`/`data:` nie mógł wykonać skryptu w jego sesji.
const meetingUrl = z
  .string()
  .trim()
  .url("Niepoprawny URL.")
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), "Link musi zaczynać się od http:// lub https://");

// ---------------- Punkty „do poprawy" ----------------

export const ConsultationItemStatusSchema = z.enum(["open", "resolved"]);
export type ConsultationItemStatusForm = z.infer<typeof ConsultationItemStatusSchema>;

export const ActionItemFormSchema = z.object({
  id: z.string().optional(),
  body: z.string().trim().min(1, "Treść punktu nie może być pusta.").max(2000),
  status: ConsultationItemStatusSchema.default("open"),
});
export type ActionItemForm = z.infer<typeof ActionItemFormSchema>;

// ---------------- Harmonogram ----------------

export const ScheduleFormSchema = z
  .object({
    cadence: z.enum(["weekly", "biweekly", "monthly"]),
    weekday: z.coerce.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(28).nullable().optional(),
    timeOfDay: timeString,
    durationMin: z.coerce.number().int().min(5, "Minimum 5 minut.").max(480, "Maksimum 480 minut."),
    startsOn: dateString,
    defaultMeetingUrl: meetingUrl.nullable().optional(),
  })
  .refine((s) => (s.cadence === "monthly" ? s.dayOfMonth != null : s.weekday != null), {
    message: "Wskaż dzień zgodny z częstotliwością.",
    path: ["cadence"],
  });
export type ScheduleForm = z.infer<typeof ScheduleFormSchema>;

// ---------------- Dokumentacja / termin ad-hoc ----------------

/**
 * **Dokumentacja niesie DOKŁADNIE to, co przyjmuje `POST …/document`** — czyli
 * podsumowanie i punkty. Nic więcej (D-FE-5).
 *
 * Do 2026-09-21 był tu jeden schemat na dwie różne operacje i zbierał pięć pól,
 * których dokumentacja nie wysyła: termin, czas trwania, odnośnik, tytuł
 * i okres. Formularz je pokazywał, Zod walidował, a moduł wyrzucał przed
 * wysyłką — trener poprawiał link do spotkania, zapisywał i **nic się nie
 * działo**. `title` i `periodFrom`/`periodTo` odpadły całkiem: kontrakt ich nie
 * zna, tytuł nadaje serwer sam, a kolumny okresu są spadkiem po aplikacji
 * fullstackowej, o którym `docs/04` milczy.
 */
export const ConsultationDocFormSchema = z.object({
  summary: z.string().max(10000).default(""),
  items: z.array(ActionItemFormSchema).max(50).default([]),
});
export type ConsultationDocForm = z.infer<typeof ConsultationDocFormSchema>;

/**
 * Termin poza serią — `POST /v1/consultations` przyjmuje TE pola, więc tu są
 * żywe. Ten sam formularz, inny zestaw: różnicę niesie prop `tryb`
 * komponentu, a nie domysł wykonawcy.
 */
export const AdhocConsultationFormSchema = ConsultationDocFormSchema.extend({
  scheduledAt: dateTimeLocal,
  durationMin: z.coerce
    .number()
    .int()
    .min(5, "Minimum 5 minut.")
    .max(480, "Maksimum 480 minut.")
    .default(45),
  meetingUrl: meetingUrl.nullable().optional(),
});
export type AdhocConsultationForm = z.infer<typeof AdhocConsultationFormSchema>;

// ---------------- Akcja podopiecznego ----------------

export const TraineeActionSchema = z.enum(["confirm", "decline", "request_change"]);
export type TraineeAction = z.infer<typeof TraineeActionSchema>;

// ---------------- Tabela przejść: NIE MA JEJ TUTAJ ----------------
//
// Do 2026-09-21 stały tu cztery gwardie — `canTraineeAct`,
// `canTrainerReschedule`, `canTrainerCancel` i `canDocument` — czyli druga
// kopia tabeli przejść, po tej stronie szwu. Nie wołało ich już nic, ale miały
// własne testy, więc wyglądały na żywe i zapraszały do użycia; przy tym
// **każda z nich dopuszczała WIĘCEJ niż backend** (D-FE-4).
//
// Tabela przejść należy do kontraktu i przychodzi przy każdym terminie jako
// `allowedActions`. Jeśli szukasz tu odpowiedzi „czy wolno przełożyć" —
// odpowiedź jest w `termin.allowedActions`, a nie w funkcji, którą trzeba
// pamiętać, żeby zaktualizować.
