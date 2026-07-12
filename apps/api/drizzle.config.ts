import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({
  path: '.env.local',
});

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  migrations: {
    // Timestamp-prefixed filenames so parallel branches don't collide on the
    // next sequential number (0000–0023 predate this and stay index-prefixed;
    // ordering comes from meta/_journal.json, not filenames).
    prefix: 'timestamp',
  },
  dbCredentials: {
    // biome-ignore lint: Forbidden non-null assertion.
    url: process.env.POSTGRES_URL!,
  },
});
