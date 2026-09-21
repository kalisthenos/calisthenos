import { RouterContextProvider } from "react-router";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { apiContext } from "~/lib/api/context";
import { loader } from "./_index";

function wywolaj(url: string, user: unknown) {
  const context = new RouterContextProvider();
  context.set(apiContext, { api: null as never, user: user as never });
  try {
    loader({ request: new Request(url), params: {}, context } as never);
  } catch (e) {
    return e as Response;
  }
  throw new Error("loader miał przekierować, a nie zwrócić wartość");
}

const TRENER = {
  id: "u-1",
  email: "t@example.pl",
  displayName: "Trener",
  roles: ["trainer"],
  trainerId: null,
  trainerName: null,
};

describe("korzeń — powrót z callbacku kalendarza", () => {
  it("odsyła na ekran integracji z zachowanymi parametrami", () => {
    const res = wywolaj("https://fe.test/?calendar=error&reason=state", TRENER);

    expect(res.headers.get("Location")).toBe(
      "/trener/integracje/google?calendar=error&reason=state",
    );
  });

  it("powodzenie zgody trafia tam samo", () => {
    const res = wywolaj("https://fe.test/?calendar=ok", TRENER);

    expect(res.headers.get("Location")).toBe("/trener/integracje/google?calendar=ok");
  });

  it("martwa sesja nie jest przypadkiem szczególnym", () => {
    // Gałąź nie patrzy na użytkownika, a ekran integracji i tak wymaga
    // trenera — więc anonim kończy na `/login` tak samo, jak skończyłby
    // bez tej gałęzi. Sprawdzenie tożsamości stoi w JEDNYM miejscu.
    const res = wywolaj("https://fe.test/?calendar=ok", null);

    expect(res.headers.get("Location")).toBe("/trener/integracje/google?calendar=ok");
  });

  it("bez parametru zachowanie się nie zmienia", () => {
    expect(wywolaj("https://fe.test/", TRENER).headers.get("Location")).toBe("/trener");
    expect(wywolaj("https://fe.test/", null).headers.get("Location")).toBe("/login");
  });
});
