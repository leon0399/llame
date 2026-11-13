-- Drizzle v1 reserializes equivalent timestamp precision, indexes and CHECK
-- expressions from the converted v0 snapshots. Applying its generated DDL to
-- a replayed disposable database produced an identical pg_dump --schema-only
-- to the unmodified database. Keep the generated snapshot but avoid rebuilding
-- unchanged indexes and constraints or rewriting populated tables.
SELECT 1;
