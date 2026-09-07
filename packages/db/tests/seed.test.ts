import dayjs from "dayjs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { records, users } from "../src/schema";
import { seedDatabase } from "../src/seed";
import { createTestDb } from "./helpers/test-db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
	ctx = await createTestDb();
});

afterEach(async () => {
	vi.useRealTimers();
	await ctx.close();
});

/**
 * ローカルの暦日と UTC の暦日が食い違う瞬間を返す。
 * UTC より東（JST など）なら現地の深夜、西なら現地の深夜手前がそれにあたる。
 * UTC ちょうどの環境では食い違いが起きないので undefined を返す。
 */
function instantWhereUtcDateDiffers(): Date | undefined {
	const offsetMinutes = -new Date().getTimezoneOffset();
	if (offsetMinutes === 0) return undefined;
	const base = dayjs().startOf("day");
	return offsetMinutes > 0
		? base.add(30, "minute").toDate()
		: base.add(23, "hour").add(30, "minute").toDate();
}

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

test("最新の記録日はローカル時刻の今日になる", async () => {
	await seedDatabase(ctx.db, { days: 3 });

	const all = await ctx.db.select().from(records);
	const latest = all
		.map((r) => r.date)
		.sort()
		.at(-1);

	expect(latest).toBe(dayjs().format("YYYY-MM-DD"));
});

test("UTC と暦日が食い違う時刻でも今日の日付で記録される", async () => {
	// toISOString() で整形すると、JST の午前 9 時前に実行した記録が
	// 前日の日付になる。その瞬間に時刻を固定して回帰を防ぐ
	const risky = instantWhereUtcDateDiffers();
	if (!risky) return; // UTC 環境では起こり得ない

	vi.useFakeTimers();
	vi.setSystemTime(risky);

	const expected = dayjs(risky).format("YYYY-MM-DD");
	expect(risky.toISOString().split("T")[0]).not.toBe(expected);

	await seedDatabase(ctx.db, { days: 3 });

	const all = await ctx.db.select().from(records);
	const latest = all
		.map((r) => r.date)
		.sort()
		.at(-1);

	expect(latest).toBe(expected);
});

test("日付は連続した暦日として並ぶ", async () => {
	await seedDatabase(ctx.db, { days: 4 });

	const all = await ctx.db.select().from(records);
	const dates = [...new Set(all.map((r) => r.date))].sort();

	for (const date of dates) {
		expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		// 生成対象は「今日から days-1 日前まで」の範囲に収まる
		expect(dayjs().diff(dayjs(date), "day")).toBeLessThan(4);
		expect(dayjs().diff(dayjs(date), "day")).toBeGreaterThanOrEqual(0);
	}
});

test("二度実行しても失敗しない", async () => {
	await seedDatabase(ctx.db, { days: 5 });
	await seedDatabase(ctx.db, { days: 5 });

	expect(await ctx.db.select().from(users)).toHaveLength(1);
});
