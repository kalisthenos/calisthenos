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
    durationMin: z.coerce.number().int().positive().max(600),
    startsOn: dateString,
    defaultMeetingUrl: meetingUrl.nullable().optional(),
  })
  .refine((s) => (s.cadence === "monthly" ? s.dayOfMonth != null : s.weekday != null), {
    message: "Wskaż dzień zgodny z częstotliwością.",
    path: ["cadence"],
  });
export type ScheduleForm = z.infer<typeof ScheduleFormSchema>;

// ---------------- Dokumentacja / termin ad-hoc ----------------

export const ConsultationDocFormSchema = z
  .object({
    scheduledAt: dateTimeLocal,
    durationMin: z.coerce.number().int().positive().max(600).default(45),
    meetingUrl: meetingUrl.nullable().optional(),
    title: z.string().trim().min(1, "Tytuł jest wymagany.").max(160),
    summary: z.string().max(10000).default(""),
    periodFrom: dateString.nullable().optional(),
    periodTo: dateString.nullable().optional(),
    items: z.array(ActionItemFormSchema).max(50).default([]),
  })
  .refine((c) => (c.periodFrom == null) === (c.periodTo == null), {
    message: "Podaj oba końce okresu albo żaden.",
    path: ["periodTo"],
  })
  .refine((c) => c.periodFrom == null || c.periodTo == null || c.periodFrom <= c.periodTo, {
    message: "Początek okresu nie może być po końcu.",
    path: ["periodTo"],
  });
export type ConsultationDocForm = z.infer<typeof ConsultationDocFormSchema>;

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
