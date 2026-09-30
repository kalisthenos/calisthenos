import {
  bodyPhotosControllerCreate,
  bodyPhotosControllerMine,
  bodyPhotosControllerRemove,
  traineeBodyPhotosControllerForTrainee,
} from "@kalisthenos/api-client";
import type { BodyPhotoDto, BodyPhotoListPage } from "@kalisthenos/api-client";
import { publicFileUrl } from "~/lib/api/client";
import type { Api } from "~/lib/api/client";
import { ApiError } from "~/lib/api/errors";
import { uploadBodyPhoto } from "~/lib/file-uploads";

/**
 * Typy zdjęcia biorą się z kontraktu, nie z własnej kopii — `BodyPhotoDto` niesie
 * `photoUrl` zamiast dawnej pary `fileId` + `mimeType`, bo odnośnik podpisuje BE
 * (ADR-0023), a FE tylko wstawia go do `<img>`.
 */
export type { BodyPhotoDto, BodyPhotoListPage } from "@kalisthenos/api-client";

/** Ujęcie zdjęcia. Ta sama trójka co dawny enum schematu, tyle że z kontraktu. */
export type BodyPhotoView = BodyPhotoDto["view"];

export class BodyPhotoError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}

/**
 * Wąsko, po statusie: `400` (data spoza zakresu, zły kształt ładunku), `404`
 * (plik nieistniejący albo cudzy — §2 `docs/04` rozciąga „cudzy = nieistniejący"
 * na identyfikatory w ciele) i `409` (niezmiennik domenowy). Rozgałęzienia po
 * `error.code` tu nie ma, bo dla ZAPISU kontrakt nie deklaruje ANI JEDNEGO
 * kodu znaczącego dla logiki — same rodziny statusów; dopisanie słownika kodów
 * „na zapas" udawałoby wiedzę, której nie mamy. Jedyny taki kod w tym module
 * dotyczy odczytu galerii trenera (`BODY_PHOTOS_NOT_SHARED`, niżej). Reszta leci
 * `ApiError`-em: awaria BE ma zostać awarią, nie komunikatem o zdjęciu.
 */
function toBodyPhotoError(e: unknown): never {
  if (e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 409)) {
    throw new BodyPhotoError(e.code, e.message);
  }
  throw e;
}

// ============================================================
// Odczyt
// ============================================================

/** Nazwy z zakładkowalnego adresu listy (`?sort=newest`), nie z kontraktu. */
export type BodyPhotoSort = "newest" | "oldest";

/**
 * Kontrakt nazywa sortowania inaczej niż adres listy, więc — jak w `exercises.ts`,
 * a inaczej niż w planach — jest słownik. Adres zostaje bez zmian: zakładka
 * `?sort=oldest` zapisana przed integracją ma dalej działać.
 */
const CONTRACT_SORT: Record<BodyPhotoSort, "taken_on_desc" | "taken_on_asc"> = {
  newest: "taken_on_desc",
  oldest: "taken_on_asc",
};

/**
 * `photoUrl` z kontraktu jest ŚCIEŻKĄ (`/v1/files/…?exp=…&sig=…`), nie adresem —
 * origin dokłada MODUŁ, nie trasa i nie komponent (ten sam szew co `demoUrl`
 * w `exercises.ts` i `videoUrl` w `workouts.ts`). Wstawiona wprost w `src`
 * rozwiązałaby się względem origin FE, gdzie takiej trasy już nie ma — i to bez
 * żadnego błędu, bo puste `<img>` wygląda jak brak zdjęcia.
 */
function withPublicPhotoUrls(items: BodyPhotoDto[]): BodyPhotoDto[] {
  return items.map((photo) => ({ ...photo, photoUrl: publicFileUrl(photo.photoUrl) }));
}

/**
 * Własna galeria podopiecznego — cała strona z kontraktu (60/stronę, `total`
 * i `totalPages` w odpowiedzi, stronę spoza zakresu przycina BE), więc
 * `countBodyPhotosForTrainee` znika bez zamiennika, a licznik nawigacji niesie
 * `TraineeNavView.bodyPhotos` z `views.ts`.
 */
export async function listMyBodyPhotos(
  api: Api,
  opts: { page: number; sort: BodyPhotoSort },
): Promise<BodyPhotoListPage> {
  const { data } = await bodyPhotosControllerMine({
    client: api,
    query: { page: opts.page, sort: CONTRACT_SORT[opts.sort] },
    throwOnError: true,
  });
  return { ...data, items: withPublicPhotoUrls(data.items) };
}

interface PhotoPage {
  items: BodyPhotoDto[];
  totalPages: number;
}

