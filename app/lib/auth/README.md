# app/lib/auth/ — zaproszenia i rejestracja trenera

**Sesje i hasła stąd wyprowadziły się** do [`../api/`](../api/README.md) w kroku 2 Etapu 2:
tożsamość niesie ciastko `__Host-kth_api` z tokenami BE, a `session.ts`, `cookie.ts` oraz
pułapka z dwiema funkcjami `clearSessionCookie` o tej samej nazwie zniknęły razem ze starą
sesją bazodanową. Pilnuje tego bramka `app/routes/no-stara-sesja.test.ts`.

**Po segmencie S6 (05.09.2026) katalog stoi w całości na kontrakcie** i ma dwa tematy.
Pierwszy: zaproszenia trenera — wystawianie (`createInvite`, `POST /v1/invites`) i podgląd
(`previewInvite`, `GET /v1/invites/{token}`). Drugi, od 2026-10-03: **rejestracja samoobsługowa
trenera** — zgłoszenie adresu (`requestRegistration`, `POST /v1/registrations`) i podgląd linku
z maila (`previewRegistration`, `GET /v1/registrations/{token}`); trzeci krok, dokończenie
(`completeRegistration`), zakłada sesję, więc mieszka w [`../api/`](../api/README.md)
(`auth-session.ts`) obok `acceptInvite`. W S6 zniknęły stąd: przyjmowanie
zaproszenia na Drizzle (`consumeInvite`, `hashToken`, `findInviteByToken` — konto zakłada BE
jednym `POST /v1/invites/{token}/accept`), odczyty użytkowników (`users.ts`) i hasła
(`password.ts` — po skasowaniu `scripts/seed.ts` nie miały już żadnego konsumenta).
Importuj przez `index.ts` — z jednym celowym wyjątkiem: `odmowaRejestracji` (woła ją
`app/lib/api/auth-session.ts`) i typ `RegistrationRefusal` są dostępne wyłącznie pod
`~/lib/auth/registration`. Fasada wystawia `requestRegistration`, `previewRegistration`,
`RegistrationError` i typ `RegistrationPreviewResponse`.

