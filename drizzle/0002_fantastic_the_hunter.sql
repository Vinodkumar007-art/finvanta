CREATE TABLE "sales_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"fy_id" uuid NOT NULL,
	"type" text NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid NOT NULL,
	"date" date NOT NULL,
	"valid_until" date,
	"place_of_supply" text NOT NULL,
	"items" jsonb NOT NULL,
	"taxable" numeric(20, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(20, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(20, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(20, 2) DEFAULT '0' NOT NULL,
	"total" numeric(20, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"converted_invoice_id" uuid,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_fy_id_financial_years_id_fk" FOREIGN KEY ("fy_id") REFERENCES "public"."financial_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_converted_invoice_id_invoices_id_fk" FOREIGN KEY ("converted_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_documents_company_status_idx" ON "sales_documents" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_documents_number_uq" ON "sales_documents" USING btree ("company_id","fy_id","type","number");