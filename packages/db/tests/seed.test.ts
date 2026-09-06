import { afterEach, beforeEach, expect, test } from "vitest";
import { records, users } from "../src/schema";
import { seedDatabase } from "../src/seed";
import { createTestDb } from "./helpers/test-db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
	ctx = await createTestDb();
});

afterEach(async () => {
	await ctx.close();
});

test("テストユーザーと記録を作る", async () => {
	const result = await seedDatabase(ctx.db, { days: 10 });

	const [user] = await ctx.db.select().from(users);
	expect(user?.loginId).toBe("testuser");
	expect(result.userId).toBe(user?.id);
	expect(result.recordCount).toBeGreaterThan(0);
});

test("欠損日を含むので朝夜が揃わない日がある", async () => {
	await seedDatabase(ctx.db, { days: 30 });

	const all = await ctx.db.select().from(records);
	const byDate = new Map<string, number>();
	for (const r of all) {
		byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
	}

	// 朝夜そろった日と、そうでない日の両方が存在すること
	const counts = [...byDate.values()];
	expect(counts).toContain(2);
	expect(counts.some((c) => c < 2)).toBe(true);
	expect(byDate.size).toBeLessThan(30);
});

test("生成される値は全て 0.5 刻みで 0〜5 に収まる", async () => {
	await seedDatabase(ctx.db, { days: 30 });

	for (const r of await ctx.db.select().from(records)) {
		for (const value of [r.physical, r.mental]) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(5);
			expect(value * 2).toBe(Math.round(value * 2));
		}
	}
});

test("二度実行しても失敗しない", async () => {
	await seedDatabase(ctx.db, { days: 5 });
	await seedDatabase(ctx.db, { days: 5 });

	expect(await ctx.db.select().from(users)).toHaveLength(1);
});
