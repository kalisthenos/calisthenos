import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { FeatureRequestBadge } from "~/components/feature-request-badge";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import {
  FEATURE_REQUEST_STATUSES,
  FeatureRequestResponseSchema,
  KIND_LABEL,
  STATUS_LABEL,
} from "~/lib/feature-request-types";
import {
  FeatureRequestError,
  getForTrainer,
  respondToFeatureRequest,
} from "~/lib/feature-requests";
import { fmtDate } from "~/lib/format";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const request = await getForTrainer(api, args.params.requestId ?? "");
  // Cudze zgłoszenie = 404, nie 403 — po stronie BE jest nieodróżnialne od
  // nieistniejącego, a moduł oddaje to jako `null`.
  if (request == null) throw new Response("Not Found", { status: 404 });
  return { request };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const fd = await args.request.formData();
  const parsed = FeatureRequestResponseSchema.safeParse({
    status: String(fd.get("status") ?? ""),
    response: String(fd.get("response") ?? ""),
  });
  if (!parsed.success) {
    return { ok: null, error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
  }

  try {
    await respondToFeatureRequest(api, {
      id: args.params.requestId ?? "",
      status: parsed.data.status,
      response: parsed.data.response,
    });
    return { ok: "Zapisano.", error: null };
  } catch (e) {
    if (e instanceof FeatureRequestError) return { ok: null, error: e.userMessage };
    // Obcy identyfikator kończy się `404` z BE — `toRouteResponse` robi z niego
    // odpowiedź 404, nie komunikat, tak jak do integracji.
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
}

export default function ZgloszenieTrenera() {
  const { request } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="crumbs">
        <Link to="/trener/pomysly">Pomysły</Link>
        <span>·</span>
        <span>{request.authorName}</span>
      </div>

      <div className="pagehead">
        <div>
          <h1>{request.title}</h1>
          <div className="sub row wrap" style={{ gap: 8, alignItems: "center" }}>
            <span className="badge">{KIND_LABEL[request.kind]}</span>
            <FeatureRequestBadge status={request.status} />
            <span className="text-xs muted mono">{fmtDate(request.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{request.body}</p>
      </div>

      <Form method="post" className="card" style={{ display: "grid", gap: 12 }}>
        <label className="col" style={{ gap: 4, maxWidth: 240 }}>
          <span className="text-sm">Status</span>
          <select name="status" className="input" defaultValue={request.status}>
            {FEATURE_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="text-sm">Odpowiedź dla podopiecznego (opcjonalna)</span>
          <textarea
            name="response"
            className="input"
            rows={4}
            maxLength={2000}
            defaultValue={request.trainerResponse ?? ""}
            placeholder="np. Dobry pomysł — wchodzi w kolejnej wersji."
          />
          <span className="text-xs muted">
            Podopieczny zobaczy tę odpowiedź przy swoim zgłoszeniu. Puste pole kasuje odpowiedź.
          </span>
        </label>
        {actionData?.error != null && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 12, margin: 0 }}>
            {actionData.error}
          </p>
        )}
        {actionData?.ok != null && (
          <output style={{ color: "var(--ok)", fontSize: 12 }}>{actionData.ok}</output>
        )}
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Zapisuję…" : "Zapisz"}
          </button>
        </div>
      </Form>
    </div>
  );
}
