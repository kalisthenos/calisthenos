import type { ActionFunctionArgs } from "react-router";
import { requireUser } from "~/lib/api/auth";
import { ApiError } from "~/lib/api/errors";
import { UploadError, uploadSetVideo } from "~/lib/file-uploads";
import { errorMeta, logger } from "~/lib/logger";

/**
 * Zawsze JAWNY `Response`, nigdy goły obiekt ani `data()`.
 *
 * Tę trasę woła surowy XMLHttpRequest (`components/video-upload-field.tsx`), który
 * robi `JSON.parse` na `responseText` — musi dostać czysty JSON, a nie format
 * wewnętrzny React Routera.
 */
function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/**
 * Trasa zasobowa (bez komponentu): JEDNO nagranie serii → `fileId`.
 *
 * Zostaje trasą FE, choć bajty idą dalej do BE: `VideoUploadField` wysyła
 * XMLHttpRequestem z paskiem postępu na TEN SAM origin, a BE nie ma CORS-u
 * i nie jest wołany z przeglądarki (D3 specu). Komponent nie zmienia się.
 *
 * Co przeszło do BE razem z bajtami: typ po zawartości, rodzaj z operacji
 * (`POST /v1/files/set-video`), bramka formularza startowego (`403
 * ONBOARDING_FORM_PENDING` — `OnboardingGuard` obejmuje wysyłki), limit liczby
 * wysyłek (`429` + `Retry-After`, kluczowany tożsamością — ADR-0031) i własność
 * pliku przy zapisie treningu. Odmowy BE wracają do XHR jako JSON z komunikatem
 * BE i tym samym statusem.
 */
export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });

  const fd = await args.request.formData();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Brak pliku." }, 400);
  }

  try {
    const fileId = await uploadSetVideo(api, file);
    logger.info("upload.set_video.ok", { fileId, bytes: file.size });
    return json({ fileId, bytes: file.size }, 200);
  } catch (err) {
    // Martwa sesja: middleware kończy ją przekierowaniem rzuconym PRZEZ interceptor
    // klienta — to sygnał sterowania, nie błąd danych. Przepuszczony przed
    // `ApiError`, inaczej `/login` zamieniłoby się w JSON 500.
    if (err instanceof Response) throw err;
    if (err instanceof UploadError) {
      // Komunikat już jest po polsku i bezpieczny do pokazania (rozmiar/format).
      return json({ error: err.userMessage }, 400);
    }
    if (err instanceof ApiError && err.status < 500) {
      // Odmowa BE (`403` formularza startowego, `429` limitu wysyłek, …): komunikat
      // jest po polsku i dla użytkownika; status idzie dalej, żeby `429` niosło
      // `Retry-After`. Awaria BE (`5xx`) NIE przechodzi tędy — ma zostać awarią
      // z logiem, nie zdaniem BE pokazanym jako problem z plikiem.
      const headers =
        err.retryAfter != null ? { "Retry-After": String(err.retryAfter) } : undefined;
      return json({ error: err.message }, err.status, headers);
    }
    logger.error("upload.set_video.failed", errorMeta(err));
    return json({ error: "Nie udało się wgrać nagrania. Spróbuj ponownie." }, 500);
  }
}
