import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, expect, test } from "vitest";

let client: PGlite | undefined;

afterEach(async () => {
	await client?.close();
	client = undefined;
});

test("PGlite 上で Drizzle がクエリを実行できる", async () => {
	client = new PGlite();
	const db = drizzle(client);

	const result = await db.execute(sql`select 1 as value`);

	expect(result.rows[0]).toEqual({ value: 1 });
});

test("PGlite は PostgreSQL の numeric と CHECK 制約を備えている", async () => {
	client = new PGlite();
	const db = drizzle(client);

	await db.execute(
		sql`create table probe (v numeric(2,1) check (mod(v * 10, 5) = 0))`,
	);
	await db.execute(sql`insert into probe (v) values (3.5)`);

	await expect(
		db.execute(sql`insert into probe (v) values (0.3)`),
	).rejects.toThrow();
});
