import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/api/auth";
import { listActiveExercisesForTrainee } from "~/lib/exercises";
import { errorMeta, logger } from "~/lib/logger";

/**
 * Trasa ZASOBOWA — sam `loader`, bez komponentu (wzorem `upload.wideo.tsx`).
 * Karmi wybierak ćwiczeń na ekranie logowania sesji: biblioteka schodzi leniwie,
 * przy pierwszym otwarciu modala, a nie przy każdym wejściu na trening.
 *
 * Zakres najemcy niesie token i egzekwuje backend — ta trasa nie zna i nie może
 * znać identyfikatora trenera.
 *
 * **Ta trasa NIE RZUCA na awarii biblioteki, i to jest jej najważniejsza
 * właściwość** — tak samo jak `upload.wideo.tsx`, z tego samego powodu i o wagę
 * cięższego. `useFetcher` rejestruje się pod trasą, która go RENDERUJE, więc
 * błąd tego loadera nie ląduje w żadnym własnym miejscu: ląduje w
 * `ErrorBoundary` **trasy logowania treningu**. Podopieczny z wypełnionymi
 * trzema ćwiczeniami, któremu mrugnął zasięg, kliknąłby „Wymień" i zobaczył,
 * jak cały formularz znika pod ekranem „Nie udało się zapisać treningu" —
 * komunikatem o zapisie, którego nie było. Ma wtedy pełne prawo uznać, że
 * trening przepadł.
 *
 * Dlatego awaria wraca DANYMI (`error` w ładunku), a wybierak pokazuje ją u
 * siebie razem z „Spróbuj ponownie". Jedyne, co przechodzi dalej, to `Response`
 * — martwa sesja kończy się przekierowaniem rzuconym przez interceptor klienta,
 * a to sygnał sterowania, nie awaria danych (ten sam wyjątek co w
 * `upload.wideo.tsx`).
 */
export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  try {
    return { exercises: await listActiveExercisesForTrainee(api), error: null };
  } catch (err) {
    if (err instanceof Response) throw err;
    logger.error("biblioteka_cwiczen.load.failed", errorMeta(err));
    return {
      exercises: [],
      error: "Nie udało się wczytać biblioteki ćwiczeń.",
    };
  }
}
