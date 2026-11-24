import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import sharp from "sharp";
import { apiCtx, json } from "@/lib/http";
import { buildReport, type Report } from "@/services/reports";
import { audit } from "@/lib/audit";
import type { CompanyCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";
const MIS_PACK = ["profit-loss", "balance-sheet", "cash-flow", "ratios", "trial-balance"] as const;
const NAVY = "FF0E1A30";
const ACCENT = "FF18A6A6";
const LIGHT = "FFF2F5F9";
const MUTED = "FF64748B";
const CHART_COLORS = ["#18A6A6", "#4677A8", "#76A5D1", "#D39B4A", "#7C6EB0"];

function metric(reports: Report[], reportKey: string, label: string, valueKey: string): number | null {
  const raw = reports.find((report) => report.key === reportKey)?.rows.find((row) => row.label === label)?.[valueKey];
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function renderBarChart(title: string, items: { label: string; value: number | null }[], currency: string): Promise<string> {
  const width = 1000;
  const height = 118 + items.length * 54;
  const center = 610;
  const maxBarWidth = 250;
  const values = items.flatMap((item) => item.value === null ? [] : [Math.abs(item.value)]);
  const scaleMax = Math.max(1, ...values);
  const formatValue = (value: number) => `${currency} ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const bars = items.map((item, index) => {
    const y = 104 + index * 54;
    const label = escapeXml(item.label);
    if (item.value === null) return `<text x="24" y="${y + 6}" class="label">${label}</text><text x="${center}" y="${y + 6}" class="missing">Not available</text>`;
    const barWidth = Math.max(2, Math.abs(item.value) / scaleMax * maxBarWidth);
    const x = item.value < 0 ? center - barWidth : center;
    const color = CHART_COLORS[index % CHART_COLORS.length];
    const valueX = item.value < 0 ? Math.max(315, x - 12) : Math.min(965, x + barWidth + 12);
    const anchor = item.value < 0 && x - 12 < 330 ? "start" : item.value < 0 ? "end" : "start";
    return `<text x="24" y="${y + 6}" class="label">${label}</text><rect x="${x}" y="${y - 14}" width="${barWidth}" height="26" rx="5" fill="${color}"/><text x="${valueX}" y="${y + 6}" text-anchor="${anchor}" class="value">${escapeXml(formatValue(item.value))}</text>`;
  }).join("");
  const grid = [-1, -0.5, 0, 0.5, 1].map((step) => {
    const x = center + step * maxBarWidth;
    return `<line x1="${x}" y1="82" x2="${x}" y2="${height - 28}" stroke="${step === 0 ? "#64748B" : "#E2E8F0"}" stroke-width="${step === 0 ? 2 : 1}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="14" fill="#FFFFFF"/><text x="24" y="38" class="title">${escapeXml(title)}</text><text x="24" y="64" class="subtitle">Amounts in ${escapeXml(currency)} · selected financial year</text><style>.title{font:700 23px Arial,sans-serif;fill:#0E1A30}.subtitle{font:14px Arial,sans-serif;fill:#64748B}.label{font:15px Arial,sans-serif;fill:#243247}.value{font:700 14px Arial,sans-serif;fill:#243247}.missing{font:italic 14px Arial,sans-serif;fill:#94A3B8}</style>${grid}${bars}<text x="${center - maxBarWidth}" y="${height - 8}" text-anchor="middle" class="subtitle">-${scaleMax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</text><text x="${center}" y="${height - 8}" text-anchor="middle" class="subtitle">0</text><text x="${center + maxBarWidth}" y="${height - 8}" text-anchor="middle" class="subtitle">${scaleMax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</text></svg>`;
  return (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
}

const cell = (v: unknown, kind?: string) => {
  if (v === null || v === undefined) return "";
  if (kind === "pct") return `${(Number(v) * 100).toFixed(1)}%`;
  if ((kind === "money" || kind === "num") && v !== "" && Number.isFinite(Number(v))) return Number(v).toLocaleString("en-IN", { minimumFractionDigits: kind === "money" ? 2 : 0, maximumFractionDigits: kind === "money" ? 2 : 4 });
  return String(v);
};

function toCsv(r: Report) {
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const raw = (v: unknown) => (v === null || v === undefined ? "" : v);
  return "\uFEFF" + [r.columns.map((c) => esc(c.label)).join(","), ...r.rows.map((row) => r.columns.map((c) => esc(raw(row[c.key]))).join(","))].join("\r\n");
}

async function toXlsx(reports: Report[], ctx: CompanyCtx) {
  const wb = new ExcelJS.Workbook();
  const generatedAt = new Date();
  const generatedLabel = generatedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const period = `${ctx.fy.label} · ${ctx.fy.startDate} to ${ctx.fy.endDate}`;
  const currency = ctx.company.baseCurrency;
  wb.creator = "FINVANTA";
  wb.lastModifiedBy = "FINVANTA";
  wb.created = generatedAt;
  wb.modified = generatedAt;
  wb.title = `${ctx.company.name} MIS Pack · ${ctx.fy.label}`;
  wb.subject = "Management information report";

  const sheetNames = reports.map((r) => r.title.slice(0, 30).replace(/[\\/*?:[\]]/g, ""));
  if (reports.length > 1) {
    const dashboard = wb.addWorksheet("Executive Dashboard");
    dashboard.columns = Array.from({ length: 12 }, () => ({ width: 13 }));
    const banner = dashboard.addRow(["FINVANTA · EXECUTIVE DASHBOARD"]);
    const company = dashboard.addRow([ctx.company.name]);
    const periodRow = dashboard.addRow([`${ctx.fy.label}  |  ${ctx.fy.startDate} to ${ctx.fy.endDate}  |  ${currency}`]);
    const attribution = dashboard.addRow([`Created by FINVANTA  |  Generated ${generatedLabel} IST`]);
    for (let row = 1; row <= 4; row++) dashboard.mergeCells(row, 1, row, 12);
    banner.height = 32;
    banner.getCell(1).font = { bold: true, size: 20, color: { argb: "FFFFFFFF" } };
    banner.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; });
    company.height = 28;
    company.getCell(1).font = { bold: true, size: 16, color: { argb: ACCENT } };
    periodRow.getCell(1).font = { size: 11, color: { argb: MUTED } };
    attribution.getCell(1).font = { italic: true, size: 10, color: { argb: MUTED } };

    const kpis = [
      { label: `REVENUE (${currency})`, value: metric(reports, "profit-loss", "Revenue from operations", "current") },
      { label: `EBITDA (${currency})`, value: metric(reports, "profit-loss", "EBITDA", "current") },
      { label: `NET PROFIT (${currency})`, value: metric(reports, "profit-loss", "Net profit", "current") },
      { label: `CLOSING CASH (${currency})`, value: metric(reports, "cash-flow", "Closing cash & bank", "amount") },
    ];
    kpis.forEach((kpi, index) => {
      const start = index * 3 + 1;
      dashboard.mergeCells(6, start, 6, start + 2);
      dashboard.mergeCells(7, start, 8, start + 2);
      const labelCell = dashboard.getCell(6, start);
      labelCell.value = kpi.label;
      labelCell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      labelCell.alignment = { horizontal: "center", vertical: "middle" };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      const valueCell = dashboard.getCell(7, start);
      valueCell.value = kpi.value === null ? "Not available" : kpi.value;
      valueCell.font = { bold: true, size: 18, color: { argb: NAVY } };
      valueCell.alignment = { horizontal: "center", vertical: "middle" };
      valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      if (kpi.value !== null) valueCell.numFmt = "#,##0.00;[Red](#,##0.00)";
    });

    const chartSpecs = [
      {
        title: "Profitability overview",
        items: [
          { label: "Revenue", value: metric(reports, "profit-loss", "Revenue from operations", "current") },
          { label: "Gross profit", value: metric(reports, "profit-loss", "Gross profit", "current") },
          { label: "EBITDA", value: metric(reports, "profit-loss", "EBITDA", "current") },
          { label: "Net profit", value: metric(reports, "profit-loss", "Net profit", "current") },
        ],
      },
      {
        title: "Balance sheet: assets and funding",
        items: [
          { label: "Total assets", value: metric(reports, "balance-sheet", "TOTAL ASSETS", "current") },
          { label: "Current liabilities", value: metric(reports, "balance-sheet", "Total current liabilities", "current") },
          { label: "Long-term loans", value: metric(reports, "balance-sheet", "Long-term loans", "current") },
          { label: "Total equity", value: metric(reports, "balance-sheet", "Total equity", "current") },
        ],
      },
      {
        title: "Cash flow activities",
        items: [
          { label: "Operating activities", value: metric(reports, "cash-flow", "Cash from operating activities", "amount") },
          { label: "Investing activities", value: metric(reports, "cash-flow", "Cash from investing activities", "amount") },
          { label: "Financing activities", value: metric(reports, "cash-flow", "Cash from financing activities", "amount") },
          { label: "Net change in cash", value: metric(reports, "cash-flow", "Net change in cash", "amount") },
        ],
      },
    ];
    const charts = await Promise.all(chartSpecs.map(async (chart) => ({
      ...chart,
      imageId: wb.addImage({ base64: `data:image/png;base64,${await renderBarChart(chart.title, chart.items, currency)}`, extension: "png" }),
    })));
    dashboard.addImage(charts[0].imageId, { tl: { col: 0, row: 9 }, ext: { width: 540, height: 260 } });
    dashboard.addImage(charts[1].imageId, { tl: { col: 6, row: 9 }, ext: { width: 540, height: 260 } });
    dashboard.addImage(charts[2].imageId, { tl: { col: 1, row: 27 }, ext: { width: 1040, height: 260 } });
    dashboard.mergeCells(45, 1, 45, 12);
    dashboard.getCell(45, 1).value = "Charts use ledger-derived report values for the selected financial year. Missing values are shown as Not available; no values are imputed.";
    dashboard.getCell(45, 1).font = { italic: true, size: 9, color: { argb: MUTED } };
    dashboard.views = [{ state: "frozen", ySplit: 4 }];
    dashboard.headerFooter.oddFooter = "&LCreated by FINVANTA&CPage &P of &N&RManagement report";
    dashboard.pageSetup.orientation = "landscape";
    dashboard.pageSetup.fitToPage = true;
    dashboard.pageSetup.fitToWidth = 1;
    dashboard.pageSetup.fitToHeight = 1;
  }

  if (reports.length > 1) {
    const cover = wb.addWorksheet("MIS Cover");
    cover.columns = [{ width: 28 }, { width: 46 }, { width: 4 }, { width: 4 }, { width: 4 }, { width: 4 }];
    const brand = cover.addRow(["FINVANTA"]);
    const title = cover.addRow(["MANAGEMENT INFORMATION PACK"]);
    const company = cover.addRow([ctx.company.name]);
    const reportingPeriod = cover.addRow([`Reporting period: ${period}  |  Currency: ${currency}`]);
    const attribution = cover.addRow([`Created by FINVANTA  |  Generated ${generatedLabel} IST`]);
    for (let row = 1; row <= 5; row++) cover.mergeCells(row, 1, row, 6);
    brand.height = 32;
    brand.getCell(1).font = { bold: true, size: 20, color: { argb: "FFFFFFFF" } };
    brand.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; });
    title.height = 34;
    title.getCell(1).font = { bold: true, size: 18, color: { argb: NAVY } };
    company.height = 26;
    company.getCell(1).font = { bold: true, size: 15, color: { argb: ACCENT } };
    reportingPeriod.getCell(1).font = { size: 11, color: { argb: MUTED } };
    attribution.getCell(1).font = { size: 10, italic: true, color: { argb: MUTED } };

    cover.addRow([]);
    const contentsHeader = cover.addRow(["REPORT CONTENTS", "WORKSHEET"]);
    contentsHeader.height = 22;
    contentsHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
    contentsHeader.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; });
    reports.forEach((report, index) => {
      const row = cover.addRow([report.title, sheetNames[index]]);
      if (index % 2 === 1) row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } }; });
    });
    cover.addRow([]);
    const note = cover.addRow(["Management reporting output · Verify before statutory use"]);
    cover.mergeCells(note.number, 1, note.number, 6);
    note.getCell(1).font = { italic: true, size: 9, color: { argb: MUTED } };
    cover.views = [{ state: "frozen", ySplit: 7 }];
    cover.headerFooter.oddFooter = "&LCreated by FINVANTA&CPage &P of &N";
    cover.pageSetup.fitToPage = true;
    cover.pageSetup.fitToWidth = 1;
    cover.pageSetup.fitToHeight = 1;
  }

  for (const [index, r] of reports.entries()) {
    const ws = wb.addWorksheet(sheetNames[index]);
    const brand = ws.addRow(["FINVANTA · MANAGEMENT REPORTING"]);
    const company = ws.addRow([ctx.company.name]);
    const title = ws.addRow([r.title]);
    const reportingPeriod = ws.addRow([`Reporting period: ${period}  |  Currency: ${currency}`]);
    const attribution = ws.addRow([`Created by FINVANTA  |  Generated ${generatedLabel} IST`]);
    const columnCount = Math.max(1, r.columns.length);
    for (let row = 1; row <= 5; row++) {
      if (columnCount > 1) ws.mergeCells(row, 1, row, columnCount);
    }
    brand.height = 25;
    brand.getCell(1).font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    brand.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; });
    company.getCell(1).font = { bold: true, size: 12, color: { argb: ACCENT } };
    title.getCell(1).font = { bold: true, size: 13, color: { argb: NAVY } };
    reportingPeriod.getCell(1).font = { size: 10, color: { argb: MUTED } };
    attribution.getCell(1).font = { italic: true, size: 9, color: { argb: MUTED } };
    ws.addRow([]);

    const header = ws.addRow(r.columns.map((c) => c.label));
    header.height = 24;
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.border = { bottom: { style: "medium", color: { argb: ACCENT } } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    for (const [rowIndex, row] of r.rows.entries()) {
      const dataRow = ws.addRow(r.columns.map((c) => {
        const value = row[c.key];
        return (c.kind === "money" || c.kind === "num" || c.kind === "pct") && value !== "" && value !== null && Number.isFinite(Number(value)) ? Number(value) : value ?? "";
      }));
      if (rowIndex % 2 === 1) dataRow.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } }; });
      r.columns.forEach((column, columnIndex) => {
        const cell = dataRow.getCell(columnIndex + 1);
        if (column.kind === "money") cell.numFmt = "#,##0.00;[Red]-#,##0.00";
        if (column.kind === "pct") cell.numFmt = "0.0%";
        if (column.kind === "money" || column.kind === "num" || column.kind === "pct") cell.alignment = { horizontal: "right" };
      });
      const label = String(row.label ?? row.account ?? "");
      if (/\b(total|gross profit|net profit|ebitda|profit before tax)\b/i.test(label)) {
        dataRow.font = { bold: true };
        dataRow.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5EDF5" } }; });
      }
    }
    ws.columns = r.columns.map((column) => {
      const widest = Math.max(column.label.length, ...r.rows.map((row) => String(row[column.key] ?? "").length));
      return { key: column.key, width: Math.min(48, Math.max(14, widest + 3)) };
    });
    if (r.columns.length > 0) ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: r.columns.length } };
    ws.views = [{ state: "frozen", ySplit: 7 }];
    ws.headerFooter.oddFooter = "&LCreated by FINVANTA&CPage &P of &N&RManagement report";
    ws.pageSetup.orientation = r.columns.length > 6 ? "landscape" : "portrait";
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 0;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toPdf(r: Report) {
  const doc = new jsPDF({ orientation: r.columns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  doc.setFillColor(10, 19, 37); doc.rect(0, 0, doc.internal.pageSize.getWidth(), 56, "F");
  doc.setTextColor(255); doc.setFontSize(15); doc.text("FINVANTA", 36, 28); doc.setFontSize(9); doc.text(r.title, 36, 44);
  doc.setTextColor(90); doc.setFontSize(8); doc.text(r.subtitle, 36, 72);
  autoTable(doc, {
    startY: 82, head: [r.columns.map((c) => c.label)], body: r.rows.map((row) => r.columns.map((c) => cell(row[c.key], c.kind))),
    styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: [14, 26, 48] },
    columnStyles: Object.fromEntries(r.columns.map((c, i) => [i, { halign: c.kind && c.kind !== "text" && c.kind !== "tone" ? "right" : "left" }])) as never,
    didDrawPage: () => { doc.setFontSize(7); doc.setTextColor(120); doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · FINVANTA · Analytical output — verify before statutory use`, 36, doc.internal.pageSize.getHeight() - 18); },
  });
  return Buffer.from(doc.output("arraybuffer"));
}

export async function GET(req: Request) {
  const a = await apiCtx(req, { needCompany: true }); if ("error" in a) return a.error;
  const u = new URL(req.url); const key = u.searchParams.get("report") ?? ""; const format = u.searchParams.get("format") ?? "csv";
  const params = Object.fromEntries(u.searchParams.entries());
  const isMisPack = key === "mis-pack" && format === "xlsx";
  const r = isMisPack ? null : await buildReport(a.ctx, key, params);
  if (!r && !isMisPack) return json({ error: "Unknown report" }, 404);
  await audit(a.ctx, "report.export", "report", key, { format });
  const base = `${isMisPack ? "FINVANTA-MIS" : key}-${a.ctx.fy.label.replace(/\W+/g, "")}`;
  if (format === "json" && r) return json({ title: r.title, subtitle: r.subtitle, columns: r.columns.map((c) => c.key), rows: r.rows });
  if (format === "xlsx") {
    const reports = isMisPack
      ? await Promise.all(MIS_PACK.map(async (reportKey) => {
          const report = await buildReport(a.ctx, reportKey);
          if (!report) throw new Error(`MIS pack report "${reportKey}" is unavailable.`);
          return report;
        }))
      : r ? [r] : [];
    return new Response(new Uint8Array(await toXlsx(reports, a.ctx)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
  }
  if (!r) return json({ error: "Unknown report" }, 404);
  if (format === "pdf") return new Response(new Uint8Array(toPdf(r)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
  return new Response(toCsv(r), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
}
