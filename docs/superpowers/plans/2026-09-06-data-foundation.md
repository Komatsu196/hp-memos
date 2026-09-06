# データ基盤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/db` を新規作成し、users / sessions / records / credentials の 4 テーブルを Drizzle スキーマ・マイグレーション・テスト付きで用意する。

**Architecture:** Drizzle ORM でテーブルごとに 1 ファイルのスキーマを定義し、`drizzle-kit generate` で SQL マイグレーションを生成する。テストは生成された SQL を PGlite（WASM 版 PostgreSQL）に適用してから実行するため、**本番で走るのと同じマイグレーション SQL** が検証対象になる。Docker は不要。

**Tech Stack:** Drizzle ORM / Drizzle Kit、PostgreSQL、PGlite（テスト）、postgres.js（実行時ドライバ）、Vitest、TypeScript strict、pnpm workspace

**Spec:**
- [`apps/docs/content/docs/design/db/`](../../../apps/docs/content/docs/design/db/index.mdx)（ER 図・テーブル定義・共通規約）
- [`apps/docs/content/docs/design/screens/`](../../../apps/docs/content/docs/design/screens/index.mdx)（スキーマに影響するスコープ決定）
- [`apps/docs/content/docs/architecture/monorepo-structure.mdx`](../../../apps/docs/content/docs/architecture/monorepo-structure.mdx)（`packages/db` の内部構成）

## Global Constraints

- パッケージマネージャは **pnpm**（`packageManager: pnpm@9.0.0`）。`npm` は使わない。
- TypeScript は **strict**。`any` 禁止。共有プリセット `@repo/typescript-config/base.json` は `noUncheckedIndexedAccess: true` を含むため、配列アクセスの結果は `undefined` の可能性がある型になる。
- Lint / Format は **Biome**。ルート `biome.json` を `extends` する。ルートの設定は **タブインデント・ダブルクォート**。
- 主キーは **CUID2**（`@paralleldrive/cuid2`）。ただし `sessions.id` のみ `crypto.randomBytes(32)` の hex。
- タイムスタンプは全て **`timestamptz`（UTC）**。全テーブルに `created_at`、変更可能テーブルに `updated_at`。
- 外部キーは全て **`ON DELETE CASCADE`**。
- 体力・気力は **0〜5 の 0.5 刻み（11 段階）**。型は `numeric(2, 1)`、Drizzle では `mode: "number"`。
- コミットメッセージは **Conventional Commits**（`<type>(<scope>): <subject>`）で、件名・本文とも **日本語**。

## この計画が下す決定（設計ドキュメントに記述がないもの）

| 決定 | 内容 | 理由 |
| --- | --- | --- |
| テスト用 DB | **PGlite**（`@electric-sql/pglite`）をインメモリで起動する | Docker なしでテストが完結し、実体は PostgreSQL そのものなので CHECK 制約・`numeric`・`bytea`・`text[]` がすべて本番と同じ挙動になる。個人開発で CI もローカルも同じ手順で回せる |
| 実行時ドライバ | **postgres.js**（`postgres`）+ `drizzle-orm/postgres-js` | Supabase / Neon の両方で使え、pgBouncer の transaction mode に `prepare: false` で対応できる |
| テスト時のマイグレーション | 生成済みの `drizzle/` を `migrate()` で適用する | スキーマ定義ではなく **本番に流れる SQL** を検証対象にできる |
| `records.time_of_day` | **NOT NULL**（`'morning'` / `'evening'`） | 画面設計で全ての記録が朝か夜のいずれかになったため、v1 の「終日記録」概念が消えた。NULL を許さないことでユニーク制約が `COALESCE` を使わない素直な形になる |

PGlite が想定どおり動かない場合の代替は Docker Compose の PostgreSQL だが、Task 1 の時点で判明するため後戻りは小さい。

---

### Task 1: パッケージの雛形とテスト基盤