/**
 * Galeria podopiecznego oglądana przez trenera. Odpowiedź niesie jeszcze `pairs`
 * („przed / po" policzone po tamtej stronie) — **świadomie ich nie czytamy**:
 * ekran pokazuje kafelek także dla ujęcia z JEDNYM zdjęciem i dla ujęcia bez
 * zdjęć, a takich stanów `pairs` z definicji nie zawiera (para wymaga obu
 * końców). Parowanie liczy więc `getSideBySidePhotoPairs` niżej — dla obu ról
 * tak samo, z jednego kształtu (spec, Zał. A: „to prezentacja, nie dane").
 */
async function traineeBodyPhotoPage(api: Api, traineeId: string, page: number): Promise<PhotoPage> {
  const { data } = await traineeBodyPhotosControllerForTrainee({
    client: api,
    path: { traineeId },
    query: { page, sort: CONTRACT_SORT.newest },
    throwOnError: true,
  });
  return { items: withPublicPhotoUrls(data.items), totalPages: data.totalPages };
}

async function myBodyPhotoPage(api: Api, page: number): Promise<PhotoPage> {
  const strona = await listMyBodyPhotos(api, { page, sort: "newest" });
  return { items: strona.items, totalPages: strona.totalPages };
}

/**
 * Sklejone strony kontraktu w jedną listę, od najnowszego zdjęcia. Potrzebne,
 * bo porównanie „pierwsze vs ostatnie" musi widzieć WSZYSTKIE zdjęcia ujęcia,
 * a kontrakt stronicuje po 60 i nie ma parametru „wszystko" (precedens:
 * `listActiveExercisesForTrainer` w `exercises.ts`). `totalPages` z pierwszej
 * odpowiedzi jest granicą pętli, więc nie może się ona rozbiec; zdjęcie dodane
 * MIĘDZY żądaniami może przesunąć jedną pozycję — dla porównania i siatki to
 * bez znaczenia.
 */
async function gluePages(page: (n: number) => Promise<PhotoPage>): Promise<BodyPhotoDto[]> {
  const first = await page(1);
  const items = [...first.items];
  for (let n = 2; n <= first.totalPages; n += 1) {
    const next = await page(n);
    items.push(...next.items);
  }
  return items;
}

/** Wszystkie własne zdjęcia, od najnowszego — do porównania „przed / po". */
export async function listAllMyBodyPhotos(api: Api): Promise<BodyPhotoDto[]> {
  return await gluePages((n) => myBodyPhotoPage(api, n));
}

/**
 * Galeria podopiecznego u trenera, z flagą udostępnienia nazwaną tak samo jak
 * `bodyPhotoCoverage.shared` w przeglądzie klienta (ADR-0047 BE). `shared: false`
 * nie niesie ANI JEDNEGO zdjęcia — także wtedy, gdy część stron zdążyła przyjść.
 */
export type TraineeBodyPhotos = { shared: true; photos: BodyPhotoDto[] } | { shared: false };

/**
 * Odmowa galerii, gdy zgoda podopiecznego na dane o zdrowiu nie jest w mocy.
 * Kontrakt nie odróżnia braku zgody, zgody nieaktualnej i wycofanej — jeden kod
 * na wszystkie trzy, więc i ekran ich nie rozróżnia.
 */
const BODY_PHOTOS_NOT_SHARED = "BODY_PHOTOS_NOT_SHARED";

/**
 * Wszystkie zdjęcia podopiecznego, od najnowszego. Trener ogląda galerię bez
 * stronicowania (tak było przed integracją), więc ta lista karmi u niego i siatkę,
 * i porównanie — jednym kompletem żądań, nie dwoma.
 *
 * `403 BODY_PHOTOS_NOT_SHARED` to stan ekranu, nie awaria — wraca jako
 * `{ shared: false }`. Wąsko, po KODZIE: ten sam status niesie naruszenie reguły
 * roli (`ACCESS_DENIED`), a cudzy podopieczny to nadal `404` — oba lecą
 * `ApiError`-em. Odmowa na dalszej stronie unieważnia strony już pobrane: zgodę
 * wolno wycofać w trakcie sklejania, a pokazanie ich po wycofaniu byłoby wglądem,
 * którego zgoda już nie daje.
 */
export async function listAllTraineeBodyPhotos(
  api: Api,
  traineeId: string,
): Promise<TraineeBodyPhotos> {
  try {
    return {
      shared: true,
      photos: await gluePages((n) => traineeBodyPhotoPage(api, traineeId, n)),
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && e.code === BODY_PHOTOS_NOT_SHARED) {
      return { shared: false };
    }
    throw e;
  }
}

// ============================================================
// Porównanie „przed / po" — czysta funkcja nad listą
// ============================================================

export interface SideBySidePhoto {
  id: string;
  /** Gotowy adres (origin już dołożony przez `withPublicPhotoUrls`). */
  url: string;
  takenOn: string;
}

