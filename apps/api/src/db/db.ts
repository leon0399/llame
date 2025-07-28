import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const client = postgres(process.env.POSTGRES_URL!, {
  max: 1,
});
const db = drizzle(client);

export { db };