`packages/db` を作り、PGlite 上で Drizzle が動くところまでを通す。この時点ではテーブルは 1 つも定義しない。

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/biome.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/tests/helpers/test-db.ts`
- Test: `packages/db/tests/smoke.test.ts`
- Create: `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces:
  - `createTestDb(): Promise<{ db: PgliteDatabase<typeof schema>; close: () => Promise<void> }>` — Task 2 以降の全テストが使う
  - npm スクリプト `db:generate`（`drizzle-kit generate`）、`test`、`check-types`、`lint`、`format`

- [ ] **Step 1: パッケージディレクトリと `package.json` を作る**

```bash
mkdir -p packages/db/src/schema packages/db/tests/helpers
```

`packages/db/package.json`:

```json
{
	"name": "@repo/db",
	"version": "0.0.0",
	"private": true,
	"type": "module",
	"exports": {
		".": "./src/index.ts",
		"./schema": "./src/schema/index.ts"
	},
	"scripts": {
		"db:generate": "drizzle-kit generate",
		"db:migrate": "drizzle-kit migrate",
		"test": "vitest run",
		"check-types": "tsc --noEmit",
		"lint": "biome lint",
		"format": "biome format --write",
		"check": "biome check"
	}
}
```

- [ ] **Step 2: 依存をインストールする**

バージョンは固定せず、インストール時点の最新を解決させる。

```bash
pnpm --filter @repo/db add drizzle-orm postgres @paralleldrive/cuid2
```

```bash
pnpm --filter @repo/db add -D drizzle-kit @electric-sql/pglite vitest typescript @types/node @repo/typescript-config@workspace:* @biomejs/biome
```

- [ ] **Step 3: 設定ファイルを 4 つ作る**

`packages/db/tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "drizzle.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/db/biome.json`:

```json
{
	"$schema": "https://biomejs.dev/schemas/2.4.9/schema.json",
	"extends": ["../../biome.json"]
}
```

`packages/db/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// PGlite の起動とマイグレーション適用に時間がかかるため既定の 5s を延ばす
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
```

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/schema/index.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "",
	},
});
```

- [ ] **Step 4: 空のスキーマ re-export を置く**

`packages/db/src/schema/index.ts`:

```ts
// テーブルはタスクごとに追加していく
export {};
```

- [ ] **Step 5: テストヘルパーを書く**

`packages/db/tests/helpers/test-db.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "../../src/schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

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
```

- [ ] **Step 6: スモークテストを書く**

マイグレーションがまだ 1 本もないため、ここでは `createTestDb` を使わず PGlite 単体の起動だけを確かめる。

`packages/db/tests/smoke.test.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
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
```

2 本目のテストは、この計画が前提にしている「PGlite = 本物の PostgreSQL」を明示的に確かめるためのもの。ここが落ちるなら Docker Compose の PostgreSQL に切り替える判断を、後続タスクに入る前に下せる。

- [ ] **Step 7: テストを実行して通ることを確認する**

```bash
pnpm --filter @repo/db test
```

Expected: 2 tests passed

- [ ] **Step 8: 環境変数のテンプレートと ignore 設定を足す**

`.env.example`（リポジトリルート）:

```
# 開発・本番の PostgreSQL 接続先。テストは PGlite を使うため不要
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hp_memos
```

`.gitignore` の末尾に追記する:

```
# Drizzle
packages/db/.drizzle-tmp/
```

- [ ] **Step 9: 型チェックと Lint を通す**

```bash
pnpm --filter @repo/db check-types && pnpm --filter @repo/db lint
```

Expected: どちらもエラーなし

- [ ] **Step 10: コミット**

```bash
git add packages/db .env.example .gitignore pnpm-lock.yaml
git commit -m "feat(db): packages/db の雛形と PGlite テスト基盤を追加"
```

---

### Task 2: users テーブル

**Files:**
- Create: `packages/db/src/schema/users.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/` （`db:generate` が自動生成）
- Test: `packages/db/tests/users.test.ts`

**Interfaces:**
- Consumes: `createTestDb()`（Task 1）
- Produces: `users` — Drizzle テーブル。列 `id` / `loginId` / `passwordHash` / `createdAt` / `updatedAt`

- [ ] **Step 1: 失敗するテストを書く**

`packages/db/tests/users.test.ts`:

```ts
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

	const found = await ctx.db.select().from(users).where(eq(users.loginId, "findme"));

	expect(found).toHaveLength(1);
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

