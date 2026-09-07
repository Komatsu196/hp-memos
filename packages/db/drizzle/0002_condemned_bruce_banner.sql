CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"time_of_day" text NOT NULL,
	"physical" numeric(2, 1) NOT NULL,
	"mental" numeric(2, 1) NOT NULL,
	"comment" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_records_user_date_tod" UNIQUE("user_id","date","time_of_day"),
	CONSTRAINT "chk_records_time_of_day" CHECK ("records"."time_of_day" in ('morning', 'evening')),
	CONSTRAINT "chk_records_physical" CHECK ("records"."physical" >= 0 AND "records"."physical" <= 5 AND mod("records"."physical" * 10, 5) = 0),
	CONSTRAINT "chk_records_mental" CHECK ("records"."mental" >= 0 AND "records"."mental" <= 5 AND mod("records"."mental" * 10, 5) = 0)
);
--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_records_user_id_date" ON "records" USING btree ("user_id","date" DESC);