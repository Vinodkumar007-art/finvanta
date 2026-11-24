import {
  pgTable, uuid, text, timestamp, numeric, integer, boolean, jsonb, date, index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";
import type { GstDraft } from "@/engines/gst-filing";
import type { GstReviewNotes } from "@/services/gst-filing-review";

const id = () => uuid("id").primaryKey().defaultRandom();
const money = (name: string) => numeric(name, { precision: 20, scale: 2 }).notNull().default("0");
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

/* ---------- Identity, tenancy, access ---------- */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  mfaSecret: text("mfa_secret"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const blogPosts = pgTable("blog_posts", {
  id: id(),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: deletedAt(),
}, (t) => [
  index("blog_posts_author_created_idx").on(t.authorId, t.createdAt, t.id),
  index("blog_posts_created_idx").on(t.createdAt, t.id),
]);

export const blogComments = pgTable("blog_comments", {
  id: id(),
  postId: uuid("post_id").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [
  index("blog_comments_post_created_idx").on(t.postId, t.createdAt, t.id),
  index("blog_comments_author_idx").on(t.authorId),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const oauthAccounts = pgTable("oauth_accounts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerUserId: text("provider_user_id").notNull(),
  providerEmail: text("provider_email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  tokenType: text("token_type"),
  scope: text("scope"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("oauth_accounts_provider_subject_idx").on(t.provider, t.providerUserId),
  uniqueIndex("oauth_accounts_provider_user_idx").on(t.provider, t.userId),
]);

export const oauthStates = pgTable("oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  provider: text("provider").notNull(),
  verifierEncrypted: text("verifier_encrypted").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("oauth_states_expiry_idx").on(t.expiresAt)]);

export const passwordResets = pgTable("password_resets", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const organisations = pgTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("community"),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const memberships = pgTable("memberships", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("viewer"), // owner | admin | accountant | analyst | viewer
  createdAt: createdAt(),
}, (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)]);

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("dark"),
  accent: text("accent").notNull().default("#10b981"),
  dashboardLayout: jsonb("dashboard_layout").$type<string[]>(),
  extra: jsonb("extra").$type<Record<string, unknown>>().default({}),
});

/* ---------- Companies & accounting ---------- */
export const companies = pgTable("companies", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  tan: text("tan"),
  stateCode: text("state_code").notNull().default("27"),
  baseCurrency: text("base_currency").notNull().default("INR"),
  address: text("address"),
  fyStartMonth: integer("fy_start_month").notNull().default(4),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [index("companies_org_idx").on(t.orgId)]);

export const financialYears = pgTable("financial_years", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: text("status").notNull().default("open"), // open | closed
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("fy_company_label").on(t.companyId, t.label)]);

export const accounts = pgTable("accounts", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // asset | liability | equity | income | expense
  role: text("role").notNull().default("other"),
  groupName: text("group_name").notNull().default(""),
  openingBalance: money("opening_balance"), // signed: debit positive
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [uniqueIndex("accounts_company_code").on(t.companyId, t.code), index("accounts_company_idx").on(t.companyId)]);

export const costCentres = pgTable("cost_centres", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Department"),
  deletedAt: deletedAt(),
});

export const vouchers = pgTable("vouchers", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fyId: uuid("fy_id").notNull().references(() => financialYears.id),
  type: text("type").notNull(), // journal|payment|receipt|contra|sales|purchase|debit_note|credit_note
  number: text("number").notNull(),
  date: date("date").notNull(),
  narration: text("narration").notNull().default(""),
  currency: text("currency").notNull().default("INR"),
  fxRate: numeric("fx_rate", { precision: 18, scale: 6 }).notNull().default("1"),
  status: text("status").notNull().default("posted"), // posted | reversed
  reversalOf: uuid("reversal_of"),
  source: text("source").notNull().default("manual"), // manual|invoice|payment|bank|document|depreciation|ai
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex("vouchers_number_uq").on(t.companyId, t.fyId, t.type, t.number),
  index("vouchers_company_date_idx").on(t.companyId, t.date),
]);