export interface SideBySidePhotoPair {
  view: BodyPhotoView;
  first: SideBySidePhoto | null;
  latest: SideBySidePhoto | null;
  /** `false` także wtedy, gdy ujęcie ma dokładnie jedno zdjęcie. */
  hasPair: boolean;
  daysBetween: number | null;
}

const BODY_PHOTO_VIEWS: BodyPhotoView[] = ["front", "side", "back"];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rozstrzygnięcie remisu po `createdAt`: dwa zdjęcia z tego samego dnia miały
 * dotąd kolejność, jaką akurat zwróciła baza. Tu jest deterministyczna, więc
 * porównanie nie „mruga" między żądaniami.
 */
function earlier(a: BodyPhotoDto, b: BodyPhotoDto): boolean {
  return a.takenOn !== b.takenOn ? a.takenOn < b.takenOn : a.createdAt < b.createdAt;
}

function tile(photo: BodyPhotoDto | null): SideBySidePhoto | null {
  return photo == null ? null : { id: photo.id, url: photo.photoUrl, takenOn: photo.takenOn };
}

/**
 * Pierwsze i ostatnie zdjęcie każdego ujęcia — trzy pozycje ZAWSZE, także dla
 * ujęcia bez zdjęć (ekran rysuje wtedy kafelek „brak zdjęć"). Czysta: przeniesiona
 * ze `stats.ts`, gdzie robiła własne zapytanie; kolejności wejścia nie zakłada,
 * bo wybiera skrajne po `takenOn`, nie po pozycji w tablicy.
 */
export function getSideBySidePhotoPairs(photos: BodyPhotoDto[]): SideBySidePhotoPair[] {
  return BODY_PHOTO_VIEWS.map((view) => {
    const ofView = photos.filter((p) => p.view === view);
    const first = ofView.reduce<BodyPhotoDto | null>(
      (acc, p) => (acc == null || earlier(p, acc) ? p : acc),
      null,
    );
    const latest = ofView.reduce<BodyPhotoDto | null>(
      (acc, p) => (acc == null || earlier(acc, p) ? p : acc),
      null,
    );

    if (first == null || latest == null || first.id === latest.id) {
      return { view, first: tile(first), latest: tile(latest), hasPair: false, daysBetween: null };
    }

    return {
      view,
      first: tile(first),
      latest: tile(latest),
      hasPair: true,
      daysBetween: Math.floor((Date.parse(latest.takenOn) - Date.parse(first.takenOn)) / DAY_MS),
    };
  });
}

// ============================================================
// Zapis
// ============================================================

export interface AddBodyPhotoInput {
  file: File;
  view: BodyPhotoView;
  /** `YYYY-MM-DD`. */
  takenOn: string;
  note: string | null;
}

/**
 * Dwie fazy, jak przy demo ćwiczenia: najpierw plik (`POST /v1/files/body-photo`
 * + `confirm`), potem zdjęcie wskazujące na `fileId`. Odmowa PIERWSZEJ fazy leci
 * `UploadError`-em (nic nie powstało, wolno ponowić); odmowa DRUGIEJ zostawia
 * plik bez właściciela, którego po 24 h karencji zabiera zamiatacz BE — dlatego
 * nie ma tu żadnego cofania i nie wraca `UploadCleanupQueue`.
 *
 * Bez `trainerId` i `traineeId`: właściciela zdjęcia wyznacza token, nie ładunek,
 * a pole spoza `CreateBodyPhotoDto` byłoby `400` (`forbidNonWhitelisted`).
 */
export async function addBodyPhoto(api: Api, input: AddBodyPhotoInput): Promise<string> {
  const fileId = await uploadBodyPhoto(api, input.file);
  try {
    const { data } = await bodyPhotosControllerCreate({
      client: api,
      body: {
        fileId,
        view: input.view,
        takenOn: input.takenOn,
        note: input.note,
      },
      throwOnError: true,
    });
    return data.id;
  } catch (e) {
    return toBodyPhotoError(e);
  }
}

/**
 * Kasuje WŁASNE zdjęcie (`DELETE /v1/me/body-photos/{id}`) razem z zawartością
 * pliku — sprzątaniem bajtów zajmuje się BE (ADR-0021), więc nie ma tu ani
 * transakcji, ani kasowania bloba po commicie. Cudze i nieistniejące zdjęcie
 * wygląda tak samo (`404`) i wraca jako `BodyPhotoError`, żeby kliknięcie
 * w nieaktualny przycisk skończyło się zdaniem przy galerii, nie ekranem błędu.
 * Trener cudzych zdjęć nie kasuje — kontrakt nie ma takiej trasy.
 */
export async function deleteBodyPhoto(api: Api, photoId: string): Promise<void> {
  try {
    await bodyPhotosControllerRemove({ client: api, path: { id: photoId }, throwOnError: true });
  } catch (e) {
    toBodyPhotoError(e);
  }
}