```bash
pnpm --filter @repo/db test tests/users.test.ts
```

Expected: FAIL。`drizzle/` にマイグレーションが 1 本もないため `migrate()` が失敗する。
（`users` も未エクスポートだが、先に `migrate()` で落ちる）

- [ ] **Step 3: スキーマを書く**

`packages/db/src/schema/users.ts`:

```ts
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable(
	"users",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		loginId: text("login_id").notNull().unique(),
		passwordHash: text("password_hash").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		check("chk_users_login_id", sql`${table.loginId} ~ '^[a-zA-Z0-9_]{4,32}$'`),
	],
);
```

`packages/db/src/schema/index.ts` を差し替える:

```ts
export * from "./users";
```

- [ ] **Step 4: マイグレーションを生成する**

```bash
pnpm --filter @repo/db db:generate
```

Expected: `packages/db/drizzle/0000_*.sql` と `packages/db/drizzle/meta/` が生成される

- [ ] **Step 5: 生成された SQL を目視で確認する**

```bash
cat packages/db/drizzle/0000_*.sql
```

`create table "users"`、`unique`、`CONSTRAINT "chk_users_login_id" CHECK (...)` が含まれていること。CHECK が出ていない場合は Step 3 の `check()` の書き方を見直す。

- [ ] **Step 6: テストを実行して通ることを確認する**

```bash
pnpm --filter @repo/db test tests/users.test.ts
```

Expected: 8 tests passed

- [ ] **Step 7: コミット**

```bash
git add packages/db
git commit -m "feat(db): users テーブルを追加"
```

---

### Task 3: sessions テーブル

**Files:**
- Create: `packages/db/src/schema/sessions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/tests/sessions.test.ts`

**Interfaces:**
- Consumes: `users`（Task 2）、`createTestDb()`（Task 1）
- Produces: `sessions` — 列 `id` / `userId` / `expiresAt` / `createdAt`。`id` は呼び出し側が生成して渡す（既定値なし）

- [ ] **Step 1: 失敗するテストを書く**

`packages/db/tests/sessions.test.ts`:

```ts
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
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

```bash
pnpm --filter @repo/db test tests/sessions.test.ts
```

Expected: FAIL。`sessions` が未エクスポート。

- [ ] **Step 3: スキーマを書く**

`packages/db/src/schema/sessions.ts`:

```ts
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const sessions = pgTable(
	"sessions",
	{
		// crypto.randomBytes(32) の hex。呼び出し側で生成する
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("idx_sessions_user_id").on(table.userId),
		index("idx_sessions_expires_at").on(table.expiresAt),
	],
);
```

`packages/db/src/schema/index.ts` に追記する:

```ts
export * from "./users";
export * from "./sessions";
```

- [ ] **Step 4: マイグレーションを生成する**

```bash
pnpm --filter @repo/db db:generate
```

- [ ] **Step 5: テストを実行して通ることを確認する**

```bash
pnpm --filter @repo/db test
```

Expected: 全ファイルが pass（smoke 2 + users 8 + sessions 3）

- [ ] **Step 6: コミット**

```bash
git add packages/db
git commit -m "feat(db): sessions テーブルを追加"
```

---

### Task 4: records テーブルと、それに伴う設計ドキュメントの更新

このタスクだけ、スキーマに加えて**設計ドキュメントの書き換え**を含む。`time_of_day` を v1 のカラムに昇格させる判断は MVP のスコープ変更そのものであり、スキーマと記述が食い違ったまま次のタスクに進むと、どちらが正か分からなくなるため。

**Files:**
- Create: `packages/db/src/schema/records.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/tests/records.test.ts`
- Modify: `apps/docs/content/docs/design/db/records.mdx`
- Modify: `apps/docs/content/docs/requirements/functional.mdx`
- Modify: `apps/docs/content/docs/overview/concept.mdx`

**Interfaces:**
- Consumes: `users`（Task 2）、`createTestDb()`（Task 1）
- Produces: `records` — 列 `id` / `userId` / `date`（`string`、`YYYY-MM-DD`）/ `timeOfDay`（`"morning" | "evening"`）/ `physical`（`number`）/ `mental`（`number`）/ `comment`（`string | null`）/ `createdAt` / `updatedAt`

- [ ] **Step 1: 失敗するテストを書く**

`packages/db/tests/records.test.ts`:

```ts
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

