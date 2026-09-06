import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { users } from "../src/schema";
import { createTestDb } from "./helpers/test-db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
	ctx = await createTestDb();
});

afterEach(async () => {
	await ctx.close();
});

test("id と作成日時が自動で付与される", async () => {
	const [inserted] = await ctx.db
		.insert(users)
		.values({ loginId: "testuser", passwordHash: "hashed" })
		.returning();

	expect(inserted?.id).toMatch(/^[a-z0-9]{20,}$/);
	expect(inserted?.createdAt).toBeInstanceOf(Date);
	expect(inserted?.updatedAt).toBeInstanceOf(Date);
});

test("login_id は一意である", async () => {
	await ctx.db.insert(users).values({ loginId: "testuser", passwordHash: "a" });

	await expect(
		ctx.db.insert(users).values({ loginId: "testuser", passwordHash: "b" }),
	).rejects.toThrow();
});

test.each([
	["abc", "4 文字未満"],
	["a".repeat(33), "32 文字超過"],
	["has space", "空白を含む"],
	["ハイフン-入り", "英数字とアンダースコア以外"],
])("login_id %s は拒否される（%s）", async (loginId) => {
	await expect(
		ctx.db.insert(users).values({ loginId, passwordHash: "a" }),
	).rejects.toThrow();
});

test.each(["user", "a".repeat(32), "snake_case_1"])(
	"login_id %s は受け入れられる",
	async (loginId) => {
		const [inserted] = await ctx.db
			.insert(users)
			.values({ loginId, passwordHash: "a" })
			.returning();

		expect(inserted?.loginId).toBe(loginId);
	},
);

test("login_id で検索できる", async () => {
	await ctx.db.insert(users).values({ loginId: "findme", passwordHash: "a" });

	const found = await ctx.db
		.select()
		.from(users)
		.where(eq(users.loginId, "findme"));

	expect(found).toHaveLength(1);
});
