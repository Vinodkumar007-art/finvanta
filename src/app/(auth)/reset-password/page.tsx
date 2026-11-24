import { ResetForm } from "@/components/AuthForms";

export const metadata = { title: "Choose a new password" };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (<><h1 className="mb-1 text-xl font-semibold">Choose a new password</h1><p className="mb-5 text-sm text-muted">All existing sessions will be signed out.</p>{token ? <ResetForm token={token} /> : <p className="text-sm text-down">Missing reset token.</p>}</>);
}
