import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import {
  MAX_ONBOARDING_COMMENT,
  MAX_ONBOARDING_NOTE,
  MAX_ONBOARDING_VALUE,
  OnboardingAnswersSchema,
  toAnswersInput,
} from "~/lib/onboarding-form-types";
import {
  OnboardingFormError,
  getPendingFormForTrainee,
  submitOnboardingForm,
} from "~/lib/onboarding-forms";
import { unitLabelPl } from "~/lib/progression-math";

// ============================================================
// Ekran formularza startowego żyje POZA layoutem podopiecznego (bez sidenava),
// żeby bramka w `_layout.tsx` nie wpadała w pętlę redirectów. Sam formularz idzie
// kontraktem (`/v1/me/onboarding-form` jest na białej liście bramki BE — inaczej
// nie dałoby się go pobrać).
//
// Formularz jest tu JEDYNĄ bramką i tak zostaje: płatności wyszły z produktu
// (ADR-0037 po stronie BE), więc nie ma drugiego warunku, który mógłby tu wrócić.
// ============================================================

export async function loader({ context }: LoaderFunctionArgs) {
  const { api, user } = requireUser(context, { role: "trainee" });

  const form = await getPendingFormForTrainee(api);
  if (!form) throw redirect("/podopieczny");

  // Nazwa trenera przychodzi z sesji (`MeDto.coach.displayName`), więc osobne
  // zapytanie o użytkownika przestało być potrzebne — a wraz z S6 zniknął
  // i moduł, który je wykonywał.
  return { form, trainerName: user.trainerName };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { api } = requireUser(context, { role: "trainee" });

  const fd = await request.formData();

  const parsed = OnboardingAnswersSchema.safeParse(
    toAnswersInput({
      itemIds: fd.getAll("itemId").map(String),
      values: fd.getAll("value").map(String),
      comments: fd.getAll("comment").map(String),
      traineeNote: String(fd.get("traineeNote") ?? ""),
    }),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Sprawdź wpisane wyniki." };
  }

  try {
    await submitOnboardingForm(api, parsed.data);
  } catch (e) {
    if (e instanceof OnboardingFormError) return { error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
  return redirect("/podopieczny");
}

export default function FormularzStartowy() {
  const { form, trainerName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <main className="auth-shell">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark" />
          <span>calisthenos</span>
          <span className="brand-dot" />
        </div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Formularz startowy
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Na czym dziś stoisz?</h1>
        <p className="muted" style={{ marginBottom: 18 }}>
          {trainerName ?? "Twój trener"} prosi o kilka liczb, żeby ułożyć Ci pierwszy plan. Wypełnij
          formularz, aby przejść dalej.
        </p>

        {form.trainerNote != null && (
          <div
            className="card"
            style={{ padding: 14, marginBottom: 18, background: "var(--surface-2)" }}
          >
            <div
              className="mono text-xs muted"
              style={{ textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}
            >
              Od trenera
            </div>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{form.trainerNote}</div>
          </div>
        )}

        {actionData && "error" in actionData && (
          <p className="alert alert-error" style={{ marginBottom: 14 }} role="alert">
            {actionData.error}
          </p>
        )}

        <Form method="post" style={{ display: "grid", gap: 16 }}>
          {form.items.map((item) => (
            <div key={item.id} className="field" style={{ margin: 0 }}>
              <input type="hidden" name="itemId" value={item.id} />
              <label htmlFor={`val-${item.id}`} style={{ fontWeight: 600 }}>
                {item.exerciseName}
              </label>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <input
                  id={`val-${item.id}`}
                  name="value"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_ONBOARDING_VALUE}
                  step={1}
                  required
                  className="input"
                  style={{ maxWidth: 120 }}
                />
                <span className="mono text-xs muted" style={{ textTransform: "uppercase" }}>
                  {unitLabelPl(item.unit)}
                </span>
              </div>
              <input
                name="comment"
                type="text"
                maxLength={MAX_ONBOARDING_COMMENT}
                className="input"
                style={{ marginTop: 6 }}
                aria-label={`Komentarz — ${item.exerciseName}`}
                placeholder="Komentarz — opcjonalnie (np. „z gumą”)"
              />
            </div>
          ))}

          <label className="field" style={{ margin: 0 }}>
            <span className="text-sm">Coś jeszcze, co trener powinien wiedzieć? — opcjonalnie</span>
            <textarea
              name="traineeNote"
              className="input"
              rows={3}
              maxLength={MAX_ONBOARDING_NOTE}
            />
          </label>

          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? "Zapisuję…" : "Gotowe — przejdź do aplikacji"}
          </button>
        </Form>

        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Link to="/wyloguj" className="muted text-sm">
            Wyloguj
          </Link>
        </div>
      </div>
    </main>
  );
}
