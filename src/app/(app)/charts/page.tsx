import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chartTemplates, priceAlerts } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import ChartStudio from "@/components/ChartStudio";
import { requireCtx } from "@/lib/ctx";

export const metadata = { title: "Charting" };
export default async function Charts() {
  const ctx = await requireCtx();
  const [t, a] = await Promise.all([db.select().from(chartTemplates).where(and(eq(chartTemplates.userId, ctx.user.id))), db.select().from(priceAlerts).where(eq(priceAlerts.userId, ctx.user.id)).orderBy(desc(priceAlerts.createdAt)).limit(20)]);
  return (<><PageHeader title="Charting & Technical Analysis" desc="Candlestick, OHLC, line, area, Heikin Ashi and bar charts with 11 indicators, drawing tools, multi-chart layouts and saved templates." crumbs={[{ label: "Markets & Investing" }, { label: "Charts" }]} />
    <ChartStudio templates={t.map((x) => ({ id: x.id, name: x.name, config: x.config as never }))} alerts={a.map((x) => ({ id: x.id, symbol: x.symbol, condition: x.condition, price: x.price, status: x.status }))} /></>);
}
