import {
  filesControllerBodyPhoto,
  filesControllerConfirm,
  filesControllerExerciseDemo,
  filesControllerSetVideo,
} from "@kalisthenos/api-client";
import type { UploadResultDto } from "@kalisthenos/api-client";
import type { Api } from "~/lib/api/client";
import { ApiError } from "~/lib/api/errors";
import { type Env, getEnv } from "~/lib/env";

/**
 * Rodzaj pliku. Po przejściu wszystkich trzech ścieżek wysyłki na kontrakt służy
 * już WYŁĄCZNIE do wyboru limitu rozmiaru sprawdzanego przed wysłaniem — co
 * naprawdę wgrywamy, wynika z użytej operacji kontraktu, nie z tego parametru
 * (`docs/04` §8: „`kind` w ładunku jest ignorowane").
 */
export type UploadKind = "exercise_demo" | "set_video" | "body_photo";

/**
 * Limit rozmiaru zależny od rodzaju pliku — **lustro decyzji BE**
 * (`UPLOAD_LIMIT_SOURCE`, `libs/files/.../upload-limits.ts`), nie własna reguła FE:
 * nagranie serii chodzi niższym limitem wideo (duże nagrania z telefonu są główną
 * przyczyną zrywanych wysyłek), demo instruktażowe trenera i zdjęcie sylwetki —
 * ogólnym. Limit surowszy od kontraktu odrzucałby w przeglądarce pliki, które BE
 * przyjmuje bez zastrzeżeń; łagodniejszy oznaczałby wysłanie kilkudziesięciu
 * megabajtów po to, żeby usłyszeć `413`.
 *
 * Domyślnie czyta bieżące env; przyjmuje limity wprost dla testów.
 */
export function maxUploadBytesFor(
  kind: UploadKind,
  limits: Pick<Env, "MAX_UPLOAD_BYTES" | "MAX_VIDEO_UPLOAD_BYTES"> = getEnv(),
): number {
  return kind === "set_video" ? limits.MAX_VIDEO_UPLOAD_BYTES : limits.MAX_UPLOAD_BYTES;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
  }
}

/**
 * Wspólna, dwufazowa ścieżka wysyłki przez kontrakt (§8 krok 4 specu): limit
 * rozmiaru sprawdzony PRZED wysłaniem (plik jest już w pamięci po
 * `request.formData()`, a `413` po kilkudziesięciu megabajtach nic nie
 * oszczędza), potem `POST /v1/files/{rodzaj}` i `POST /v1/files/{id}/confirm`.
 * Rodzaj wynika z użytej operacji kontraktu, nie z parametru — klient nie
 * decyduje, co wgrywa (`docs/04` §8); `kind` służy tu wyłącznie do wyboru limitu.
 *
 * **Czego tu NIE MA i dlaczego:**
 * - kontroli deklarowanego MIME — BE sprawdza typ PO ZAWARTOŚCI w locie, co jest
 *   mocniejsze niż `file.type` od klienta;
 * - `UploadCleanupQueue` — sprzątanie po nieudanym zapisie przejął BE
 *   (`orphan-files-sweep`, 24 h karencji dla pliku, na który nic nie wskazuje).
 *
 * `confirm` niczego dziś nie zapisuje (`FilesService.confirm` sprawdza istnienie
 * i tenant) — plik przed zamiataczem ratuje dopiero PODPIĘCIE do ćwiczenia,
 * do serii treningu albo do zdjęcia sylwetki.
 */
async function uploadThroughContract(
  api: Api,
  file: File,
  kind: UploadKind,
  send: (file: File) => Promise<{ data: UploadResultDto }>,
): Promise<string> {
  if (file.size === 0) {
    throw new UploadError("empty file", "Plik jest pusty.");
  }
  const maxBytes = maxUploadBytesFor(kind);
  if (file.size > maxBytes) {
    throw new UploadError(
      `file too large: ${file.size} > ${maxBytes}`,
      `Plik za duży (limit: ${Math.floor(maxBytes / 1_000_000)} MB).`,
    );
  }

  let fileId: string;
  try {
    const { data } = await send(file);
    fileId = data.id;
  } catch (e) {
    // Wąsko: trzy statusy, dla których BE ma komunikat o SAMYM PLIKU i dla których
    // trasa pokazuje tekst użytkownikowi. `401`/`403`/`404`/`429` to sprawa sesji,
    // tenanta i limitów — te lecą dalej i obsługuje je wołający.
    if (e instanceof ApiError && (e.status === 400 || e.status === 409 || e.status === 413)) {
      throw new UploadError(`upload rejected: ${e.code}`, e.message);
    }
    throw e;
  }

  await filesControllerConfirm({ client: api, path: { id: fileId }, throwOnError: true });
  return fileId;
}

/** Demo ćwiczenia (`exercise_demo`, limit ogólny) — `POST /v1/files/exercise-demo`. */
export async function uploadExerciseDemo(api: Api, file: File): Promise<string> {
  return await uploadThroughContract(api, file, "exercise_demo", (file) =>
    filesControllerExerciseDemo({ client: api, body: { file }, throwOnError: true }),
  );
}

/**
 * Nagranie serii (`set_video`, niższy limit wideo) — `POST /v1/files/set-video`.
 * Zwrócony identyfikator NICZEGO nie uprawnia — własność sprawdza dopiero BE przy
 * zapisie treningu (`409 SET_VIDEO_UNAVAILABLE`).
 */
export async function uploadSetVideo(api: Api, file: File): Promise<string> {
  return await uploadThroughContract(api, file, "set_video", (file) =>
    filesControllerSetVideo({ client: api, body: { file }, throwOnError: true }),
  );
}

/**
 * Zdjęcie sylwetki (`body_photo`, limit ogólny) — `POST /v1/files/body-photo`.
 * Trzecia i ostatnia ścieżka wysyłki: po niej na wolumenie FE nie powstaje już
 * żaden nowy plik i zapis na dysk znika z tego modułu w całości.
 *
 * Sam identyfikator nie jest jeszcze zdjęciem — wiąże go dopiero
 * `addBodyPhoto` (`POST /v1/me/body-photos`). Wysyłka, po której to drugie
 * żądanie się nie powiedzie, zostawia plik bez właściciela; zabiera go zamiatacz
 * BE po 24 h karencji, więc FE niczego tu nie cofa.
 */
export async function uploadBodyPhoto(api: Api, file: File): Promise<string> {
  return await uploadThroughContract(api, file, "body_photo", (file) =>
    filesControllerBodyPhoto({ client: api, body: { file }, throwOnError: true }),
  );
}
