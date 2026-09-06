import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { sessions, users } from "../src/schema";
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

function newSessionId(): string {
	return randomBytes(32).toString("hex");
}

test("セッションを保存して取り出せる", async () => {
	const id = newSessionId();
	const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

	await ctx.db.insert(sessions).values({ id, userId, expiresAt });

	const found = await ctx.db.select().from(sessions).where(eq(sessions.id, id));

	expect(found).toHaveLength(1);
	expect(found[0]?.userId).toBe(userId);
	expect(found[0]?.expiresAt.getTime()).toBe(expiresAt.getTime());
});

test("存在しないユーザーのセッションは作れない", async () => {
	await expect(
		ctx.db.insert(sessions).values({
			id: newSessionId(),
			userId: "nonexistent",
			expiresAt: new Date(),
		}),
	).rejects.toThrow();
});

test("ユーザーを削除するとセッションも連鎖削除される", async () => {
	await ctx.db
		.insert(sessions)
		.values({ id: newSessionId(), userId, expiresAt: new Date() });

	await ctx.db.delete(users).where(eq(users.id, userId));

	const remaining = await ctx.db.select().from(sessions);
	expect(remaining).toHaveLength(0);
});
