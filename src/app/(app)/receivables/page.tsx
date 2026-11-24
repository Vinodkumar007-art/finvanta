import ArAp from "@/components/ArAp";
export const metadata = { title: "Receivables" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) { return <ArAp kind="sales" sp={await searchParams} />; }
