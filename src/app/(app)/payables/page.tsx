import ArAp from "@/components/ArAp";
export const metadata = { title: "Payables" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) { return <ArAp kind="purchase" sp={await searchParams} />; }
