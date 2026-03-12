CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"imap_host" varchar(255) NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"smtp_host" varchar(255) NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"username" varchar(255) NOT NULL,
	"encrypted_password" text NOT NULL,
	"auth_type" varchar(20) DEFAULT 'password' NOT NULL,
	"security" varchar(20) DEFAULT 'tls' NOT NULL,
	"smtp_security" varchar(20) DEFAULT 'starttls' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"color" varchar(7) DEFAULT '#4A90D9' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(20) NOT NULL,
	"api_key" text,
	"model" varchar(100) NOT NULL,
	"base_url" varchar(500),
	"embedding_model" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) DEFAULT '' NOT NULL,
	"frequency" integer DEFAULT 0 NOT NULL,
	"last_contacted" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"name" varchar(100) NOT NULL,
	"color" varchar(7) DEFAULT '#808080' NOT NULL,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"path" text NOT NULL,
	"type" varchar(20) DEFAULT 'custom' NOT NULL,
	"delimiter" varchar(5) DEFAULT '/' NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"uid_validity" integer,
	"uid_next" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"folder_id" integer NOT NULL,
	"message_id" varchar(512),
	"uid" integer NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"from_address" varchar(512) DEFAULT '' NOT NULL,
	"from_name" varchar(255) DEFAULT '' NOT NULL,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"date" timestamp,
	"body_text" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"preview" varchar(300) DEFAULT '' NOT NULL,
	"flags" jsonb DEFAULT '{"seen":false,"flagged":false,"answered":false,"draft":false,"deleted":false}'::jsonb NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"raw_headers" jsonb,
	"ai_category" varchar(100),
	"ai_priority" varchar(10),
	"ai_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;