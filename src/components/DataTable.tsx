"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Primitive = string | number | null | undefined;
type Row = Record<string, Primitive>;
type SortDirection = "ascending" | "descending";
type PageToken = number | "ellipsis";

export type Col<T extends object = Row> = {
  key: string;
  label: string;
  kind?: "text" | "money" | "num" | "pct" | "tone";
  dp?: number;
  width?: string;
  value?: (row: T) => unknown;
  href?: (row: T) => string | null;
};

interface DataTableProps<T extends object> {
  columns: Col<T>[];
  rows: T[];
  title?: string;
  searchable?: boolean;
  pageSize?: number;
  empty?: string;
  dense?: boolean;
  loading?: boolean;
  selectable?: boolean;
  getRowId?: (row: T, index: number) => string;
  renderBulkActions?: (selectedRows: readonly T[], clearSelection: () => void) => ReactNode;
  stickyFirstColumn?: boolean;
}

interface RowEntry<T extends object> {
  row: T;
  id: string;
  originalIndex: number;
}

interface TableRowProps<T extends object> {
  entry: RowEntry<T>;
  columns: Col<T>[];
  searchTerm: string;
  dense: boolean;
  selected: boolean;
  selectable: boolean;
  stickyFirstColumn: boolean;
  onToggleSelection: (id: string, selected: boolean) => void;
}

function readValue<T extends object>(row: T, column: Col<T>): unknown {
  return column.value ? column.value(row) : Reflect.get(row, column.key);
}

