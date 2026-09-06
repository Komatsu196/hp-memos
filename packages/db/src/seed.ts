import { type ExtractTablesWithRelations, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";
import { records, users } from "./schema";
import type { TimeOfDay } from "./schema/records";

/**
 * ドライバを問わない Drizzle の DB ハンドル。
 * 本番の postgres.js（client.ts の Database）と、テストの PGlite の
 * どちらも受け取れるようにするため、具体的なドライバ型ではなく基底型を取る。
 */
export type SeedTarget = PgDatabase<
	PgQueryResultHKT,
	typeof schema,
	ExtractTablesWithRelations<typeof schema>
>;

const SEED_LOGIN_ID = "testuser";
// 認証の計画で本物のハッシュに差し替える。この値ではログインできない
const SEED_PASSWORD_HASH = "seed-placeholder-not-a-valid-hash";

/** 0〜5 の 0.5 刻みに丸める */
function toScale(value: number): number {
	return Math.min(5, Math.max(0, Math.round(value * 2) / 2));
}

function formatDate(date: Date): string {
	const iso = date.toISOString().split("T")[0];
	if (!iso) throw new Error("日付の整形に失敗した");
	return iso;
}

export async function seedDatabase(
	db: SeedTarget,
	options: { days?: number } = {},
): Promise<{ userId: string; recordCount: number }> {
	const days = options.days ?? 30;

	const existing = await db
		.select()
		.from(users)
		.where(eq(users.loginId, SEED_LOGIN_ID));

	const userId =
		existing[0]?.id ??
		(
			await db
				.insert(users)
				.values({ loginId: SEED_LOGIN_ID, passwordHash: SEED_PASSWORD_HASH })
				.returning()
		)[0]?.id;

	if (!userId) throw new Error("シードユーザーの作成に失敗した");

	await db.delete(records).where(eq(records.userId, userId));

	const rows: (typeof records.$inferInsert)[] = [];
	const today = new Date();

	for (let i = days - 1; i >= 0; i--) {
		// 7 日ごとに 1 日まるごと欠損させ、5 日ごとに夜だけ欠損させる。
		// グラフで線が切れる様子と、差分が出せない状態の両方を再現する
		if (i % 7 === 3) continue;
		const skipEvening = i % 5 === 1;

		const day = new Date(today);
		day.setDate(day.getDate() - i);
		const date = formatDate(day);

		// 朝は高め、夜は消耗して低め、という 1 日の形を作る
		const morningBase = 3 + Math.sin(i / 3) * 1.2;
		const drop = 1 + Math.random();

		const entries: {
			timeOfDay: TimeOfDay;
			physical: number;
			mental: number;
		}[] = [
			{
				timeOfDay: "morning",
				physical: toScale(morningBase),
				mental: toScale(morningBase + 0.5),
			},
		];
		if (!skipEvening) {
			entries.push({
				timeOfDay: "evening",
				physical: toScale(morningBase - drop),
				mental: toScale(morningBase - drop + 0.5),
			});
		}

		for (const entry of entries) {
			rows.push({
				userId,
				date,
				timeOfDay: entry.timeOfDay,
				physical: entry.physical,
				mental: entry.mental,
				comment: entry.timeOfDay === "evening" && i % 4 === 0 ? "疲れた" : null,
			});
		}
	}

	await db.insert(records).values(rows);

	return { userId, recordCount: rows.length };
}
