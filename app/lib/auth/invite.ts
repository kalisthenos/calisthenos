import { invitesControllerCreate, invitesControllerPreview } from "@kalisthenos/api-client";
import type { InviteCreatedResponse, InvitePreviewResponse } from "@kalisthenos/api-client";
import { orNull } from "~/lib/api/client";
import type { Api } from "~/lib/api/client";
import { ApiError } from "~/lib/api/errors";

/**
 * Zaproszenia trenera — w całości na kontrakcie BE.
 *
 * Do S6 mieszkała tu druga połowa: przyjmowanie zaproszenia na Drizzle
 * (`consumeInvite` z `SELECT FOR UPDATE`, `hashToken`, `findInviteByToken`).
 * Zniknęła bez zamiennika po tej stronie — konto zakłada BE jednym
 * `POST /v1/invites/{token}/accept` (`acceptInvite` w `api/auth-session.ts`),
 * a skrót tokenu liczy u siebie. FE nie dotyka już ani haseł, ani haszy.
 */

export type { InviteCreatedResponse, InvitePreviewResponse } from "@kalisthenos/api-client";

/**
 * Własny typ błędu, bo trasa pokazuje `userMessage` w modalu zaproszenia.
 * Źródłem `userMessage` jest `message` z koperty BE.
 */
export class InviteError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}

export interface CreateInviteInput {
  displayName: string;
  email: string | null;
  /** Szablon formularza startowego; `null` = zaproszenie bez formularza. */
  onboardingForm: { exerciseIds: string[]; note: string | null } | null;
}

/**
 * Zaproszenie + opcjonalny formularz startowy JEDNYM żądaniem (`POST /v1/invites`).
 * Atomowość, która do integracji siedziała tu w `db.transaction` (dawne
 * `createInviteWithOnboarding`), jest teraz sprawą BE: „zaproszenie i formularz
 * powstają atomowo" (`docs/04` §Zaproszenia), więc nigdy nie powstaje odnośnik do
 * zaproszenia, któremu formularz nie doszedł. Token generuje i haszuje BE —
 * w odpowiedzi jest jedyna chwila, w której surowy token opuszcza serwer.
 *
 * Ciało składane jawnie pole po polu: BE odrzuca pola spoza DTO, a `trainerId`
 * wynika z tokenu. Bez `replacesTraineeId` (odnowienie dostępu) — żadna trasa
 * FE dziś tego nie wystawia. Bez kwoty miesięcznej: `monthlyAmountGrosze` wyszło
 * z kontraktu razem z płatnościami (ADR-0037 po stronie BE), a `forbidNonWhitelisted`
 * sprawia, że dosłanie go dziś daje `400`, nie ciche zignorowanie.
 *
 * Wąsko, do modalu: `404` (ćwiczenie z szablonu spoza biblioteki albo
 * zarchiwizowane — BE sprawdza to PRZED wstawieniem czegokolwiek), `409`
 * (`ONBOARDING_FORM_ALREADY_PENDING` przy odnowieniu) i `400` (walidacja BE
 * ostrzejsza niż Zod). Reszta leci dalej — awaria BE ma zostać awarią.
 */
export async function createInvite(
  api: Api,
  input: CreateInviteInput,
): Promise<InviteCreatedResponse> {
  try {
    const { data } = await invitesControllerCreate({
      client: api,
      body: {
        displayName: input.displayName,
        email: input.email,
        onboardingForm:
          input.onboardingForm == null
            ? null
            : { exerciseIds: input.onboardingForm.exerciseIds, note: input.onboardingForm.note },
      },
      throwOnError: true,
    });
    return data;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 409)) {
      throw new InviteError(e.code, e.message);
    }
    throw e;
  }
}

/**
 * Podgląd zaproszenia po SUROWYM tokenie z URL-a (`GET /v1/invites/{token}`) —
 * ekran rejestracji wita po imieniu i podpowiada adres, zanim ktokolwiek jest
 * zalogowany. Jedyne wejście do kontraktu, które biegnie bez tokenu dostępowego.
 *
 * `| null` w sygnaturze niesie regułę D3: `404` łapie `orNull`. BE oddaje jeden
 * kod dla zaproszenia nieistniejącego, zużytego i wygasłego, więc rozróżnienia
 * nie ma czym zrobić — i dobrze, bo sonda odróżniająca „zły token" od „dobry,
 * ale już użyty" mówiłaby więcej, niż powinna. Trasa zamienia `null` na `404`.
 * Awaria BE zostaje awarią i leci wyżej.
 */
export async function previewInvite(
  api: Api,
  token: string,
): Promise<InvitePreviewResponse | null> {
  const preview = await orNull(
    invitesControllerPreview({ client: api, path: { token }, throwOnError: true }),
  );
  return preview?.data ?? null;
}
