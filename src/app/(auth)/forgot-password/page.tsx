import { ForgotForm } from "@/components/AuthForms";

export const metadata = { title: "Reset password" };
export default function Page() {
  return (<><h1 className="mb-1 text-xl font-semibold">Reset your password</h1><p className="mb-5 text-sm text-muted">We’ll issue a single-use link valid for one hour.</p><ForgotForm /></>);
}
