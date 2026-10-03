import {
  registrationsControllerPreview,
  registrationsControllerRequest,
} from "@kalisthenos/api-client";
import type { RegistrationPreviewResponse } from "@kalisthenos/api-client";
import { type Api, orNull } from "~/lib/api/client";
import { ApiError, komunikatLimitu } from "~/lib/api/errors";

/**
 * Rejestracja samoobsługowa trenera — dwa pierwsze kroki na kontrakcie BE: zgłoszenie adresu
 * (`requestRegistration`) i podgląd linku (`previewRegistration`). Trzeci, dokończenie, mieszka
 * w `api/auth-session.ts` obok `acceptInvite`, bo zakłada sesję; odmowy mapuje stąd
 * (`odmowaRejestracji`), żeby oba miejsca mówiły do formularza tym samym językiem.
 */

export type { RegistrationPreviewResponse } from "@kalisthenos/api-client";

export type RegistrationRefusal =
  | "invalid-email"
  | "disposable-domain"
  | "email-taken"
  | "too-many-links"
  | "rate-limited"
  | "link-invalid"
  | "consents-changed"
  | "invalid-input"
  | "registration-closed";

/** Odmowa, którą trasa pokazuje w formularzu — wzorem `AuthError` i `InviteError`. */
export class RegistrationError extends Error {
  constructor(
    readonly refusal: RegistrationRefusal,
    readonly userMessage: string,
  ) {
    super(refusal);
    this.name = "RegistrationError";
  }
}

const ZGODY_ZMIENIONE = "Dokument się zmienił — zapoznaj się z aktualną wersją.";

/**
 * Odpowiedź BE → odmowa dla formularza; `null` dla wszystkiego, co ma zostać awarią (granica
 * błędu). Komunikaty WŁASNE, nie z BE — ten sam powód co przy logowaniu: treść z drugiej strony
 * mogłaby się kiedyś zmienić w wyrocznię.
 */
export function odmowaRejestracji(
  e: unknown,
  krok: "zgloszenie" | "dokonczenie",
): RegistrationError | null {
  if (!(e instanceof ApiError)) return null;
  switch (e.code) {
    case "INVALID_EMAIL":
      return new RegistrationError("invalid-email", "Podaj poprawny adres e-mail.");
    case "DISPOSABLE_EMAIL_DOMAIN":
      return new RegistrationError(
        "disposable-domain",
        "Adresy tymczasowych skrzynek nie są obsługiwane — podaj inny adres.",
      );
    case "EMAIL_ALREADY_TAKEN":
      return new RegistrationError("email-taken", "Ten adres ma już konto. Zaloguj się.");
    case "REGISTRATION_CLOSED":
      // Wyłącznik `REGISTRATION_OPEN` w BE (spec, U6) — na każdej z trzech tras, przed walidacją.
      return new RegistrationError(
        "registration-closed",
        "Rejestracja kont trenerów jest chwilowo zamknięta.",
      );
    case "TOO_MANY_LINK_REQUESTS":
      return new RegistrationError(
        "too-many-links",
        "Wysłaliśmy już kilka wiadomości na ten adres — sprawdź skrzynkę (także folder spam) albo spróbuj za godzinę.",
      );
    case "REGISTRATION_LINK_NOT_FOUND":
      return new RegistrationError("link-invalid", "Link jest nieważny albo wygasł.");
    case "CONSENT_VERSION_OUTDATED":
    case "REQUIRED_CONSENTS_MISSING":
    case "CONSENT_DEFINITION_NOT_FOUND":
    case "CONSENT_VERSION_NOT_FOUND":
      return new RegistrationError("consents-changed", ZGODY_ZMIENIONE);
    case "INVALID_DISPLAY_NAME":
      return new RegistrationError(
        "invalid-input",
        "Nazwa wyświetlana musi mieć od 1 do 200 znaków.",
      );
    case "PASSWORD_TOO_SHORT":
      return new RegistrationError("invalid-input", "Hasło musi mieć co najmniej 8 znaków.");
    case "VALIDATION_FAILED":
      return krok === "zgloszenie"
        ? new RegistrationError("invalid-email", "Podaj poprawny adres e-mail.")
        : new RegistrationError("invalid-input", "Sprawdź pola formularza.");
  }
  if (e.status === 429) return new RegistrationError("rate-limited", komunikatLimitu(e.retryAfter));
  return null;
}

/** Krok 1 — `POST /v1/registrations`. `202`: link wyjdzie mailem. */
export async function requestRegistration(api: Api, email: string): Promise<void> {
  try {
    await registrationsControllerRequest({ client: api, body: { email }, throwOnError: true });
  } catch (e) {
    throw odmowaRejestracji(e, "zgloszenie") ?? e;
  }
}

/**
 * Podgląd linku — `GET /v1/registrations/{token}`. `null` dla linku nieistniejącego, zamkniętego
 * i wygasłego (jedna odpowiedź BE, reguła D3); `409` — adres tymczasem dostał konto.
 */
export async function previewRegistration(
  api: Api,
  token: string,
): Promise<RegistrationPreviewResponse | null> {
  try {
    const wynik = await orNull(
      registrationsControllerPreview({ client: api, path: { token }, throwOnError: true }),
    );
    return wynik?.data ?? null;
  } catch (e) {
    throw odmowaRejestracji(e, "dokonczenie") ?? e;
  }
}
