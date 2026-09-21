import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { z } from "zod";
import { requireUser } from "~/lib/api/auth";
import {
  type CreatePlanResult,
  PlanError,
  createBlankPlan,
  findDraftForTrainee,
} from "~/lib/plans";
import { listTraineesOfTrainer } from "~/lib/trainees";

const NewPlanSchema = z.object({
  traineeId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const url = new URL(args.request.url);
  const preselectId = url.searchParams.get("traineeId");

  // Picker potrzebuje KOMPLETU, a kontrakt stronicuje po 30 — moduł skleja
  // strony w jedną listę. Zarchiwizowanych odfiltrowuje sam zasób: `GET /v1/trainees`
  // to podopieczni z aktywną relacją prowadzenia.
  const trainees = await listTraineesOfTrainer(api);

  // Preselect the trainee from the query string when it points at one of ours.
  const preselected =
    preselectId != null && trainees.some((t) => t.id === preselectId) ? preselectId : null;

  // Para z istniejącym szkicem — od razu do niego, żeby trener nie próbował
  // tworzyć drugiego (unikat po stronie BE i tak by odmówił).
  if (preselected) {
    const existingDraft = await findDraftForTrainee(api, preselected);
    if (existingDraft) {
      throw redirect(`/trener/plany/${existingDraft.id}`);
    }
  }

  return { trainees, preselected };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const fd = await args.request.formData();
  const parsed = NewPlanSchema.safeParse({
    traineeId: fd.get("traineeId"),
    name: fd.get("name"),
  });
  if (!parsed.success) {
    return { error: "Sprawdź pola formularza." };
  }

  // Przynależność podopiecznego i „jeden szkic na parę" sprawdza BE: cudzy
  // podopieczny to `404` (komunikat do formularza), istniejący szkic wraca
  // jako `created: false` i prowadzi tam, gdzie prowadził dotychczasowy pre-check.
  let result: CreatePlanResult;
  try {
    result = await createBlankPlan(api, parsed.data);
  } catch (e) {
    if (e instanceof PlanError) return { error: e.userMessage };
    throw e;
  }
  throw redirect(`/trener/plany/${result.id}`);
}

export default function NowyPlan() {
  const { trainees, preselected } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="crumbs">
        <Link to="/trener/plany">Plany</Link>
        <span className="sep">›</span>
        <span className="current">Nowy</span>
      </div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Trener
          </div>
          <h1>Nowy plan</h1>
        </div>
      </div>

      {trainees.length === 0 ? (
        <div className="empty">
          <h3>Brak podopiecznych</h3>
          <div>Wystaw najpierw zaproszenie w sekcji „Podopieczni".</div>
        </div>
      ) : (
        <Form method="post" className="card" style={{ display: "grid", gap: 14 }}>
          <div className="field">
            <label htmlFor="np-trainee">Dla kogo</label>
            <select
              id="np-trainee"
              name="traineeId"
              required
              defaultValue={preselected ?? trainees[0]?.id ?? ""}
              className="select"
            >
              {trainees.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="np-name">Nazwa planu</label>
            <input
              id="np-name"
              name="name"
              type="text"
              required
              maxLength={120}
              defaultValue="Nowy plan"
              className="input"
            />
          </div>
          {actionData?.error != null && (
            <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
              {actionData.error}
            </p>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn btn-primary">
              Utwórz draft
            </button>
            <Link to="/trener/plany" className="btn btn-ghost">
              Anuluj
            </Link>
          </div>
        </Form>
      )}
    </div>
  );
}
