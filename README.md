# kalisthenos

Polish-language web app for calisthenics trainer ↔ trainee collaboration. Ships
trainer-facing exercise library, plan editor with versioning, workout logging
with per-set videos, body-photo gallery, and a PWA-installable trainee UI.

Spec: `docs/superpowers/specs/2026-05-23-kalisthenos-fullstack-v1-design.md`

---

## Quick start (local dev)

**FE nie ma własnej bazy.** Wszystkie dane biorą się z backendu
(`calisthenos-be`), więc do pracy potrzebny jest działający BE pod adresem
z `API_URL` — to on trzyma Postgresa, Redisa, R2 i migracje.
Required: Node 22+, npm, uruchomiony `calisthenos-be`.

### One-time setup

```bash
# 1) Postaw backend (osobne repozytorium, własne README).
#    FE zajmuje port 3000, więc uruchom BE na 3001.

# 2) Install JS deps.
npm install

# 3) Copy the env template and fill in real values.
cp .env.example .env
# .env wskazuje już na http://localhost:3001 (API_URL). Konto trenera zakłada
# seeder BE — SEED_TRAINER_EMAIL / SEED_TRAINER_PASSWORD w .env służą tylko
# pętli zrzutów ekranu (`npm run shots`), która się nimi loguje.

# 4) Pakiet klienta jest prywatny (GitHub Packages), więc `npm install`
#    wymaga tokenu z `read:packages` — patrz `.npmrc` i GITHUB_TOKEN.
```

Migracji ani seedowania po tej stronie nie ma: schemat i dane należą do BE.
Biblioteka ćwiczeń startuje pusta — kategorie i ćwiczenia dodaje się w UI.

### Run the app

```bash
npm run dev
```

→ Open **http://localhost:3000** and log in.

That's it. HMR is live; saves to `app/**/*.tsx` reload automatically.

### Screenshot-loop (dev/AI)

Wizualna pętla zwrotna do iteracji nad UI. Wymaga działającego BE i dev
servera. Jednorazowo pobierz przeglądarkę Playwright: `npx playwright install chromium`.
`npm run shots` zrzuca cały manifest tras; `npm run shots -- /trener/biblioteka`
zrzuca pojedynczą trasę na desktop+mobile. PNG-i lądują w `screenshots/`
(gitignore). Logowanie używa `SEED_TRAINER_EMAIL` / `SEED_TRAINER_PASSWORD` z `.env`.

### Stop / reset

Po tej stronie nie ma czego zatrzymywać ani czyścić: `docker-compose.yml`
(lokalny Postgres) zniknął w segmencie S6 razem z bazą. Reset danych robi się
w `calisthenos-be`.

> **Cookie note**: sessions use the `__Host-` prefix and always set `Secure`.
> Browsers grant a localhost exception so `http://localhost:3000` works in dev.
> LAN testing on a phone over `http://192.168.x.y` will *not* — use ngrok (or
> Cloudflare Tunnel) to get an HTTPS URL.

---

## PWA install

The app is installable via any browser's "Add to Home Screen" / "Install" prompt
once you've visited it over HTTPS (or via the localhost exception). Static assets
are cached by a service worker; signed file URLs and SSR routes always hit the
network. Manifest at `/manifest.webmanifest`, icon at `/icon.svg`.

For production icons, generate 192×192 and 512×512 PNGs and add them to
`public/` + the manifest. The included SVG icon is acceptable for most browsers
but Apple touch icons are best as PNG.

---

## Production deploy (Railway)

`railway.toml` ships preconfigured for Railway. The `Dockerfile` is multi-stage
and runs the server as the unprivileged `node` user. Railway picks it up
automatically.

**Usługa FE nie potrzebuje już ani Postgresa, ani wolumenu** — po segmencie S6
dane i pliki należą do `calisthenos-be`. Oba zniknęły z `railway.toml`; wolumen
z bajtami sprzed migracji trzeba przenieść albo skasować ręcznie przy cutoverze.

Required env vars on Railway:

| Variable | Value |
|---|---|
| `BASE_URL` | `https://<your-railway-domain>` |
| `NODE_ENV` | `production` |
| `API_URL` | backend URL (Railway private network, if available) |
| `API_PUBLIC_URL` | public backend URL, for `<img>`/`<video>` `src`; defaults to `API_URL` |
| `GITHUB_TOKEN` | build-time only — `read:packages` (private `@kalisthenos/api-client`) |

> **Healthcheck:** `healthcheckPath` points at `/healthz` — a resource route
> that returns a bare `200`. Do **not** point it back at `/`: the index route
> always redirects, and Railway treats any non-200 (302 included) as
> `failed with service unavailable`, so the deploy never goes live even though
> the container is serving fine. Guarded by `app/routes/healthz.test.ts`.

> **Migracje są sprawą BE.** Po segmencie S6 ta usługa nie ma schematu ani
> narzędzi migracyjnych — `db:migrate`/`db:seed` zniknęły z `package.json`
> razem z Drizzle. Kolejność przy wdrożeniu jest teraz odwrotna: najpierw
> migracje i deploy `calisthenos-be`, potem FE, bo to FE zależy od kontraktu.

