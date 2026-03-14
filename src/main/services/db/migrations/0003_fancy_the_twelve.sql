CREATE TABLE "image_allowlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "image_allowlist_domain_idx" ON "image_allowlist" USING btree ("domain");