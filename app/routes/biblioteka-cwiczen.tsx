import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/api/auth";
import { listActiveExercisesForTrainee } from "~/lib/exercises";

/**
 * Trasa ZASOBOWA — sam `loader`, bez komponentu (wzorem `upload.wideo.tsx`).
 * Karmi wybierak ćwiczeń na ekranie logowania sesji: biblioteka schodzi leniwie,
 * przy pierwszym otwarciu modala, a nie przy każdym wejściu na trening.
 *
 * Zakres najemcy niesie token i egzekwuje backend — ta trasa nie zna i nie może
 * znać identyfikatora trenera.
 */
export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  return { exercises: await listActiveExercisesForTrainee(api) };
}