function formatValue<T extends object>(value: unknown, column: Col<T>): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.kind === "money" || column.kind === "num") {
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString("en-IN", {
        minimumFractionDigits: column.dp ?? (column.kind === "money" ? 2 : 0),
        maximumFractionDigits: column.dp ?? (column.kind === "money" ? 2 : 4),
      })
      : String(value);
  }
  if (column.kind === "pct") {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(column.dp ?? 1)}%` : String(value);
  }
  return String(value);
}

function highlightMatch(value: string, searchTerm: string): ReactNode {
  const term = searchTerm.toLocaleLowerCase();
  if (!term) return value;
  const text = value.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let offset = 0;
  let match = text.indexOf(term, offset);
  while (match !== -1) {
    if (match > offset) parts.push(value.slice(offset, match));
    parts.push(<mark key={`${match}-${offset}`} className="rounded bg-warn/30 text-fg">{value.slice(match, match + searchTerm.length)}</mark>);
    offset = match + searchTerm.length;
    match = text.indexOf(term, offset);
  }
  if (offset === 0) return value;
  if (offset < value.length) parts.push(value.slice(offset));
  return parts;
}

function rowIdentifier<T extends object>(row: T, index: number, getRowId?: (row: T, index: number) => string): string {
  if (getRowId) return getRowId(row, index);
  const id = Reflect.get(row, "id");
  return typeof id === "string" || typeof id === "number" ? String(id) : `row-${index}`;
}

function pageTokens(currentPage: number, pageCount: number): PageToken[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  if (currentPage <= 2) return [0, 1, 2, 3, "ellipsis", pageCount - 1];
  if (currentPage >= pageCount - 3) return [0, "ellipsis", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1];
  return [0, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", pageCount - 1];
}

function compareValues(left: unknown, right: unknown, direction: 1 | -1): number {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const bothNumeric = left !== "" && right !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  const comparison = bothNumeric
    ? leftNumber - rightNumber
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  return comparison * direction;
}

function TableRow<T extends object>({
  entry,
  columns,
  searchTerm,
  dense,
  selected,
  selectable,
  stickyFirstColumn,
  onToggleSelection,
}: TableRowProps<T>) {
  const { row, id, originalIndex } = entry;
  return (
    <tr>
      {selectable && (
        <td className={`${dense ? "!py-1" : ""} sticky left-0 z-10 bg-panel`}>
          <input
            type="checkbox"
            aria-label={`Select row ${originalIndex + 1}`}
            checked={selected}
            onChange={(event) => onToggleSelection(id, event.target.checked)}
          />
        </td>
      )}
      {columns.map((column, columnIndex) => {
        const rawValue = readValue(row, column);
        const displayValue = formatValue(rawValue, column);
        const numeric = column.kind === "money" || column.kind === "num" || column.kind === "pct";
        const tone = column.kind === "tone"
          ? (/matched|ok|paid|approved|posted|safe|pass|high|strong/i.test(displayValue) ? "text-up" : /missing|mismatch|overdue|fail|reject|critical|distress|duplicate|weak/i.test(displayValue) ? "text-down" : /pending|draft|warn|medium|grey/i.test(displayValue) ? "text-warn" : "")
          : "";
        const rowHref = column.href?.(row) ?? (columnIndex === 0 && typeof Reflect.get(row, "href") === "string" ? String(Reflect.get(row, "href")) : null);
        const content = rowHref
          ? <Link className="text-accent hover:underline" href={rowHref}>{highlightMatch(displayValue, searchTerm)}</Link>
          : highlightMatch(displayValue, searchTerm);
        const className = `${dense ? "!py-1" : ""} ${numeric ? "r num" : ""} ${tone} ${stickyFirstColumn && columnIndex === 0 ? `sticky z-10 bg-panel ${selectable ? "left-10" : "left-0"}` : ""}`;
        if (columnIndex === 0) {
          return <th key={column.key} scope="row" className={`!top-auto !text-left !font-normal !normal-case ${className}`}>{content}</th>;
        }
        return <td key={column.key} className={className}>{content}</td>;
      })}
    </tr>
  );
}

const MemoTableRow = memo(TableRow) as typeof TableRow;

export default function DataTable<T extends object = Row>({
  columns,
  rows,
  title = "table",
  searchable = true,
  pageSize = 25,
  empty = "No records.",
  dense = false,
  loading = false,
  selectable = false,
  getRowId,
  renderBulkActions,
  stickyFirstColumn = false,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);
  const safePageSize = Math.max(1, pageSize);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const entries = useMemo(
    () => rows.map((row, originalIndex) => ({ row, originalIndex, id: rowIdentifier(row, originalIndex, getRowId) })),
    [getRowId, rows],
  );
  const filtered = useMemo(() => {
    const searchTerm = debouncedQuery.toLocaleLowerCase();
    const matches = searchTerm
      ? entries.filter(({ row }) => columns.some((column) => {
        const value = readValue(row, column);
        return value !== null && value !== undefined && String(value).toLocaleLowerCase().includes(searchTerm);
      }))
      : entries;
    if (!sort) return matches;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return matches;
    return [...matches].sort((left, right) => {
      const compared = compareValues(readValue(left.row, column), readValue(right.row, column), sort.direction);
      return compared || left.originalIndex - right.originalIndex;
    });
  }, [columns, debouncedQuery, entries, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / safePageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const currentRows = useMemo(
    () => filtered.slice(currentPage * safePageSize, currentPage * safePageSize + safePageSize),
    [currentPage, filtered, safePageSize],
  );
  const selectedRows = useMemo(() => entries.filter((entry) => selectedIds.has(entry.id)).map((entry) => entry.row), [entries, selectedIds]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((entry) => selectedIds.has(entry.id));
  const someFilteredSelected = filtered.some((entry) => selectedIds.has(entry.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [allFilteredSelected, someFilteredSelected]);

  const toggleSelection = useCallback((id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleFilteredSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const entry of filtered) {
        if (allFilteredSelected) next.delete(entry.id);
        else next.add(entry.id);
      }
      return next;
    });
  };

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const exportCsv = () => {
    const escapeCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      columns.map((column) => escapeCell(column.label)).join(","),
      ...filtered.map(({ row }) => columns.map((column) => escapeCell(readValue(row, column))).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.replace(/\W+/g, "-").toLowerCase()}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const cycleSort = (key: string) => {
    setSort((current) => current?.key !== key
      ? { key, direction: 1 }
      : current.direction === 1 ? { key, direction: -1 } : null);
    setPage(0);
  };

  return (
    <div aria-busy={loading}>
      {selectable && selectedRows.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs" role="toolbar" aria-label="Bulk actions">
          <span>{selectedRows.length} selected</span>
          {renderBulkActions?.(selectedRows, clearSelection)}
          <button type="button" className="btn btn-sm" onClick={clearSelection}>Clear selection</button>
        </div>
      )}
      <div className="mb-2 flex items-center justify-between gap-2">
        {searchable
          ? <input type="search" aria-label={`Filter ${title}`} className="inp max-w-60" placeholder="Filter…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          : <span />}
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span>{filtered.length} rows</span>
          <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={loading || !filtered.length}>CSV</button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {selectable ? `${selectedRows.length} rows selected. ` : ""}
        {debouncedQuery ? `${filtered.length} matching rows.` : `${filtered.length} rows.`}
      </p>
      <div className="max-h-[560px] overflow-auto rounded-lg border border-line">
        <table className="tbl min-w-full" aria-label={title}>
          <caption className="sr-only">{title}</caption>
          {columns.some((column) => column.width) && (
            <colgroup>
              {selectable && <col style={{ width: "2.5rem" }} />}
              {columns.map((column) => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}
            </colgroup>
          )}
          <thead>
            <tr>
              {selectable && (
                <th scope="col" className="sticky left-0 z-20 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label={`Select all ${filtered.length} filtered rows`}
                    aria-checked={someFilteredSelected && !allFilteredSelected ? "mixed" : allFilteredSelected}
                    checked={allFilteredSelected}
                    disabled={loading || filtered.length === 0}
                    onChange={toggleFilteredSelection}
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`${column.kind && column.kind !== "text" && column.kind !== "tone" ? "r" : ""} ${stickyFirstColumn && column === columns[0] ? `sticky ${selectable ? "left-10" : "left-0"} z-20 bg-panel` : ""}`}
                  aria-sort={sort?.key === column.key ? (sort.direction === 1 ? "ascending" : "descending") : undefined}
                >
                  <button type="button" className="uppercase tracking-wider hover:text-fg" onClick={() => cycleSort(column.key)} aria-label={`Sort by ${column.label}`}>
                    {column.label}
                    <span aria-hidden="true">{sort?.key === column.key ? (sort.direction === 1 ? " ▲" : " ▼") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: Math.min(safePageSize, 5) }, (_, rowIndex) => (
              <tr key={`loading-${rowIndex}`} aria-hidden="true">
                {selectable && <td><span className="skeleton block h-4 w-4" /></td>}
                {columns.map((column) => <td key={column.key}><span className="skeleton block h-4" style={{ width: column.width ?? "70%" }} /></td>)}
              </tr>
            ))}
            {!loading && currentRows.length === 0 && (
              <tr><td colSpan={Math.max(1, columns.length + Number(selectable))} className="py-8 text-center text-muted">{debouncedQuery && rows.length ? "No matching records." : empty}</td></tr>
            )}
            {!loading && currentRows.map((entry) => (
              <MemoTableRow<T>
                key={entry.id}
                entry={entry}
                columns={columns}
                searchTerm={debouncedQuery}
                dense={dense}
                selected={selectedIds.has(entry.id)}
                selectable={selectable}
                stickyFirstColumn={stickyFirstColumn}
                onToggleSelection={toggleSelection}
              />
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <nav className="mt-2 flex flex-wrap items-center justify-end gap-1.5 text-xs" aria-label={`${title} pagination`}>
          <button className="btn btn-sm" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Prev</button>
          {pageTokens(currentPage, pageCount).map((token, index) => token === "ellipsis"
            ? <span key={`ellipsis-${index}`} className="px-1 text-muted" aria-hidden="true">…</span>
            : <button key={token} type="button" className="btn btn-sm min-w-8" aria-current={token === currentPage ? "page" : undefined} aria-label={`Page ${token + 1}`} onClick={() => setPage(token)}>{token + 1}</button>)}
          <button className="btn btn-sm" type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button>
        </nav>
      )}
    </div>
  );
}
