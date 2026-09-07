# app/lib/auth/ — zaproszenia trenera

**Sesje i hasła stąd wyprowadziły się** do [`../api/`](../api/README.md) w kroku 2 Etapu 2:
tożsamość niesie ciastko `__Host-kth_api` z tokenami BE, a `session.ts`, `cookie.ts` oraz
pułapka z dwiema funkcjami `clearSessionCookie` o tej samej nazwie zniknęły razem ze starą
sesją bazodanową. Pilnuje tego bramka `app/routes/no-stara-sesja.test.ts`.

**Po segmencie S6 (05.09.2026) katalog stoi w całości na kontrakcie** i ma już tylko jeden
temat: zaproszenia trenera — wystawianie (`createInvite`, `POST /v1/invites`) i podgląd
(`previewInvite`, `GET /v1/invites/{token}`). Zniknęły w tym samym segmencie: przyjmowanie
zaproszenia na Drizzle (`consumeInvite`, `hashToken`, `findInviteByToken` — konto zakłada BE
jednym `POST /v1/invites/{token}/accept`), odczyty użytkowników (`users.ts`) i hasła
(`password.ts` — po skasowaniu `scripts/seed.ts` nie miały już żadnego konsumenta).
Importuj przez `index.ts`.

| Plik | Rola / kluczowe eksporty |
|---|---|
| `index.ts` | Fasada re-eksportów nad `invite.ts` — nic więcej. |
| `invite.ts` | **W całości na kontrakcie.** `createInvite(api, { displayName, email, monthlyAmountGrosze, onboardingForm })` → `InviteCreatedResponse` (`token`, `url`, `expiresAt`) — jedno `POST /v1/invites`; zaproszenie i opcjonalny formularz startowy (1–12 ćwiczeń + notatka) powstają **atomowo po stronie BE**, więc dawna transakcja `createInviteWithOnboarding` zniknęła bez zamiennika, tak jak generowanie i haszowanie tokenu (robi BE; surowy token opuszcza serwer wyłącznie w tej odpowiedzi). Ciało składane jawnie pole po polu, bez `trainerId` (wynika z tokenu) i bez `replacesTraineeId` (odnowienie dostępu — żadna trasa FE go dziś nie wystawia). `monthlyAmountGrosze` to zapis ustalonej kwoty, nie płatność: po S6 nic w FE nie pobiera pieniędzy (D1 specu), a kwotę księguje BE zdarzeniem `TraineeJoined`. `InviteError` (`userMessage` z koperty BE) wąsko: `404` (ćwiczenie z szablonu spoza biblioteki albo zarchiwizowane — BE sprawdza to PRZED wstawieniem czegokolwiek; komunikat BE jest ogólny: „Nie znaleziono zasobu."), `409` (`ONBOARDING_FORM_ALREADY_PENDING`), `400`. **Uwaga:** `url` z odpowiedzi to `{APP_PUBLIC_URL}/join/{token}`, a FE przyjmuje zaproszenia pod `/zaproszenie/:token` — trasa `/trener/podopieczni` składa odnośnik z `token` (luka L S2-1). `previewInvite(api, token)` → `InvitePreviewResponse | null` — `GET /v1/invites/{token}` po SUROWYM tokenie z URL-a; jedyne wejście do kontraktu biegnące **bez tokenu dostępowego**, bo ekran rejestracji wita po imieniu kogoś, kto konta jeszcze nie ma. `| null` niesie regułę D3 (`404` łapie `orNull`): BE oddaje jeden kod dla zaproszenia nieistniejącego, zużytego i wygasłego, więc rozróżnienia nie ma czym zrobić — trasa zamienia `null` na jedno `404`. Przeniesione tu z trasy w S6; wcześniej `zaproszenie.$token.tsx` wołało SDK wprost, co dziś łapie bramka `app/routes/no-direct-api.test.ts`. Test: `invite.test.ts` (podstawiony klient, bez bazy). |

Uwaga: cookie `__Host-` wymaga `Secure` — w dev działa przez wyjątek dla
`localhost`; testy w LAN po HTTP nie zadziałają (patrz root `README.md`).

---
Konwencja i zasady aktualizacji dokumentacji: [`../../../CLAUDE.md`](../../../CLAUDE.md).

## Driver

- **Kształt:** cienka warstwa nad kontraktem zaproszeń. Hasła, sesje i limit prób logowania
  **są po stronie backendu** — tutaj ich nie ma i nie może być
- **Reguła nadrzędna:** to jest wystawianie i podgląd zaproszeń, nie uwierzytelnianie. Sesja
  mieszka w `app/lib/api`
- **Ostatnia rewizja:** 2026-09-06