test.each([0, 0.5, 2.5, 4.5, 5])("%s は有効な値として保存できる", async (value) => {
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
		{ userId, date: "2026-09-05", timeOfDay: "morning", physical: 3, mental: 3 },
		{ userId, date: "2026-09-06", timeOfDay: "morning", physical: 4, mental: 4 },
	]);

	const found = await ctx.db
		.select()
		.from(records)
		.where(and(eq(records.userId, userId), eq(records.date, "2026-09-06")));

	expect(found).toHaveLength(1);
	expect(found[0]?.physical).toBe(4);
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

```bash
pnpm --filter @repo/db test tests/records.test.ts
```

Expected: FAIL。`records` が未エクスポート。

- [ ] **Step 3: スキーマを書く**

`packages/db/src/schema/records.ts`:

```ts
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
	check,
	date,
	index,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const TIME_OF_DAY = ["morning", "evening"] as const;
export type TimeOfDay = (typeof TIME_OF_DAY)[number];

export const records = pgTable(
	"records",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		date: date("date", { mode: "string" }).notNull(),
		timeOfDay: text("time_of_day").$type<TimeOfDay>().notNull(),
		physical: numeric("physical", {
			precision: 2,
			scale: 1,
			mode: "number",
		}).notNull(),
		mental: numeric("mental", {
			precision: 2,
			scale: 1,
			mode: "number",
		}).notNull(),
		comment: varchar("comment", { length: 200 }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("uq_records_user_date_tod").on(table.userId, table.date, table.timeOfDay),
		index("idx_records_user_id_date").on(table.userId, sql`${table.date} DESC`),
		check(
			"chk_records_time_of_day",
			sql`${table.timeOfDay} in ('morning', 'evening')`,
		),
		check(
			"chk_records_physical",
			sql`${table.physical} >= 0 AND ${table.physical} <= 5 AND mod(${table.physical} * 10, 5) = 0`,
		),
		check(
			"chk_records_mental",
			sql`${table.mental} >= 0 AND ${table.mental} <= 5 AND mod(${table.mental} * 10, 5) = 0`,
		),
	],
);
```

`packages/db/src/schema/index.ts` に追記する:

```ts
export * from "./users";
export * from "./sessions";
export * from "./records";
```

- [ ] **Step 4: マイグレーションを生成してテストを通す**

```bash
pnpm --filter @repo/db db:generate && pnpm --filter @repo/db test tests/records.test.ts
```

Expected: 全て pass

- [ ] **Step 5: `db/records.mdx` を v1 仕様に書き換える**

`apps/docs/content/docs/design/db/records.mdx` を次のとおり直す。

