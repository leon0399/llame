-- Drizzle v1 reserializes equivalent timestamp precision, indexes and CHECK
-- expressions from the converted v0 snapshots. Applying its generated DDL to
-- a disposable replay of all 93 legacy migrations produced an identical
-- pg_dump --schema-only. Keep the generated snapshot without rebuilding
-- unchanged indexes and constraints or rewriting populated tables.
SELECT 1;