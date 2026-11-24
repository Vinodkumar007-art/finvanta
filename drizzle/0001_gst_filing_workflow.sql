CREATE TABLE "gst_filing_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period" text NOT NULL,
	"gstin" text NOT NULL,
	"payload" jsonb NOT NULL,
	"review_notes" jsonb,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"gsp_draft_id" text,
	"gsp_response" jsonb,
	"arn" text,
	"filed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_filing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_filing_otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"salt" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gst_filing_drafts" ADD CONSTRAINT "gst_filing_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_filing_drafts" ADD CONSTRAINT "gst_filing_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_filing_drafts" ADD CONSTRAINT "gst_filing_drafts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_filing_events" ADD CONSTRAINT "gst_filing_events_draft_id_gst_filing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."gst_filing_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_filing_events" ADD CONSTRAINT "gst_filing_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_filing_events" ADD CONSTRAINT "gst_filing_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_filing_otp_challenges" ADD CONSTRAINT "gst_filing_otp_challenges_draft_id_gst_filing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."gst_filing_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_filing_otp_challenges" ADD CONSTRAINT "gst_filing_otp_challenges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_filing_otp_challenges" ADD CONSTRAINT "gst_filing_otp_challenges_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gst_filing_company_period_idx" ON "gst_filing_drafts" USING btree ("company_id","period");--> statement-breakpoint
CREATE INDEX "gst_filing_status_idx" ON "gst_filing_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gst_filing_events_draft_idx" ON "gst_filing_events" USING btree ("draft_id","created_at");--> statement-breakpoint
CREATE INDEX "gst_filing_otp_draft_created_idx" ON "gst_filing_otp_challenges" USING btree ("draft_id","created_at");--> statement-breakpoint
CREATE INDEX "gst_filing_otp_company_created_idx" ON "gst_filing_otp_challenges" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE FUNCTION prevent_gst_filing_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'GST filing audit events are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER gst_filing_events_append_only
BEFORE UPDATE OR DELETE ON "gst_filing_events"
FOR EACH ROW EXECUTE FUNCTION prevent_gst_filing_event_mutation();--> statement-breakpoint
CREATE FUNCTION protect_gst_filing_draft_source() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'GST filing drafts cannot be deleted';
  END IF;
  IF OLD.company_id IS DISTINCT FROM NEW.company_id
    OR OLD.period IS DISTINCT FROM NEW.period
    OR OLD.gstin IS DISTINCT FROM NEW.gstin
    OR OLD.payload IS DISTINCT FROM NEW.payload
    OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'GST filing draft source data is immutable';
  END IF;
  IF OLD.review_notes IS NOT NULL AND OLD.review_notes IS DISTINCT FROM NEW.review_notes THEN
    RAISE EXCEPTION 'GST filing review notes are immutable once written';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER gst_filing_draft_source_immutable
BEFORE UPDATE OR DELETE ON "gst_filing_drafts"
FOR EACH ROW EXECUTE FUNCTION protect_gst_filing_draft_source();