| Plik | Rola / kluczowe eksporty |
|---|---|
| `index.ts` | Fasada re-eksportów nad `invite.ts` i `registration.ts` — nic więcej. Powtarza tylko to, czego legalnie używają konsumenci spoza modułu (komentarz w pliku), więc `odmowaRejestracji` i `RegistrationRefusal` zostają poza nią. |
| `invite.ts` | **W całości na kontrakcie.** `createInvite(api, { displayName, email, onboardingForm })` → `InviteCreatedResponse` (`token`, `url`, `expiresAt`) — jedno `POST /v1/invites`; zaproszenie i opcjonalny formularz startowy (1–12 ćwiczeń + notatka) powstają **atomowo po stronie BE**, więc dawna transakcja `createInviteWithOnboarding` zniknęła bez zamiennika, tak jak generowanie i haszowanie tokenu (robi BE; surowy token opuszcza serwer wyłącznie w tej odpowiedzi). Ciało składane jawnie pole po polu, bez `trainerId` (wynika z tokenu) i bez `replacesTraineeId` (odnowienie dostępu — żadna trasa FE go dziś nie wystawia). Bez kwoty miesięcznej — `monthlyAmountGrosze` wyszło z kontraktu razem z płatnościami (ADR-0037 po stronie BE), a `forbidNonWhitelisted` czyni z dosłania go `400`, nie ciche zignorowanie. `InviteError` (`userMessage` z koperty BE) wąsko: `404` (ćwiczenie z szablonu spoza biblioteki albo zarchiwizowane — BE sprawdza to PRZED wstawieniem czegokolwiek; komunikat BE jest ogólny: „Nie znaleziono zasobu."), `409` (`ONBOARDING_FORM_ALREADY_PENDING`), `400`. **Uwaga:** `url` z odpowiedzi to `{APP_PUBLIC_URL}/join/{token}`, a FE przyjmuje zaproszenia pod `/zaproszenie/:token` — trasa `/trener/podopieczni` składa odnośnik z `token` (luka L S2-1). `previewInvite(api, token)` → `InvitePreviewResponse | null` — `GET /v1/invites/{token}` po SUROWYM tokenie z URL-a; biegnie **bez tokenu dostępowego** — tak samo jak oba kroki z `registration.ts` niżej — bo ekran zaproszenia wita po imieniu kogoś, kto konta jeszcze nie ma. `| null` niesie regułę D3 (`404` łapie `orNull`): BE oddaje jeden kod dla zaproszenia nieistniejącego, zużytego i wygasłego, więc rozróżnienia nie ma czym zrobić — trasa zamienia `null` na jedno `404`. Przeniesione tu z trasy w S6; wcześniej `zaproszenie.$token.tsx` wołało SDK wprost, co dziś łapie bramka `app/routes/no-direct-api.test.ts`. Test: `invite.test.ts` (podstawiony klient, bez bazy). |
| `registration.ts` | **Rejestracja samoobsługowa trenera na kontrakcie** — dwa pierwsze kroki z trzech. `requestRegistration(api, email)` (`POST /v1/registrations`; `202` — link wychodzi mailem) i `previewRegistration(api, token)` → `RegistrationPreviewResponse \| null` (`GET /v1/registrations/{token}`: adres z linku i `requiredConsents` — zgody do zaakceptowania, każda z `key`, `versionNumber` i `title`). `\| null` niesie regułę D3: BE oddaje jeden `404` dla linku nieistniejącego, zużytego i wygasłego. **`RegistrationError`** (`refusal: RegistrationRefusal` + `userMessage`) to jedyny typ odmowy dla obu kroków, zgłoszenia i dokończenia — żeby oba mówiły do formularza tym samym językiem; mapuje go **`odmowaRejestracji(e, krok)`**: kod BE → odmowa, a dla wszystkiego, co ma zostać awarią (granica błędu), `null`. Komunikaty WŁASNE, nie z BE — ten sam powód co przy logowaniu: treść z drugiej strony mogłaby się kiedyś zmienić w wyrocznię. Krok (`"zgloszenie"` albo `"dokonczenie"`) rozstrzyga wyłącznie `VALIDATION_FAILED` — zły adres albo złe pola; cztery kody zgód (`CONSENT_VERSION_OUTDATED`, `REQUIRED_CONSENTS_MISSING`, `CONSENT_DEFINITION_NOT_FOUND`, `CONSENT_VERSION_NOT_FOUND`) składają się w jedną odmowę `consents-changed`; `TOO_MANY_LINK_REQUESTS` daje `too-many-links`, a każde inne `429` (po statusie, nie po kodzie) — `rate-limited` z tekstem `komunikatLimitu`. Z podglądu linku odmową wracają `409 EMAIL_ALREADY_TAKEN` (adres tymczasem dostał konto), `409 REGISTRATION_CLOSED` (wyłącznik `REGISTRATION_OPEN` w BE — na każdej z trzech tras, przed walidacją) i `429`; cała reszta leci dalej jako `ApiError`. Test: `registration.test.ts` (podstawiony klient, bez bazy). |

Uwaga: cookie `__Host-` wymaga `Secure` — w dev działa przez wyjątek dla
`localhost`; testy w LAN po HTTP nie zadziałają (patrz root `README.md`).

---
Konwencja i zasady aktualizacji dokumentacji: [`../../../CLAUDE.md`](../../../CLAUDE.md).

## Driver

- **Kształt:** cienka warstwa nad kontraktem zaproszeń i rejestracji trenera. Hasła, sesje
  i limit prób logowania **są po stronie backendu** — tutaj ich nie ma i nie może być
- **Reguła nadrzędna:** to jest wystawianie i podgląd zaproszeń oraz zgłoszenie i podgląd
  rejestracji, nie uwierzytelnianie. Sesja mieszka w `app/lib/api` — także ta, którą zakłada
  dokończenie rejestracji (`completeRegistration`)
- **Ostatnia rewizja:** 2026-10-03

