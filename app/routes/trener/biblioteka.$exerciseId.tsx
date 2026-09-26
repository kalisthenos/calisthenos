import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { z } from "zod";
import { ConfirmSubmitButton } from "~/components/confirm-provider";
import { CategoryPicker } from "~/components/exercise-fields";
import { FileDropzone } from "~/components/file-dropzone";
import { Icons } from "~/components/icons";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { filterToKnownCategoryNames, listCategoriesForTrainer } from "~/lib/categories";
import {
  ExerciseError,
  getExerciseDetail,
  setExerciseArchived,
  updateExercise,
} from "~/lib/exercises";
import { UploadError, maxUploadBytesFor } from "~/lib/file-uploads";

const EditSchema = z.object({
  name: z.string().trim().min(1, "Nazwa jest wymagana.").max(120),
  unit: z.enum(["REPS", "SEC"]),
  description: z.string().max(2000).default(""),
  tracksRpe: z.boolean(),
});

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const exerciseId = args.params.exerciseId ?? "";

  const exercise = await getExerciseDetail(api, exerciseId);
  if (exercise == null) {
    throw new Response("not found", { status: 404 });
  }

  const categories = await listCategoriesForTrainer(api);

  return {
    exercise,
    categories,
    // Ten sam limit co na serwerze — patrz komentarz w biblioteka.nowe.tsx.
    maxVideoBytes: maxUploadBytesFor("exercise_demo"),
  };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const exerciseId = args.params.exerciseId ?? "";
  const fd = await args.request.formData();
  const intent = fd.get("intent");

  if (intent === "archive") {
    try {
      await setExerciseArchived(api, exerciseId, true);
    } catch (e) {
      if (e instanceof ExerciseError) return { error: e.userMessage };
      if (e instanceof ApiError) throw toRouteResponse(e);
      throw e;
    }
    throw redirect("/trener/biblioteka");
  }

  if (intent === "unarchive") {
    try {
      await setExerciseArchived(api, exerciseId, false);
    } catch (e) {
      // BE zna dziś odmowę „wariant aktywnej umiejętności" wyłącznie na
      // archiwizacji (`ExercisesService.restore` nie ma tego sprawdzenia), więc
      // ta gałąź jest utwardzeniem, nie żywym przypadkiem: `ExerciseError` nie
      // dziedziczy po `ApiError`, więc bez tej linii uciekłby tu nieobsłużony.
      if (e instanceof ExerciseError) return { error: e.userMessage };
      if (e instanceof ApiError) throw toRouteResponse(e);
      throw e;
    }
    throw redirect(`/trener/biblioteka/${exerciseId}`);
  }

  // Default: save.
  const parsed = EditSchema.safeParse({
    name: fd.get("name"),
    unit: fd.get("unit"),
    description: fd.get("description") ?? "",
    tracksRpe: fd.get("tracksRpe") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Sprawdź pola formularza." };
  }
  const categories = await listCategoriesForTrainer(api);
  const selected = fd.getAll("categories").map((v) => v.toString());
  const tags = filterToKnownCategoryNames(categories, selected);

  const demoBlob = fd.get("demo");
  const demo = demoBlob instanceof File && demoBlob.size > 0 ? demoBlob : null;

  try {
    await updateExercise(api, {
      exerciseId,
      name: parsed.data.name,
      unit: parsed.data.unit,
      description: parsed.data.description,
      tags,
      tracksRpe: parsed.data.tracksRpe,
      demo,
    });
  } catch (e) {
    if (e instanceof UploadError) return { error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
  throw redirect("/trener/biblioteka");
}

export default function EdytujCwiczenie() {
  const { exercise, categories, maxVideoBytes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const isArchived = exercise.archivedAt != null;
  // Przyszliśmy tu przekierowaniem z formularza tworzenia: ćwiczenie powstało,
  // ale demo nie dało się podpiąć. Trener musi zobaczyć, czego brakuje — inaczej
  // zostałby z ćwiczeniem bez nagrania i bez śladu, że coś poszło nie tak.
  const [searchParams] = useSearchParams();
  const demoNiePodpiete = searchParams.get("demo") === "blad";
  // Blokada podwójnej wysyłki na formularzu zapisu — niesie wideo demo, więc wysyłka
  // trwa, a drugie kliknięcie wgrywa drugi blob na wolumen. Dotyczy wyłącznie tego
  // przycisku; osobne intencje (archiwizacja/przywrócenie) zostają bez zmian.
  const navigation = useNavigation();
  const isSubmitting = navigation.formMethod != null;

  return (
    <div style={{ maxWidth: 580 }}>
      <div className="crumbs">
        <Link to="/trener/biblioteka">Biblioteka</Link>
        <span className="sep">›</span>
        <span className="current">{exercise.name}</span>
      </div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Ćwiczenie · {exercise.unit}
          </div>
          <h1>{exercise.name}</h1>
        </div>
        {isArchived && (
          <span className="badge archived">
            <span className="badge-dot" />
            archiwum
          </span>
        )}
      </div>

      {demoNiePodpiete && (
        <p
          role="alert"
          className="card"
          style={{ padding: "10px 14px", marginBottom: 18, fontSize: 13 }}
        >
          Ćwiczenie zostało utworzone, ale wideo demo nie zostało podpięte. Wgraj je poniżej.
        </p>
      )}

      {exercise.demoUrl != null && (
        <div style={{ marginBottom: 18 }}>
          <div className="field-label" style={{ marginBottom: 6 }}>
            Aktualne demo
          </div>
          <video
            src={exercise.demoUrl}
            controls
            preload="metadata"
            playsInline
            style={{
              width: "100%",
              maxWidth: 480,
              borderRadius: 8,
              background: "var(--surface-2)",
              display: "block",
            }}
          />
        </div>
      )}

      <Form
        method="post"
        encType="multipart/form-data"
        className="card"
        style={{ display: "grid", gap: 14 }}
      >
        <div className="field">
          <label htmlFor="ex-name">Nazwa</label>
          <input
            id="ex-name"
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={exercise.name}
            className="input"
          />
        </div>

        <div className="field">
          <label htmlFor="ex-unit">Jednostka</label>
          <select id="ex-unit" name="unit" required defaultValue={exercise.unit} className="select">
            <option value="REPS">REPS (powtórzenia)</option>
            <option value="SEC">SEC (sekundy)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="ex-desc">Opis</label>
          <textarea
            id="ex-desc"
            name="description"
            rows={4}
            maxLength={2000}
            defaultValue={exercise.description}
            className="textarea"
          />
        </div>

        <label
          className="field"
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}
        >
          <input
            type="checkbox"
            name="tracksRpe"
            defaultChecked={exercise.tracksRpe}
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ display: "block", fontWeight: 500 }}>
              Zbieraj ocenę trudności (RPE 1–10) przy logowaniu
            </span>
            <span className="text-xs muted">
              Wyłącz dla ćwiczeń, w których ocena wysiłku nie ma sensu — podopieczny nie zobaczy
              wtedy skali trudności.
            </span>
          </span>
        </label>

        <CategoryPicker categories={categories} selected={exercise.tags} />

        <FileDropzone
          name="demo"
          idSuffix="edit"
          kind="video"
          label={
            exercise.demoUrl != null ? "Zastąp wideo demo (opcjonalne)" : "Wideo demo (opcjonalne)"
          }
          maxBytes={maxVideoBytes}
        />

        {actionData?.error != null && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
            {actionData.error}
          </p>
        )}

        <div className="row" style={{ gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Zapisywanie…" : "Zapisz zmiany"}
          </button>
          <Link to="/trener/biblioteka" className="btn btn-ghost">
            Anuluj
          </Link>
        </div>
      </Form>

      {/* Separate form for archive / unarchive so it doesn't carry the file input. */}
      <Form
        method="post"
        style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid var(--line)" }}
      >
        {!isArchived && exercise.variationOf != null && (
          // Kontrakt niesie tę umiejętność w szczególe (`variationOf`, „wyłącznie
          // aktywna, bo tylko taka blokuje archiwizację"), więc trener dowiaduje
          // się, CO odpiąć, ZANIM kliknie i dostanie odmowę. Komunikat samej
          // odmowy zostaje treścią BE — tu tylko uprzedzamy fakt.
          <p className="text-xs muted" style={{ margin: "0 0 10px" }}>
            To ćwiczenie jest wariantem umiejętności „{exercise.variationOf.skillName}" — żeby je
            zarchiwizować, najpierw odepnij je od tej umiejętności.
          </p>
        )}
        {isArchived ? (
          <button type="submit" name="intent" value="unarchive" className="btn">
            Przywróć z archiwum
          </button>
        ) : (
          <ConfirmSubmitButton
            name="intent"
            value="archive"
            className="btn btn-danger"
            confirmOptions={{
              title: "Zarchiwizować ćwiczenie?",
              message:
                "Będzie ukryte na liście, ale plany historyczne pozostaną nietknięte. Możesz przywrócić je później.",
              destructive: true,
              confirmText: "Archiwizuj",
            }}
          >
            <Icons.Arch /> Archiwizuj
          </ConfirmSubmitButton>
        )}
      </Form>
    </div>
  );
}