---

## Integracja Google (opcjonalna)

Trener może połączyć konto Google Calendar — konsultacje są wtedy automatycznie
synchronizowane jako zdarzenia z Meet linkiem. Aplikacja działa w pełni bez tej
integracji — konfiguracja leży w całości po stronie backendu, frontend niczego
nie sprawdza i nie ukrywa przycisku „Połącz z Google"; wyłączoną integrację
poznasz dopiero po kliknięciu, komunikatem z backendu.

Integracja jest konfigurowana **w całości po stronie BE** — projekt w Google Cloud Console,
szyfrowanie tokenów i zmienne `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`/
`GOOGLE_TOKEN_ENC_KEY` oraz `CALENDAR_COOKIE_DOMAIN` opisuje `calisthenos-be/README.md`
i `calisthenos-be/.env.example`; FE nie zna żadnego sekretu Google i nie przechowuje ani nie
szyfruje tokenów — jedyne wejście FE do tego obszaru to `app/lib/calendar.ts`, wołające kontrakt
`GET/POST/DELETE /v1/calendar/connection*`.

---

## Płatności — nie ma ich i nie wracają

**System nie zna płatności trener ↔ podopieczny.** Nie „jeszcze nie zna" — nie zna.

Integracja ze Stripe Connect (subskrypcje, Checkout, Customer Portal, webhooki, ekran
aktywacji `/podopieczny/aktywuj` i bramka dostępu) zniknęła z FE w segmencie S6 integracji
z backendem — decyzja D1 specu
[`docs/superpowers/specs/2026-08-29-integracja-fe-be-design.md`](docs/superpowers/specs/2026-08-29-integracja-fe-be-design.md).
Stała za tym ADR-0024 po stronie BE, który zdjął kontekst płatności, **nie rozstrzygając
produktu** — model był nierozstrzygnięty, więc backend świadomie go nie przejął.

Rozstrzygnięcie zapadło później, w **ADR-0037**: płatności między trenerem a podopiecznym nie
są częścią produktu. Padł razem z nim ostatni ślad — opcjonalna „kwota miesięczna"
w formularzu zaproszenia (`monthlyAmountGrosze` w `POST /v1/invites`), która trafiała do BE
i nie miała tam odbiorcy. Rozliczenie, jeśli para je prowadzi, idzie poza aplikacją.

Powrót płatności to osobny projekt z własnym specem **i własnym ADR-em** — nie odtworzenie
tamtego pola.

---

## Useful commands

```bash
npm run dev           # vite + react-router dev server (HMR)
npm run build         # production build → ./build/
npm run start         # serve production build (used by Docker/Railway)
npm run typecheck     # tsc --noEmit
npm run lint          # biome lint
npm run format        # biome format --write
npm test              # vitest unit tests (watch)
npm run test:unit     # vitest run app/
npm run e2e           # playwright E2E — needs the app AND the backend running
npm run shots         # screenshot-loop: zrzuty realnych tras (desktop+mobile) do screenshots/
```

Komendy `db:*` zniknęły w segmencie S6 razem z bazą — migracje, seed i podgląd
danych są dziś w `calisthenos-be`.

---

## Security posture (V1)

Po segmencie S6 większość tej listy egzekwuje **backend** — FE trzyma już tylko
ciastko i nagłówki. Co gdzie stoi:

- Session cookies (FE): `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax` —
  ciastko `__Host-kth_api` niesie parę tokenów BE, nie identyfikator wiersza.
  Odświeżanie jest zserializowane raz na żądanie (`app/lib/api/refresh.ts`).
- HTTP headers (FE): CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS (in prod).
- Hasła, tokeny zaproszeń, limit prób logowania, rotacja i wygaszanie sesji (BE):
  argon2id, skrót tokenu w bazie, TTL i jednorazowość — patrz `calisthenos-be`.
- Pliki (BE): podpisane odnośniki HMAC związane z tenantem (ADR-0023),
  weryfikacja typu po ZAWARTOŚCI przy wysyłce dwufazowej.
- Zakres tenanta (BE): niesie go token dostępowy; cudzy zasób jest
  nieodróżnialny od nieistniejącego (**404**, nie 403).

---

## Project structure

```
app/                  # React Router v7 framework-mode source
  root.tsx
  routes.ts
  routes/             # file-based routes
  components/         # shared UI (PhotoCard…)
  lib/
    api/              # klient kontraktu BE, sesja na tokenach, middleware rotacji
    auth/             # zaproszenia trenera (wystawianie i podgląd przez kontrakt)
    body-photos.ts
    calendar.ts
    file-uploads.ts
    plans.ts
    plan-types.ts
    workouts.ts
    exercises.ts
    authz.ts
    env.ts
    format.ts
  styles/tokens.css
scripts/
  shots.ts            # pętla zrzutów ekranu (Playwright)
public/
  icon.svg
  manifest.webmanifest
prototype/            # original React+Babel single-page prototype (reference)
docs/superpowers/     # spec + plans
tests/                # miejsce na Playwright e2e (tests/e2e, jeszcze puste)
Dockerfile            # multi-stage; non-root runtime (Railway uses this)
railway.toml
```
