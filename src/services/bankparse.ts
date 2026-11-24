const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

export function parseDate(s: string): string | null {
  const t = s.trim(); let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(t))) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  if ((m = /^(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]+(\d{2,4})/.exec(t))) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; const mo = MONTHS[m[2].toLowerCase()]; return mo ? `${y}-${mo}-${m[1].padStart(2, "0")}` : null; }
  return null;
}
export const num = (s: string | undefined) => { const v = (s ?? "").replace(/[,₹\s]/g, "").replace(/^\((.*)\)$/, "-$1"); return v === "" || isNaN(Number(v)) ? 0 : Number(v); };

const RULES: [RegExp, string][] = [[/salary|payroll/i, "Payroll"], [/rent/i, "Rent"], [/gst|cbdt|tds|income tax|challan/i, "Taxes"], [/emi|loan|interest/i, "Loan & interest"], [/swiggy|zomato|food|lunch|restaurant/i, "Meals"], [/electric|water|internet|broadband|telecom|airtel|jio/i, "Utilities"], [/charge|fee|commission/i, "Bank charges"], [/neft cr|rtgs cr|imps cr|upi cr|received|inv /i, "Customer receipts"], [/neft dr|rtgs dr|vendor|supplier|purchase/i, "Vendor payments"], [/atm|cash wdl|withdrawal/i, "Cash withdrawal"]];
export const categorise = (d: string) => RULES.find(([r]) => r.test(d))?.[1] ?? "Uncategorised";

