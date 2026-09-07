import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { credentials, users } from "../src/schema";
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

test("公開鍵をバイト列のまま往復できる", async () => {
	const publicKey = new Uint8Array([1, 2, 3, 250, 251, 252]);

	await ctx.db.insert(credentials).values({
		userId,
		credentialId: "Y3JlZC0x",
		publicKey,
	});

	const [found] = await ctx.db.select().from(credentials);

	expect(Array.from(found?.publicKey ?? [])).toEqual(Array.from(publicKey));
});

test("counter と backed_up には既定値が入る", async () => {
	const [inserted] = await ctx.db
		.insert(credentials)
		.values({
			userId,
			credentialId: "Y3JlZC0y",
			publicKey: new Uint8Array([0]),
		})
		.returning();

	expect(inserted?.counter).toBe(0);
	expect(inserted?.backedUp).toBe(false);
	expect(inserted?.transports).toBeNull();
});

test("transports は文字列配列として保存できる", async () => {
	await ctx.db.insert(credentials).values({
		userId,
		credentialId: "Y3JlZC0z",
		publicKey: new Uint8Array([0]),
		transports: ["internal", "hybrid"],
	});

	const [found] = await ctx.db.select().from(credentials);

	expect(found?.transports).toEqual(["internal", "hybrid"]);
});

test("credential_id は一意である", async () => {
	await ctx.db.insert(credentials).values({
		userId,
		credentialId: "duplicate",
		publicKey: new Uint8Array([0]),
	});

	await expect(
		ctx.db.insert(credentials).values({
			userId,
			credentialId: "duplicate",
			publicKey: new Uint8Array([1]),
		}),
	).rejects.toThrow();
});

test("ユーザーを削除するとパスキーも連鎖削除される", async () => {
	await ctx.db.insert(credentials).values({
		userId,
		credentialId: "Y3JlZC00",
		publicKey: new Uint8Array([0]),
	});

	await ctx.db.delete(users).where(eq(users.id, userId));

	expect(await ctx.db.select().from(credentials)).toHaveLength(0);
});
