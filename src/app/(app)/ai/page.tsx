import { PageHeader } from "@/components/ui";
import ChatPanel from "@/components/ai/ChatPanel";
import { requireCompany } from "@/lib/ctx";
import { AGENTS } from "@/services/ai/agents";

export const metadata = { title: "FINVANTA AI" };

export default async function AiPage({ searchParams }: { searchParams: Promise<{ c?: string; agent?: string }> }) {
  await requireCompany();
  const { c, agent } = await searchParams;
  const initialAgent = AGENTS.some((item) => item.id === agent) ? agent : undefined;
  const mediaEnabled = process.env.AI_MEDIA_ENABLED?.trim().toLowerCase() === "true";
  return (
    <>
      <PageHeader title="FINVANTA AI" desc={`Ask general or finance questions, explore records, and talk by voice. ${mediaEnabled ? "Image and video generation is enabled." : "Media generation is paused until an available provider quota is configured."} Record changes still require your approval.`} />
      <ChatPanel initialId={c} initialAgent={initialAgent} mediaEnabled={mediaEnabled} />
    </>
  );
}
