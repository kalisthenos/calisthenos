import {
  type ActionFunctionArgs,
  Form,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { z } from "zod";
import { optionalUser } from "~/lib/api/auth";
import { AuthError, acceptInvite } from "~/lib/api/auth-session";
import { buildSessionCookie } from "~/lib/api/session";
import { previewInvite } from "~/lib/auth";

const AcceptSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(80),
  password: z.string().min(8).max(1024),
});

export async function loader(args: LoaderFunctionArgs) {
  const { api } = optionalUser(args.context);
  const token = args.params.token ?? "";

  // Nieistniejące, zużyte i wygasłe zaproszenie dają w BE jeden kod, a moduł
  // zamienia go na `null` (reguła D3) — i tu też wychodzi jeden `404`, żeby
  // sonda nie odróżniła „zły token" od „dobry, ale już użyty". Awaria BE
  // zostaje awarią i leci do granicy błędu.
  const invite = await previewInvite(api, token);
  if (!invite) throw new Response("invite not found", { status: 404 });

  return { displayName: invite.displayName, emailHint: invite.email };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = optionalUser(args.context);
  const token = args.params.token ?? "";
  const fd = await args.request.formData();
  const parsed = AcceptSchema.safeParse({
    email: fd.get("email"),
    displayName: fd.get("displayName"),
    password: fd.get("password"),
  });
  if (!parsed.success) return { error: "Sprawdź pola formularza." };

  try {
    const session = await acceptInvite(api, token, parsed.data);
    // Na `/`, NIE do sekcji: odpowiedź przyjęcia typuje `roles` jako
    // `Array<string>`, szerzej niż `MeDto`, więc sekcję rozstrzyga `_index.tsx`
    // na wąskim `/v1/me` z następnego żądania (D4 specu).
    return redirect("/", { headers: { "Set-Cookie": buildSessionCookie(session) } });
  } catch (e) {
    if (e instanceof AuthError) return { error: e.userMessage };
    throw e;
  }
}

export default function InviteAccept() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark" />
          <span>calisthenos</span>
          <span className="brand-dot" />
        </div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Zaproszenie
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Witaj, {loaderData.displayName}.</h1>
        <p className="muted" style={{ marginBottom: 18 }}>
          Trener Cię zaprosił. Ustaw email i hasło.
        </p>
        <Form method="post" style={{ display: "grid", gap: 14 }}>
          <div className="field">
            <label htmlFor="inv-email">Email</label>
            <input
              id="inv-email"
              name="email"
              type="email"
              value={loaderData.emailHint ?? ""}
              readOnly
              autoComplete="email"
              className="input"
              style={{ background: "var(--surface-2)", color: "var(--muted)" }}
            />
            <div className="text-xs muted" style={{ marginTop: 4 }}>
              Email ustawia trener — nie da się go tu zmienić.
            </div>
          </div>
          <div className="field">
            <label htmlFor="inv-name">Nazwa wyświetlana</label>
            <input
              id="inv-name"
              name="displayName"
              type="text"
              required
              defaultValue={loaderData.displayName}
              className="input"
            />
          </div>
          <div className="field">
            <label htmlFor="inv-password">Hasło (min. 8 znaków)</label>
            <input
              id="inv-password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
            />
          </div>
          {actionData && "error" in actionData && (
            <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
              {actionData.error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg" style={{ marginTop: 4 }}>
            Załóż konto
          </button>
        </Form>
      </div>
    </main>
  );
}
