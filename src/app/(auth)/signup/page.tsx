import { redirect } from "next/navigation";
import { SignupForm } from "@/components/AuthForms";
import { OAuthButtons } from "@/components/OAuthButtons";
import { getCtx } from "@/lib/ctx";

export const metadata = { title: "Create account" };
export default async function Page() {
  if (await getCtx()) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Create your workspace</h1>
      <p className="mb-5 text-sm text-muted">Your organisation’s data is isolated and role-protected.</p>
      <SignupForm />
      <OAuthButtons />
    </>
  );
}
