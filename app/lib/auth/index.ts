// Sesja i tożsamość użytkownika mieszkają w `app/lib/api/` (spec rozbicia
// FE/BE, kroki 1 i 2 Etapu 2): `requireUser`/`optionalUser` czytają `context`
// wypełniony przez `apiMiddleware`, a `startSession`/`endSession`/`acceptInvite`
// wystawiają i gaszą sesję na tokenach BE.
//
// Po S6 zostały tu zaproszenia trenera i oba stoją na kontrakcie:
// wystawianie (`createInvite`, `POST /v1/invites`) i podgląd (`previewInvite`,
// `GET /v1/invites/{token}`). Przyjmowanie zaproszenia na Drizzle, odczyty
// użytkowników (`users.ts`) i hasła (`password.ts`) zniknęły w tym samym
// segmencie razem z bazą — robi to BE.
//
// Dołączyła rejestracja samoobsługowa trenera (`registration.ts`): zgłoszenie adresu
// (`requestRegistration`) i podgląd linku (`previewRegistration`). Dokończenie —
// `completeRegistration` — mieszka w `api/auth-session.ts` obok `acceptInvite`, bo zakłada
// sesję. Odmowy mapuje `odmowaRejestracji` z `registration.ts`; `auth-session.ts` bierze ją
// ścieżką wprost (`~/lib/auth/registration`), więc fasada jej nie powtarza.

// Re-export the full auth surface so callers can do `import { ... } from "~/lib/auth"`
// without picking deep paths. Keep the surface tight; only re-export what consumers
// outside the auth module legitimately use.
export {
  createInvite,
  previewInvite,
  InviteError,
  type CreateInviteInput,
  type InviteCreatedResponse,
  type InvitePreviewResponse,
} from "./invite";
export {
  requestRegistration,
  previewRegistration,
  RegistrationError,
  type RegistrationPreviewResponse,
} from "./registration";
