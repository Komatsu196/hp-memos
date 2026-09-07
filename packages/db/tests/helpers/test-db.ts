import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../src/schema";

const migrationsFolder = fileURLToPath(
	new URL("../../drizzle", import.meta.url),
);

/**
 * インメモリの PGlite を起動し、生成済みマイグレーションを適用した DB を返す。
 * 検証対象はスキーマ定義ではなく、本番に流れるのと同じ SQL。
 */
export async function createTestDb() {
	const client = new PGlite();
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder });
	return {
		db,
		close: () => client.close(),
	};
}
