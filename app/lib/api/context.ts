import { createContext } from "react-router";
import type { Api } from "./client";

export type Role = "trainer" | "trainee";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  /**
   * LISTA, nie pojedyncza wartość. ADR-0013 uczynił rolę faktem z okresem
   * i dopuścił `trainer` oraz `trainee` naraz, więc kontrola roli jest
   * sprawdzeniem przynależności, nie równością.
   */
  roles: Role[];
  trainerId: string | null;
  /**
   * Z `MeDto.coach.partyId`. **Zmieniło źródło, a z nim znaczenie:** do
   * integracji była to lepka kolumna `users.trainer_id`, ustawiana raz przy
   * przyjęciu zaproszenia. Teraz to pole kontraktu, którego pustka zależy od
   * tego, jak BE rozstrzyga aktywność relacji — a ADR-0013 uczynił rolę faktem
   * z OKRESEM. Kto na tym stoi: `authz.ts` (dostęp międzytenantowy) — drugi
   * konsument, bramka płatnicza, zniknął razem z płatnościami (ADR-0037). Zanim
   * logowanie zacznie wystawiać tę sesję (krok 2 Etapu 2), trzeba ustalić
   * i zapisać, co BE zwraca w `coach` po zakończeniu okresu relacji.
   */
  /** Z `MeDto.coach.displayName` — oszczędza osobne zapytanie o nazwę trenera. */
  trainerName: string | null;
}

export interface ApiBundle {
  api: Api;
  user: AuthUser | null;
}

/** Jedyny klucz kontekstu tej warstwy. */
export const apiContext = createContext<ApiBundle>();
