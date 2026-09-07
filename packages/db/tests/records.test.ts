import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { records, users } from "../src/schema";
import { createTestDb } from "./helpers/test-db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

beforeEach(async () => {
	ctx = await createTestDb();
	const [user] = await ctx.db
		.insert(users)
		.values({ loginId: "testuser", passwordHash: "a" })
		.returning();
	if (!user) throw new Error("テストユーザーの作成に失敗した");
	userId = user.id;
});

afterEach(async () => {
	await ctx.close();
});

test("記録を保存すると数値として取り出せる", async () => {
	const [inserted] = await ctx.db
		.insert(records)
		.values({
			userId,
			date: "2026-09-06",
			timeOfDay: "morning",
			physical: 3.5,
			mental: 4,
			comment: "よく寝られた",
		})
		.returning();

	// numeric は mode:"number" 指定により string ではなく number で返る
	expect(inserted?.physical).toBe(3.5);
	expect(inserted?.mental).toBe(4);
	expect(inserted?.date).toBe("2026-09-06");
	expect(inserted?.timeOfDay).toBe("morning");
});

test.each([
	0, 0.5, 2.5, 4.5, 5,
])("%s は有効な値として保存できる", async (value) => {
	const [inserted] = await ctx.db
		.insert(records)
		.values({
			userId,
			date: "2026-09-06",
			timeOfDay: "morning",
			physical: value,
			mental: value,
		})
		.returning();

	expect(inserted?.physical).toBe(value);
});

test.each([
	[0.3, "0.5 刻みでない"],
	[1.2, "0.5 刻みでない"],
	[-0.5, "下限未満"],
	[5.5, "上限超過"],
])("physical が %s なら拒否される（%s）", async (value) => {
	await expect(
		ctx.db.insert(records).values({
			userId,
			date: "2026-09-06",
			timeOfDay: "morning",
			physical: value,
			mental: 3,
		}),
	).rejects.toThrow();
});

test("mental にも同じ制約がかかる", async () => {
	await expect(
		ctx.db.insert(records).values({
			userId,
			date: "2026-09-06",
			timeOfDay: "morning",
			physical: 3,
			mental: 0.3,
		}),
	).rejects.toThrow();
});

test("同じ日の朝と夜は共存できる", async () => {
	await ctx.db.insert(records).values({
		userId,
		date: "2026-09-06",
		timeOfDay: "morning",
		physical: 4,
		mental: 4,
	});
	await ctx.db.insert(records).values({
		userId,
		date: "2026-09-06",
		timeOfDay: "evening",
		physical: 2,
		mental: 2.5,
	});

	const found = await ctx.db
		.select()
		.from(records)
		.where(eq(records.date, "2026-09-06"));

	expect(found).toHaveLength(2);
});

test("同じ日・同じタイミングは 1 件しか作れない", async () => {
	await ctx.db.insert(records).values({
		userId,
		date: "2026-09-06",
		timeOfDay: "morning",
		physical: 4,
		mental: 4,
	});

	await expect(
		ctx.db.insert(records).values({
			userId,
			date: "2026-09-06",
			timeOfDay: "morning",
			physical: 1,
			mental: 1,
		}),
	).rejects.toThrow();
});

test("time_of_day は morning / evening 以外を受け付けない", async () => {
	// TypeScript 側で弾かれる値なので、CHECK 制約が効いていることを SQL で直接確かめる
	await expect(
		ctx.db.execute(sql`
			insert into records (id, user_id, date, time_of_day, physical, mental)
			values ('seed-invalid', ${userId}, '2026-09-06', 'noon', 3, 3)
		`),
	).rejects.toThrow();
});

test("comment は 200 文字まで", async () => {
	await expect(
		ctx.db.insert(records).values({
			userId,
			date: "2026-09-06",
			timeOfDay: "morning",
			physical: 3,
			mental: 3,
			comment: "あ".repeat(201),
		}),
	).rejects.toThrow();
});

test("comment は省略できる", async () => {
	const [inserted] = await ctx.db
		.insert(records)
		.values({
			userId,
			date: "2026-09-06",
			timeOfDay: "evening",
			physical: 3,
			mental: 3,
		})
		.returning();

	expect(inserted?.comment).toBeNull();
});

test("ユーザーを削除すると記録も連鎖削除される", async () => {
	await ctx.db.insert(records).values({
		userId,
		date: "2026-09-06",
		timeOfDay: "morning",
		physical: 3,
		mental: 3,
	});

	await ctx.db.delete(users).where(eq(users.id, userId));

	expect(await ctx.db.select().from(records)).toHaveLength(0);
});

test("ユーザーと日付で絞り込める", async () => {
	await ctx.db.insert(records).values([
		{
			userId,
			date: "2026-09-05",
			timeOfDay: "morning",
			physical: 3,
			mental: 3,
		},
		{
			userId,
			date: "2026-09-06",
			timeOfDay: "morning",
			physical: 4,
			mental: 4,
		},
	]);

	const found = await ctx.db
		.select()
		.from(records)
		.where(and(eq(records.userId, userId), eq(records.date, "2026-09-06")));

	expect(found).toHaveLength(1);
	expect(found[0]?.physical).toBe(4);
});