export const voucherLines = pgTable("voucher_lines", {
  id: id(),
  voucherId: uuid("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  debit: money("debit"),
  credit: money("credit"),
  costCentreId: uuid("cost_centre_id").references(() => costCentres.id),
  partyId: uuid("party_id"),
  narration: text("narration"),
}, (t) => [index("vlines_voucher_idx").on(t.voucherId), index("vlines_account_idx").on(t.accountId)]);

/* ---------- Parties, invoices, payments ---------- */
export const parties = pgTable("parties", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // customer | vendor | deductee
  name: text("name").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  email: text("email"),
  phone: text("phone"),
  stateCode: text("state_code").notNull().default("27"),
  creditLimit: money("credit_limit"),
  creditDays: integer("credit_days").notNull().default(30),
  deducteeType: text("deductee_type").default("company"), // individual | company
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [index("parties_company_kind_idx").on(t.companyId, t.kind)]);

export type InvoiceItem = { description: string; hsn: string; qty: number; rate: string; gstRate: number; inventoryItemId?: string };
export const invoices = pgTable("invoices", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fyId: uuid("fy_id").notNull().references(() => financialYears.id),
  kind: text("kind").notNull(), // sales | purchase
  number: text("number").notNull(),
  partyId: uuid("party_id").notNull().references(() => parties.id),
  date: date("date").notNull(),
  dueDate: date("due_date").notNull(),
  placeOfSupply: text("place_of_supply").notNull(),
  items: jsonb("items").$type<InvoiceItem[]>().notNull(),
  taxable: money("taxable"),
  cgst: money("cgst"),
  sgst: money("sgst"),
  igst: money("igst"),
  total: money("total"),
  paid: money("paid"),
  status: text("status").notNull().default("pending_approval"), // pending_approval|approved|partially_paid|paid|cancelled
  voucherId: uuid("voucher_id").references(() => vouchers.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [index("invoices_company_idx").on(t.companyId, t.kind), uniqueIndex("invoices_number_uq").on(t.companyId, t.kind, t.number)]);

export type SalesDocumentType = "quotation" | "proforma" | "sales_order" | "delivery_challan";
export const salesDocuments = pgTable("sales_documents", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fyId: uuid("fy_id").notNull().references(() => financialYears.id),
  type: text("type").$type<SalesDocumentType>().notNull(),
  number: text("number").notNull(),
  partyId: uuid("party_id").notNull().references(() => parties.id),
  date: date("date").notNull(),
  validUntil: date("valid_until"),
  placeOfSupply: text("place_of_supply").notNull(),
  items: jsonb("items").$type<InvoiceItem[]>().notNull(),
  taxable: money("taxable"),
  cgst: money("cgst"),
  sgst: money("sgst"),
  igst: money("igst"),
  total: money("total"),
  status: text("status").notNull().default("draft"), // draft | converted | cancelled
  convertedInvoiceId: uuid("converted_invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [
  index("sales_documents_company_status_idx").on(t.companyId, t.status),
  uniqueIndex("sales_documents_number_uq").on(t.companyId, t.fyId, t.type, t.number),
]);

export const gstFilingDrafts = pgTable("gst_filing_drafts", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  period: text("period").notNull(),
  gstin: text("gstin").notNull(),
  payload: jsonb("payload").$type<GstDraft>().notNull(),
  reviewNotes: jsonb("review_notes").$type<GstReviewNotes>(),
  status: text("status").notNull().default("DRAFT"),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  gspDraftId: text("gsp_draft_id"),
  gspResponse: jsonb("gsp_response").$type<Record<string, unknown>>(),
  arn: text("arn"),
  filedAt: timestamp("filed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("gst_filing_company_period_idx").on(t.companyId, t.period), index("gst_filing_status_idx").on(t.status)]);

export const gstFilingOtpChallenges = pgTable("gst_filing_otp_challenges", {
  id: id(),
  draftId: uuid("draft_id").notNull().references(() => gstFilingDrafts.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  requestedBy: uuid("requested_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  salt: text("salt").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("gst_filing_otp_draft_created_idx").on(t.draftId, t.createdAt),
  index("gst_filing_otp_company_created_idx").on(t.companyId, t.createdAt),
]);

export const gstFilingEvents = pgTable("gst_filing_events", {
  id: id(),
  draftId: uuid("draft_id").notNull().references(() => gstFilingDrafts.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("gst_filing_events_draft_idx").on(t.draftId, t.createdAt)]);

export const payments = pgTable("payments", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  kind: text("kind").notNull(), // receipt | payment
  amount: money("amount"),
  date: date("date").notNull(),
  mode: text("mode").notNull().default("bank"),
  reference: text("reference"),
  voucherId: uuid("voucher_id").references(() => vouchers.id),
  createdAt: createdAt(),
});

export const reminders = pgTable("reminders", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  message: text("message").notNull(),
  channel: text("channel").notNull().default("drafted"), // drafted (copy/mailto) – no email provider claimed
  createdAt: createdAt(),
});

/* ---------- Banking ---------- */
export const bankAccounts = pgTable("bank_accounts", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  bankName: text("bank_name").notNull(),
  last4: text("last4"),
  ledgerAccountId: uuid("ledger_account_id").references(() => accounts.id),
  currency: text("currency").notNull().default("INR"),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const bankTransactions = pgTable("bank_transactions", {
  id: id(),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  description: text("description").notNull(),
  debit: money("debit"),
  credit: money("credit"),
  category: text("category"),
  hash: text("hash").notNull(),
  status: text("status").notNull().default("unmatched"), // unmatched|matched|duplicate|ignored|posted
  matchedVoucherId: uuid("matched_voucher_id").references(() => vouchers.id),
  batch: text("batch"),
  createdAt: createdAt(),
}, (t) => [index("btx_acct_idx").on(t.bankAccountId, t.date), index("btx_hash_idx").on(t.hash)]);

/* ---------- Inventory & assets ---------- */
export const inventoryItems = pgTable("inventory_items", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("Nos"),
  hsn: text("hsn"),
  reorderLevel: numeric("reorder_level", { precision: 18, scale: 3 }).notNull().default("0"),
  deletedAt: deletedAt(),
}, (t) => [uniqueIndex("inv_sku_uq").on(t.companyId, t.sku)]);

export const inventoryMovements = pgTable("inventory_movements", {
  id: id(),
  itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  kind: text("kind").notNull(), // in | out
  qty: numeric("qty", { precision: 18, scale: 3 }).notNull(),
  rate: numeric("rate", { precision: 18, scale: 4 }).notNull(),
  note: text("note"),
});

export const fixedAssets = pgTable("fixed_assets", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Plant & Machinery"),
  purchaseDate: date("purchase_date").notNull(),
  cost: money("cost"),
  salvage: money("salvage"),
  lifeYears: integer("life_years").notNull().default(5),
  method: text("method").notNull().default("SLM"), // SLM | WDV
  wdvRate: numeric("wdv_rate", { precision: 6, scale: 3 }).default("15"),
  accumulated: money("accumulated"),
  deletedAt: deletedAt(),
});

/* ---------- Tax & compliance ---------- */
export const tdsSections = pgTable("tds_sections", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  section: text("section").notNull(),
  description: text("description").notNull(),
  rateIndividual: numeric("rate_individual", { precision: 6, scale: 3 }).notNull(),
  rateOther: numeric("rate_other", { precision: 6, scale: 3 }).notNull(),
  singleThreshold: money("single_threshold"),
  annualThreshold: money("annual_threshold"),
}, (t) => [uniqueIndex("tds_sec_uq").on(t.companyId, t.section)]);

export const tdsEntries = pgTable("tds_entries", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  deducteeId: uuid("deductee_id").notNull().references(() => parties.id),
  section: text("section").notNull(),
  date: date("date").notNull(),
  gross: money("gross"),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  tds: money("tds"),
  challanId: uuid("challan_id"),
  voucherId: uuid("voucher_id").references(() => vouchers.id),
  createdAt: createdAt(),
});

// e-invoice, e-way bill, challans, Form 16/16A, notices, GST calendar items. NEVER implies statutory submission.
export const complianceRecords = pgTable("compliance_records", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // einvoice | eway | challan | form16 | form16a | notice | return_draft
  ref: text("ref").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("draft"), // draft | ready | recorded_by_user
  dueDate: date("due_date"),
  createdAt: createdAt(),
}, (t) => [index("comp_company_type_idx").on(t.companyId, t.type)]);

/* ---------- Analysis, FP&A, models, credit ---------- */
export const financialStatements = pgTable("financial_statements", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  kind: text("kind").notNull().default("annual"),
  periodEnd: date("period_end").notNull(),
  data: jsonb("data").$type<Record<string, number>>().notNull(),
  source: text("source").notNull().default("manual"), // manual | ledger | import | demo
  createdAt: createdAt(),
});

