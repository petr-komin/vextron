ALTER TABLE "messages" ADD COLUMN "dedup_hash" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "messages_account_dedup_hash_idx" ON "messages" USING btree ("account_id","dedup_hash");