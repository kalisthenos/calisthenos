import { type LoaderFunctionArgs, redirect } from "react-router";

export async function loader({ params }: LoaderFunctionArgs) {
  return redirect(`/podopieczny/rozwoj/umiejetnosc/${params.skillId ?? ""}`, 301);
}
