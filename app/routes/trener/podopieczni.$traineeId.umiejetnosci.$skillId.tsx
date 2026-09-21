import { type LoaderFunctionArgs, redirect } from "react-router";

export async function loader({ params }: LoaderFunctionArgs) {
  return redirect(
    `/trener/podopieczni/${params.traineeId ?? ""}/rozwoj/umiejetnosc/${params.skillId ?? ""}`,
    301,
  );
}
