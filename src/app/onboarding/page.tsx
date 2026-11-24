import { redirect } from "next/navigation";
import { Wordmark } from "@/components/Brand";
import { OnboardingForm } from "@/components/AuthForms";
import { requireCtx } from "@/lib/ctx";

export const metadata = { title: "Set up your company" };
export const dynamic = "force-dynamic";

export default async function Onboarding() {
  const ctx = await requireCtx();
  if (ctx.company) redirect("/dashboard");
  return (
    <div className="grid-bg grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-line bg-panel p-7 glow">
        <Wordmark />
        <h1 className="mt-5 text-xl font-semibold">Welcome, {ctx.user.name.split(" ")[0]} — let’s create your first company</h1>
        <p className="mb-5 mt-1 text-sm text-muted">Step 2 of 2 · {ctx.org.name}</p>
        <OnboardingForm />
      </div>
    </div>
  );
}
