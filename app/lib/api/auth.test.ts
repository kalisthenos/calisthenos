import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { hasRole, optionalUser, requireUser } from "./auth";
import { type AuthUser, apiContext } from "./context";

const API = { znacznik: "klient z middleware'u" } as never;

function kontekst(user: AuthUser | null) {
  const context = new RouterContextProvider();
  context.set(apiContext, { api: API, user });
  return context;
}

function osoba(roles: AuthUser["roles"]): AuthUser {
  return {
    id: "p-1",
    email: "a@e.pl",
    displayName: "Anna",
    roles,
    trainerId: null,
    trainerName: null,
  };
}

describe("requireUser / optionalUser / hasRole — tożsamość i rola z kontekstu", () => {
  it("bez użytkownika przekierowuje na logowanie", () => {
    try {
      requireUser(kontekst(null));
      expect.unreachable("miało rzucić przekierowanie");
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      expect((e as Response).headers.get("location")).toBe("/login");
    }
  });

  it("wpuszcza osobę mającą wymaganą rolę wśród wielu i oddaje klienta z kontekstu", () => {
    // ADR-0013 dopuścił `trainer` i `trainee` naraz. Do integracji rola była
    // pojedyncza i porównanie przez równość odsyłałoby taką osobę z każdej
    // trasy trenera — objaw wyglądający jak zepsute uprawnienia.
    const { api, user } = requireUser(kontekst(osoba(["trainee", "trainer"])), { role: "trainer" });
    expect(user.roles).toContain("trainer");
    // Trasa bierze z jednego wywołania oba — gdyby `api` nie przechodziło,
    // każdy loader musiałby sięgać do kontekstu drugi raz i mógłby zapomnieć.
    expect(api).toBe(API);
  });

  it("podopiecznemu bez roli trenera odsyła do jego sekcji", () => {
    try {
      requireUser(kontekst(osoba(["trainee"])), { role: "trainer" });
      expect.unreachable("miało rzucić przekierowanie");
    } catch (e) {
      expect((e as Response).headers.get("location")).toBe("/podopieczny");
    }
  });

  it("trenerowi bez roli podopiecznego odsyła do JEGO sekcji, nie na logowanie", () => {
    // Druga gałąź `sekcjaDla`. Bez tego przypadku wyrażenie warunkowe mogłoby
    // zwracać `/podopieczny` zawsze i komplet pozostałych testów by to przeżył
    // — a objawem byłby trener odsyłany do panelu podopiecznego.
    try {
      requireUser(kontekst(osoba(["trainer"])), { role: "trainee" });
      expect.unreachable("miało rzucić przekierowanie");
    } catch (e) {
      expect((e as Response).headers.get("location")).toBe("/trener");
    }
  });

  it("bez wymagania roli wpuszcza każdego zalogowanego", () => {
    // Kształt bez `opts` — używa go `files.$fileId.tsx`, czyli trasa
    // rozstrzygająca dostęp międzytenantowy. Wszystkie pozostałe przypadki
    // sukcesu podają rolę, więc skrót `role &&` i samo `return` byłyby tu
    // niewykonane przez nic.
    expect(requireUser(kontekst(osoba(["trainee"]))).user.id).toBe("p-1");
  });

  it("osoba bez żadnej roli trafia na logowanie, a nie w pętlę przekierowań", () => {
    // Rola jest faktem z okresem — między okresami lista bywa pusta. Bez
    // strażnika `sekcjaDla` odesłałaby taką osobę na `/podopieczny`, ta trasa
    // zażądałaby roli `trainee` i odesłała z powrotem. W nieskończoność.
    try {
      requireUser(kontekst(osoba([])), { role: "trainer" });
      expect.unreachable("miało rzucić przekierowanie");
    } catch (e) {
      expect((e as Response).headers.get("location")).toBe("/login");
    }
  });

  it("hasRole sprawdza przynależność do listy, nie równość", () => {
    expect(hasRole(osoba(["trainee", "trainer"]), "trainer")).toBe(true);
    expect(hasRole(osoba(["trainee"]), "trainer")).toBe(false);
  });

  it("optionalUser oddaje null zamiast przekierowania", () => {
    expect(optionalUser(kontekst(null)).user).toBeNull();
  });

  it("optionalUser oddaje użytkownika, gdy sesja jest", () => {
    // Bez tego przypadku `optionalUser` zwracające `null` zawsze przeszłoby
    // test wyżej — a trasy publiczne przestałyby rozpoznawać zalogowanego.
    expect(optionalUser(kontekst(osoba(["trainer"]))).user?.id).toBe("p-1");
  });
});