1. カラム定義の表に `time_of_day` の行を追加する（`text`、NOT NULL、説明「`'morning'` / `'evening'`」）。
2. CHECK 制約の節に `time_of_day IN ('morning', 'evening')` を追加する。
3. ユニーク制約を `uq_records_user_date` ON (`user_id`, `date`) から **`uq_records_user_date_tod` ON (`user_id`, `date`, `time_of_day`) — 1 日あたり朝 1 件・夜 1 件を保証** に差し替える。
4. Drizzle スキーマのコードブロックを Step 3 の内容で置き換える。
5. **「MVP v2 マイグレーション」節をまるごと削除する。** `time_of_day` が v1 に入ったため、この移行は発生しない。
6. 「スケール」節はそのまま残す（変更なし）。

- [ ] **Step 6: `functional.mdx` をスコープ変更に合わせる**

`apps/docs/content/docs/requirements/functional.mdx` を次のとおり直す。

1. **US-4** の仕様表から「日付 | 自動で当日日付を付与（手動変更は不可）」の行を削除し、「日付 | 既定は当日。履歴画面から過去日を指定して記録できる」に差し替える。
2. **US-10 / US-11 / US-12 / US-13** を「MVP v2」見出しの下から「MVP v1」の下へ移動する。移動後、「MVP v2」見出しは配下が空になるため削除する。
3. **US-11 と US-12** の「データ不足時」の行を、`—` と表示する から **差分表示ごと省略する** に直す（[画面設計の共通ルール](/docs/design/screens)に合わせる）。
4. 記録削除のユーザーストーリーを **US-14** として末尾に追加する。

```markdown
### US-14: 記録の削除

> **As a** ユーザー
> **I want** 記録を削除したい
> **So that** 誤って別の日に書いた記録を取り消せる

#### 受け入れ条件

- Given: その日の記録画面を開いているとき
- When: 削除を実行し、確認ダイアログで承認する
- Then: 選択中のタイミング（朝または夜）の記録 1 件が削除され、履歴に戻る

| 項目 | 仕様 |
| --- | --- |
| 削除単位 | タイミング単位（朝 1 件 / 夜 1 件）。日付単位の一括削除は行わない |
| 確認 | 確認ダイアログを挟む。取り消しは提供しない |
```

5. 末尾の「画面一覧」の表を削除し、[画面設計](/docs/design/screens) へのリンクに置き換える。二重管理を避けるため、画面一覧の正は `design/screens/index.mdx` 側とする。

- [ ] **Step 7: `concept.mdx` の MVP 区分を更新する**

`apps/docs/content/docs/overview/concept.mdx` の「MVP」節を直す。

1. **MVP v1** に「朝・夜の区別」「回復量の表示」「消耗量の表示」「過去日の記録」を追加する。
2. **MVP v2** の項目（朝・夜の区別、回復量の表示、UI 改善）は v1 に吸収されたため、節ごと削除する。
3. **MVP v3** の「AI コメント機能」を **MVP v2** に繰り上げる。

- [ ] **Step 8: docs の型チェックを通す**

```bash
pnpm --filter docs check-types
```

Expected: `✓ Types generated successfully`。MDX の記法崩れやリンク切れがあればここで落ちる。

- [ ] **Step 9: コミット**

スキーマとドキュメントは同じ決定の表と裏なので 1 コミットにまとめる。

```bash
git add packages/db apps/docs/content/docs
git commit -m "feat(db): records テーブルを追加し朝夜の区別を v1 仕様に昇格"
```

---

### Task 5: credentials テーブル

**Files:**
- Create: `packages/db/src/schema/credentials.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/tests/credentials.test.ts`

**Interfaces:**
- Consumes: `users`（Task 2）、`createTestDb()`（Task 1）
- Produces: `credentials` — 列 `id` / `userId` / `credentialId` / `publicKey`（`Uint8Array`）/ `counter`（`number`）/ `transports`（`string[] | null`）/ `deviceType` / `backedUp` / `createdAt`

WebAuthn の実装自体は別計画（パスキー）で行う。ここではテーブルだけ用意する。`packages/db` を 1 回で完成させ、後続計画がスキーマ変更なしで進められるようにするため。

