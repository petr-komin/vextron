CREATE INDEX "messages_folder_date_idx" ON "messages" USING btree ("folder_id","date");--> statement-breakpoint
CREATE INDEX "messages_account_id_idx" ON "messages" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "messages_folder_uid_idx" ON "messages" USING btree ("folder_id","uid");