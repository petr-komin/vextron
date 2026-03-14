-- Enable pgvector extension (requires superuser or CREATE privilege)
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "message_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"model" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_embeddings" ADD CONSTRAINT "message_embeddings_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_embeddings_message_id_idx" ON "message_embeddings" USING btree ("message_id");--> statement-breakpoint
-- HNSW index for fast cosine similarity search
CREATE INDEX "message_embeddings_cosine_idx" ON "message_embeddings" USING hnsw ("embedding" vector_cosine_ops);
