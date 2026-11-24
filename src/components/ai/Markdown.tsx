"use client";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BarsChart, LinesChart } from "@/components/Charts";

type ChartSpec = { type: "bar" | "line"; x: string; series: { key: string; name?: string }[]; data: Record<string, string | number | null>[] };

function ChartBlock({ raw }: { raw: string }) {
  let spec: ChartSpec | null = null;
  try {
    const j = JSON.parse(raw);
    if ((j.type === "bar" || j.type === "line") && typeof j.x === "string" && Array.isArray(j.series) && Array.isArray(j.data) && j.data.length <= 200) spec = j;
  } catch { /* streaming partial JSON */ }
  if (!spec) return <pre><code>{raw}</code></pre>;
  return (
    <div className="my-2 rounded-lg border border-line bg-bg2 p-2">
      {spec.type === "bar" ? <BarsChart data={spec.data} x={spec.x} series={spec.series} height={220} /> : <LinesChart data={spec.data} x={spec.x} series={spec.series} height={220} />}
      <div className="px-1 pt-1 text-[10px] text-muted">Chart generated from tool-verified figures in this response.</div>
    </div>
  );
}

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-ai">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children: c }) => (href?.startsWith("/") ? <Link href={href}>{c}</Link> : <a href={href} target="_blank" rel="noopener noreferrer nofollow">{c}</a>),
        code: ({ className, children: c }) => {
          const lang = /language-(\w+)/.exec(className ?? "")?.[1];
          if (lang === "chart") return <ChartBlock raw={String(c)} />;
          return <code className={className}>{c}</code>;
        },
        pre: ({ children: c }) => <>{c}</>,
      }}>{children}</ReactMarkdown>
    </div>
  );
}