- [ ] **Step 1: 失敗するテストを書く**

`packages/db/tests/credentials.test.ts`:

```ts
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
		.values({ userId, credentialId: "Y3JlZC0y", publicKey: new Uint8Array([0]) })
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
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

```bash
pnpm --filter @repo/db test tests/credentials.test.ts
```

Expected: FAIL。`credentials` が未エクスポート。

- [ ] **Step 3: スキーマを書く**

`packages/db/src/schema/credentials.ts`:

```ts
import { createId } from "@paralleldrive/cuid2";
import {
	bigint,
	boolean,
	customType,
	index,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users";

const bytea = customType<{ data: Uint8Array }>({
	dataType() {
		return "bytea";
	},
});

export const credentials = pgTable(
	"credentials",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		credentialId: text("credential_id").notNull().unique(),
		publicKey: bytea("public_key").notNull(),
		counter: bigint("counter", { mode: "number" }).notNull().default(0),
		transports: text("transports").array(),
		deviceType: text("device_type"),
		backedUp: boolean("backed_up").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("idx_credentials_user_id").on(table.userId)],
);
```

`packages/db/src/schema/index.ts` に追記する:

```ts
export * from "./users";
export * from "./sessions";
export * from "./records";
export * from "./credentials";
```

- [ ] **Step 4: マイグレーションを生成してテストを通す**

```bash
pnpm --filter @repo/db db:generate && pnpm --filter @repo/db test
```

Expected: 全ファイル pass

`bytea` の往復テストが落ちる場合、PGlite が返す値が `Uint8Array` ではなく Node の `Buffer` である可能性がある。`Buffer` は `Uint8Array` のサブクラスなので `Array.from()` を通した比較は成立するはずだが、成立しない場合は `customType` に `fromDriver` を足して変換する。

- [ ] **Step 5: コミット**

```bash
git add packages/db
git commit -m "feat(db): credentials テーブルを追加"
```

---

### Task 6: クライアントとパッケージのエクスポート

`apps/web` から `@repo/db` として使える状態にする。ここまでのタスクはスキーマとテストだけで、実際の PostgreSQL に繋ぐ経路がまだない。

**Files:**
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/index.ts`
- Test: `packages/db/tests/client.test.ts`

**Interfaces:**
- Consumes: `src/schema/index.ts` の全テーブル（Task 2〜5）
- Produces:
  - `createDb(connectionString: string): Database` — 接続文字列から Drizzle インスタンスを作る
  - `getDb(): Database` — `process.env.DATABASE_URL` を使う遅延初期化シングルトン
  - `type Database` — `apps/web` の infrastructure 層が引数の型として使う
  - `@repo/db` から `getDb` / `createDb` / `Database`、`@repo/db/schema` から全テーブル

- [ ] **Step 1: 失敗するテストを書く**

接続そのものは実 DB がないと試せないため、ここで検証するのは「未設定の環境変数で落ちること」と「型が期待どおりであること」に絞る。

`packages/db/tests/client.test.ts`:

