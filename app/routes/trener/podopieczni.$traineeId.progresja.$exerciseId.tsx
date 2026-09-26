import { type LoaderFunctionArgs, redirect } from "react-router";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(
    `/trener/podopieczni/${params.traineeId ?? ""}/rozwoj/cwiczenie/${params.exerciseId ?? ""}${url.search}`,
    301,
  );
}
