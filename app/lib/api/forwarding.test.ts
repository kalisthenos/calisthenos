import { describe, expect, it } from "vitest";
import { naglowkiPrzekazania } from "./forwarding";

const SEKRET = "sekret-przekazywania-co-najmniej-32-znaki";

function zadanie(naglowki: Record<string, string>): Request {
  return new Request("https://fe.test/rejestracja", { headers: naglowki });
}

describe("naglowkiPrzekazania", () => {
  it("bierze PIERWSZY wpis X-Forwarded-For — tak brzeg Railway wpisuje klienta", () => {
    const n = naglowkiPrzekazania(
      zadanie({ "x-forwarded-for": "203.0.113.7, 100.64.0.2", "user-agent": "Mozilla/5.0" }),
      SEKRET,
    );
    expect(n).toEqual({
      "x-kth-forwarding-secret": SEKRET,
      "x-kth-client-ip": "203.0.113.7",
      "x-kth-client-ua": "Mozilla/5.0",
    });
  });

  it("bez X-Forwarded-For i bez User-Agent — tylko sekret", () => {
    expect(naglowkiPrzekazania(zadanie({}), SEKRET)).toEqual({ "x-kth-forwarding-secret": SEKRET });
  });

  it("bez sekretu nie dokłada niczego — BE i tak by nie uwierzył", () => {
    expect(naglowkiPrzekazania(zadanie({ "x-forwarded-for": "203.0.113.7" }), undefined)).toEqual(
      {},
    );
  });

  it("nie przepuszcza x-kth-* nadesłanych przez przeglądarkę", () => {
    const n = naglowkiPrzekazania(zadanie({ "x-kth-client-ip": "198.51.100.1" }), SEKRET);
    expect(n["x-kth-client-ip"]).toBeUndefined();
  });
});
