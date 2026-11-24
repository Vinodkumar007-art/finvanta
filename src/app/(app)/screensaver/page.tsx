import { PageHeader } from "@/components/ui";
import ScreensaverExperience from "@/components/ScreensaverExperience";
import { requireCompany } from "@/lib/ctx";

export const metadata = { title: "Ambient Screensaver" };

export default async function ScreensaverPage() {
  await requireCompany();
  return (
    <>
      <PageHeader title="Ambient Screensaver" desc="A calm, abstract financial-dataflow display for a shared screen. It shows no company records and pauses when the browser tab is hidden." />
      <ScreensaverExperience />
    </>
  );
}
