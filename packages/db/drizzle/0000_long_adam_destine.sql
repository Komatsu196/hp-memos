CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"login_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_id_unique" UNIQUE("login_id"),
	CONSTRAINT "chk_users_login_id" CHECK ("users"."login_id" ~ '^[a-zA-Z0-9_]{4,32}$')
);