```ts
import { expect, test } from "vitest";
import { createDb } from "../src/client";

test("接続文字列が空なら例外を投げる", () => {
	expect(() => createDb("")).toThrow(/DATABASE_URL/);
});

test("接続文字列を渡すとクエリビルダを備えたインスタンスが返る", () => {
	const db = createDb("postgresql://user:pass@localhost:5432/dummy");

	// postgres.js は遅延接続するため、この時点では TCP 接続は発生しない
	expect(typeof db.select).toBe("function");
	expect(typeof db.insert).toBe("function");
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

```bash
pnpm --filter @repo/db test tests/client.test.ts
```

Expected: FAIL。`../src/client` が存在しない。

- [ ] **Step 3: クライアントを書く**

`packages/db/src/client.ts`:

```ts
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
```

- [ ] **Step 4: パッケージのエントリポイントを書く**

`packages/db/src/index.ts`:

```ts
export { createDb, getDb, type Database } from "./client";
export * from "./schema";
```

- [ ] **Step 5: テストを実行して通ることを確認する**

```bash
pnpm --filter @repo/db test
```

Expected: 全ファイル pass

- [ ] **Step 6: 型チェックと Lint を通す**

```bash
pnpm --filter @repo/db check-types && pnpm --filter @repo/db lint
```

Expected: どちらもエラーなし

- [ ] **Step 7: コミット**

```bash
git add packages/db
git commit -m "feat(db): Drizzle クライアントとパッケージのエクスポートを追加"
```

---

### Task 7: シードデータ

開発時に画面を触るためのデータを用意する。特に**朝夜の差分表示と、グラフの欠損日**を目視確認できる形にする。この 2 つは画面設計で決めたばかりで、実データがないと妥当性を検証できないため。

**Files:**
- Create: `packages/db/src/seed.ts`
- Modify: `packages/db/package.json`
- Test: `packages/db/tests/seed.test.ts`

**Interfaces:**
- Consumes: `Database`（Task 6）、全テーブル（Task 2〜5）
- Produces: `seedDatabase(db: Database, options?: { days?: number }): Promise<{ userId: string; recordCount: number }>`

- [ ] **Step 1: 失敗するテストを書く**

`packages/db/tests/seed.test.ts`:

```ts
import { eq } from "drizzle-orm";
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
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

```bash
pnpm --filter @repo/db test tests/seed.test.ts
```

Expected: FAIL。`../src/seed` が存在しない。

- [ ] **Step 3: シードを書く**

パスワードのハッシュ化は認証の計画で導入するため、ここでは固定のプレースホルダを入れる。シードユーザーでログインできる必要はまだない。

`packages/db/src/seed.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { records, users } from "./schema";
import type { TimeOfDay } from "./schema/records";

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
	db: Database,
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

		const entries: { timeOfDay: TimeOfDay; physical: number; mental: number }[] = [
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
```

- [ ] **Step 4: テストを実行して通ることを確認する**

```bash
pnpm --filter @repo/db test tests/seed.test.ts
```

Expected: 4 tests passed

- [ ] **Step 5: 実 DB に流すための CLI エントリを足す**

`packages/db/package.json` の `scripts` に追記する:

```json
"db:seed": "tsx src/seed-cli.ts"
```

```bash
pnpm --filter @repo/db add -D tsx
```

`packages/db/src/seed-cli.ts`:

```ts
import { createDb } from "./client";
import { seedDatabase } from "./seed";

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL が設定されていない");
	process.exit(1);
}

const result = await seedDatabase(createDb(url));
console.log(`シード完了: user=${result.userId} records=${result.recordCount}`);
process.exit(0);
```

- [ ] **Step 6: 全体を通す**

```bash
pnpm --filter @repo/db test && pnpm --filter @repo/db check-types && pnpm --filter @repo/db lint
```

Expected: 全て pass

- [ ] **Step 7: コミット**

```bash
git add packages/db
git commit -m "feat(db): 開発用シードデータを追加"
```

---

### Task 8: モノレポへの組み込みと最終確認

`packages/db` をルートのタスクランナーに乗せ、リポジトリ全体のコマンドが通る状態にする。

**Files:**
- Modify: `turbo.json`
- Modify: `apps/docs/content/docs/architecture/monorepo-structure.mdx`
- Modify: `apps/docs/content/docs/design/screens/index.mdx`

**Interfaces:**
- Consumes: Task 1〜7 の成果すべて
- Produces: ルートから `pnpm test` / `pnpm check-types` / `pnpm lint` が `@repo/db` を含めて通る状態

- [ ] **Step 1: `turbo.json` に DB タスクを足す**

`tasks` に追加する:

```json
"db:generate": {
  "cache": false
},
"db:migrate": {
  "cache": false
},
"db:seed": {
  "cache": false
}
```

