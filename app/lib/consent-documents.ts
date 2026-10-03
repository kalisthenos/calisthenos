import { consentDocumentsControllerVersion } from "@kalisthenos/api-client";
import type { ConsentDocumentResponse } from "@kalisthenos/api-client";
import { type Api, orNull } from "~/lib/api/client";

export type { ConsentDocumentResponse } from "@kalisthenos/api-client";

/** Treść dokumentu zgody w wersji — trasa publiczna (spec tras §8). `404` → `null` (D3). */
export async function consentDocument(
  api: Api,
  key: string,
  versionNumber: number,
): Promise<ConsentDocumentResponse | null> {
  const wynik = await orNull(
    consentDocumentsControllerVersion({
      client: api,
      path: { key, versionNumber },
      throwOnError: true,
    }),
  );
  return wynik?.data ?? null;
}
