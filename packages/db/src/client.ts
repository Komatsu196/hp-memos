import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
	if (!connectionString) {
		throw new Error("DATABASE_URL が設定されていない");
	}

	const client = postgres(connectionString, {
		// pgBouncer の transaction mode では prepared statement が使えない。
		// Supabase / Neon のプーラー経由の接続に備えて既定で無効化する
		prepare: false,
	});

	return drizzle(client, { schema });
}

let cached: Database | undefined;

/**
 * process.env.DATABASE_URL を使う遅延初期化シングルトン。
 * モジュール読み込み時ではなく最初の呼び出し時に接続を作るため、
 * 環境変数が未設定でもインポート自体は失敗しない。
 *
 * サーバー側は container.ts で createDb() を 1 回呼び、
 * 依存注入で配る（api-architecture.mdx を参照）。この関数は
 * スクリプトなど DI の外から使う場合の入口。
 */
export function getDb(): Database {
	cached ??= createDb(process.env.DATABASE_URL ?? "");
	return cached;
}