`test` タスクの `"dependsOn": ["^build"]` はそのままでよい。`@repo/db` に `build` はないため素通りする。

- [ ] **Step 2: ルートから全タスクを実行する**

```bash
pnpm test && pnpm check-types && pnpm lint
```

Expected: `@repo/db`・`web`・`docs`・`@repo/ui` のいずれもエラーなし。`web` はテストファイルが 0 件のため vitest が「no test files」で終了するが、これは既存の状態であり、この計画では変更しない。

- [ ] **Step 3: `monorepo-structure.mdx` の「今後追加予定のディレクトリ」を更新する**

`apps/docs/content/docs/architecture/monorepo-structure.mdx` の `apps/web/src/routes/` の想定ツリーが旧画面設計（`dashboard.tsx` / `records/new.tsx` / `records/$recordId.tsx` / `graph.tsx`）のままになっている。[画面設計](/docs/design/screens)で確定したルートに差し替える。

```
apps/web/src/
├── routes/
│   ├── _authed/              … 認証必須レイアウトグループ
│   │   ├── index.tsx         … 今日
│   │   ├── history.tsx       … 履歴
│   │   ├── records.$date.tsx … その日の記録
│   │   └── settings.tsx      … 設定
│   ├── login.tsx             … ログイン
│   └── register.tsx          … アカウント登録
```

あわせて「`packages/db` の内部構成」のツリーに `tests/` と `seed.ts` を追記する。

同ページの利用例が `import { db } from "@repo/db";` になっているが、実際のエクスポートは関数 `getDb()` なので次のとおり直す（`db` を定数として公開すると、接続がモジュール読み込み時に必要になるか、Proxy で `this` 束縛を壊すかのどちらかになるため、関数にした）。

```ts
import { getDb } from "@repo/db";
import { users, records } from "@repo/db/schema";
```

- [ ] **Step 4: 画面設計の「既存ドキュメントとの差分」表から、消化した行を削除する**

`apps/docs/content/docs/design/screens/index.mdx` 末尾の表から、この計画で対応した 4 行（`functional.mdx` の 2 行、`db/records.mdx`、`concept.mdx`）を削除する。残るのは `api/records.mdx` の 1 行のみで、これは記録 API の計画で消化する。

表が 1 行だけになるため、見出しの文言を「実装前にこれらを更新する必要がある」から「以下は未反映であり、対応する計画の中で更新する」に直す。

- [ ] **Step 5: docs の型チェックを通す**

```bash
pnpm --filter docs check-types
```

Expected: `✓ Types generated successfully`

- [ ] **Step 6: コミット**

```bash
git add turbo.json apps/docs/content/docs
git commit -m "chore(db): packages/db を Turborepo に組み込みドキュメントを整合"
```

---

## 完了条件

- [ ] `pnpm test` がルートから通り、`@repo/db` の全テストが pass する
- [ ] `pnpm check-types` と `pnpm lint` がルートから通る
- [ ] `packages/db/drizzle/` に 4 テーブル分のマイグレーション SQL が生成されている
- [ ] `apps/web` から `import { getDb } from "@repo/db"` と `import { records } from "@repo/db/schema"` が型解決できる
- [ ] `design/screens/index.mdx` の差分表に残っているのは `api/records.mdx` の 1 行のみ

## この計画で扱わないこと

| 項目 | 扱う計画 |
| --- | --- |
| Hono のマウント、`server/` のディレクトリ構成、`DomainError` | サーバー基盤＋認証 |
| パスワードのハッシュ化、セッションの発行・検証 | サーバー基盤＋認証 |
| `POST /api/records` などのエンドポイント、Zod スキーマ | 記録 API |
| `api/records.mdx` の `date` / `timeOfDay` 追記 | 記録 API |
| shadcn/ui の初期化、テーマカラーの決定、画面の実装 | 画面 |
| WebAuthn の登録・認証フロー | パスキー |
