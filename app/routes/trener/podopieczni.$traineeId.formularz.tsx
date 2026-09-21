import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import { requireUser } from "~/lib/api/auth";
import { fmtDateTime } from "~/lib/format";
import { answerLabel } from "~/lib/onboarding-form-types";
import { getFormForTrainer } from "~/lib/onboarding-forms";
import { findTraineeRef } from "~/lib/trainees";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";

  // Pre-checku przynależności już nie ma: cudzy podopieczny i formularz nigdy
  // niedoczepiony dają po stronie BE to samo `404`, tu `null` — oba kończą się
  // tak, jak do integracji.
  const form = await getFormForTrainer(api, traineeId);
  if (!form) throw new Response("not found", { status: 404 });

  // Nazwa podopiecznego w nagłówku — trener otwierający tę stronę wprost (zakładka,
  // przycisk „wstecz") musi wiedzieć, czyj to formularz. Kontrakt nie ma trasy
  // „jeden podopieczny", więc idzie ze sklejonych stron listy (luka L S5-2).
  const trainee = await findTraineeRef(api, traineeId);

  return { form, traineeId, traineeName: trainee?.displayName ?? null };
}

export default function FormularzStartowyTrenera() {
  const { form, traineeId, traineeName } = useLoaderData<typeof loader>();
  const done = form.completedAt != null;

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            <Link to={`/trener/podopieczni/${traineeId}`} style={{ color: "inherit" }}>
              ← Podopieczny
            </Link>
            {" · "}
            {traineeName ?? "—"}
          </div>
          <h1>Formularz startowy</h1>
          <div className="sub">
            {form.completedAt != null
              ? `Wypełniony ${fmtDateTime(form.completedAt)}.`
              : "Czeka na wypełnienie przez podopiecznego."}
          </div>
        </div>
      </div>

      {form.trainerNote != null && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            className="mono text-xs muted"
            style={{ textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}
          >
            Twoja notatka
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{form.trainerNote}</div>
        </div>
      )}

      <div className="list">
        <div
          className="list-head"
          style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 2fr", gap: 14 }}
        >
          <div>Ćwiczenie</div>
          <div>Wynik</div>
          <div>Komentarz</div>
        </div>
        {form.items.map((item) => (
          <div
            key={item.id}
            className="list-row"
            style={{ gridTemplateColumns: "1.6fr 0.8fr 2fr", gap: 14, cursor: "default" }}
          >
            <div style={{ fontSize: 14, fontWeight: 500 }}>{item.exerciseName}</div>
            <div className="mono">
              {item.value == null ? (
                <span className="muted">—</span>
              ) : (
                answerLabel(item.unit, item.value)
              )}
            </div>
            <div className="text-sm muted">{item.comment ?? "—"}</div>
          </div>
        ))}
      </div>

      {form.traineeNote != null && (
        <div className="card" style={{ marginTop: 16 }}>
          <div
            className="mono text-xs muted"
            style={{ textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}
          >
            Od podopiecznego
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{form.traineeNote}</div>
        </div>
      )}

      {!done && (
        <div className="empty" style={{ marginTop: 16 }}>
          <Icons.Consult />
          <div>Podopieczny zobaczy ten formularz przy pierwszym wejściu do aplikacji.</div>
        </div>
      )}
    </div>
  );
}
