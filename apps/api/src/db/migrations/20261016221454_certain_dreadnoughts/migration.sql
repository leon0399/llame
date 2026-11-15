ALTER TABLE "media_objects" ALTER COLUMN "width" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ALTER COLUMN "height" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ALTER COLUMN "model_media_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ALTER COLUMN "model_width" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ALTER COLUMN "model_height" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ALTER COLUMN "model_byte_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_shape" CHECK (("media_objects"."media_type" <> 'application/pdf'
        AND "media_objects"."width" IS NOT NULL AND "media_objects"."height" IS NOT NULL
        AND "media_objects"."model_media_type" IS NOT NULL AND "media_objects"."model_width" IS NOT NULL
        AND "media_objects"."model_height" IS NOT NULL AND "media_objects"."model_byte_size" IS NOT NULL
        AND "media_objects"."page_count" IS NULL)
      OR ("media_objects"."media_type" = 'application/pdf'
        AND "media_objects"."page_count" IS NOT NULL AND "media_objects"."page_count" BETWEEN 1 AND 100
        AND "media_objects"."width" IS NULL AND "media_objects"."height" IS NULL
        AND "media_objects"."model_media_type" IS NULL AND "media_objects"."model_width" IS NULL
        AND "media_objects"."model_height" IS NULL AND "media_objects"."model_byte_size" IS NULL));