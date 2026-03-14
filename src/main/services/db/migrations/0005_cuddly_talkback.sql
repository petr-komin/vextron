CREATE TABLE "ai_blacklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"pattern_type" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_blacklist_pattern_type_idx" ON "ai_blacklist" USING btree ("pattern","pattern_type");