export const budgets = pgTable("budgets", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fyId: uuid("fy_id").notNull().references(() => financialYears.id),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("annual"), // annual | department | project
  department: text("department"),
  status: text("status").notNull().default("draft"), // draft | submitted | approved | rejected
  submittedBy: uuid("submitted_by").references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const budgetLines = pgTable("budget_lines", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  amounts: jsonb("amounts").$type<string[]>().notNull(), // 12 months from FY start
});

export const kpis = pgTable("kpis", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  formula: text("formula").notNull(), // expression over ledger variables
  target: numeric("target", { precision: 20, scale: 4 }),
  direction: text("direction").notNull().default("higher"),
  unit: text("unit").notNull().default(""),
});

export const models = pgTable("models", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // dcf | ddm | lbo | breakeven | headcount | credit | forecast | report
  assumptions: jsonb("assumptions").$type<Record<string, unknown>>().notNull(),
  outputs: jsonb("outputs").$type<Record<string, unknown>>().default({}),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const scheduledReports = pgTable("scheduled_reports", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  report: text("report").notNull(),
  frequency: text("frequency").notNull().default("monthly"),
  format: text("format").notNull().default("xlsx"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* ---------- Markets & portfolios ---------- */
export const portfolios = pgTable("portfolios", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("tracking"), // tracking | paper (simulated, no live trading)
  currency: text("currency").notNull().default("INR"),
  benchmark: text("benchmark"),
  targets: jsonb("targets").$type<Record<string, number>>().default({}),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const portfolioTransactions = pgTable("portfolio_transactions", {
  id: id(),
  portfolioId: uuid("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  name: text("name"),
  assetClass: text("asset_class").notNull().default("equity"), // equity|etf|mutual_fund|bond|other
  sector: text("sector"),
  kind: text("kind").notNull(), // buy | sell | dividend
  date: date("date").notNull(),
  qty: numeric("qty", { precision: 20, scale: 6 }).notNull().default("0"),
  price: numeric("price", { precision: 20, scale: 4 }).notNull().default("0"),
  fees: money("fees"),
  createdAt: createdAt(),
}, (t) => [index("ptx_portfolio_idx").on(t.portfolioId)]);

export const priceMarks = pgTable("price_marks", {
  portfolioId: uuid("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  price: numeric("price", { precision: 20, scale: 4 }).notNull(),
  source: text("source").notNull().default("user-entered"),
  asOf: timestamp("as_of", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.portfolioId, t.symbol] })]);

export const watchlists = pgTable("watchlists", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  symbols: jsonb("symbols").$type<string[]>().notNull().default([]),
});

export const priceAlerts = pgTable("price_alerts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  condition: text("condition").notNull(), // above | below
  price: numeric("price", { precision: 20, scale: 4 }).notNull(),
  status: text("status").notNull().default("active"),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const savedScreeners = pgTable("saved_screeners", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<Record<string, string>>().notNull(),
});

export const chartTemplates = pgTable("chart_templates", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
});

export const marketCache = pgTable("market_cache", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").notNull(),
  provider: text("provider").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerFailures = pgTable("provider_failures", {
  id: id(),
  provider: text("provider").notNull(),
  endpoint: text("endpoint").notNull(),
  error: text("error").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- AI ---------- */
export const aiConversations = pgTable("ai_conversations", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull().default("New conversation"),
  agent: text("agent").notNull().default("cfo"),
  folder: text("folder"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: deletedAt(),
}, (t) => [index("aiconv_user_idx").on(t.userId, t.updatedAt)]);

export const aiMessages = pgTable("ai_messages", {
  id: id(),
  conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  createdAt: createdAt(),
}, (t) => [index("aimsg_conv_idx").on(t.conversationId, t.createdAt)]);

export const aiUsage = pgTable("ai_usage", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  mode: text("mode").notNull().default("llm"), // llm | engine
  createdAt: createdAt(),
});

export const aiProposals = pgTable("ai_proposals", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id"),
  kind: text("kind").notNull(), // journal_entry
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  resultRef: text("result_ref"),
  createdAt: createdAt(),
});

/* ---------- Documents, audit, notifications ---------- */
export const documents = pgTable("documents", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(),
  docType: text("doc_type").notNull().default("unclassified"),
  extractedText: text("extracted_text"),
  extracted: jsonb("extracted").$type<Record<string, unknown>>().default({}),
  status: text("status").notNull().default("uploaded"), // uploaded | extracted | needs_ocr | confirmed | posted | rejected
  voucherId: uuid("voucher_id").references(() => vouchers.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [index("docs_company_idx").on(t.companyId), index("docs_hash_idx").on(t.sha256)]);

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  companyId: uuid("company_id"),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  detail: jsonb("detail").$type<Record<string, unknown>>().default({}),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_org_at_idx").on(t.orgId, t.at)]);

export const notifications = pgTable("notifications", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  level: text("level").notNull().default("info"), // info | warning | critical
  href: text("href"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("notif_org_idx").on(t.orgId, t.createdAt)]);

export const calcLogs = pgTable("calc_logs", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  userId: uuid("user_id"),
  name: text("name").notNull(),
  record: jsonb("record").$type<Record<string, unknown>>().notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatRooms = pgTable("chat_rooms", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [index("chat_rooms_org_idx").on(t.orgId), uniqueIndex("chat_rooms_org_name_idx").on(t.orgId, t.name)]);

export const chatRoomMembers = pgTable("chat_room_members", {
  id: id(),
  roomId: uuid("room_id").notNull().references(() => chatRooms.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("chat_room_members_room_user_idx").on(t.roomId, t.userId), index("chat_room_members_user_idx").on(t.userId)]);

export const chatMessages = pgTable("chat_messages", {
  id: id(),
  roomId: uuid("room_id").notNull().references(() => chatRooms.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  clientMessageId: uuid("client_message_id").notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("chat_messages_idempotency_idx").on(t.roomId, t.userId, t.clientMessageId),
  index("chat_messages_room_created_idx").on(t.roomId, t.createdAt, t.id),
]);
