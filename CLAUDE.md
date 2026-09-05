# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクトの現状

hp-memos は「体力（フィジカル）」と「気力（メンタル）」を分けて記録・可視化する個人向けアプリ。

**重要**: 現時点でリポジトリにあるのは **ドキュメントと starter テンプレート** のみ。`apps/web` は TanStack Start の初期テンプレート（`/` と `/about` の 2 ルートのみ）で、設計ドキュメントに書かれている API・DB・認証（Hono / Drizzle / `packages/db` / `src/server/`）は **まだ 1 行も実装されていない**。実装タスクは基本的に「設計書に沿った新規作成」になる。

## 設計ドキュメントを先に読む（`.cursor/rules/design-reference.mdc` 由来・必須）

実装・修正の前に、関連する設計を `apps/docs/content/docs/` 配下から確認する。ドキュメントはすべて日本語の MDX。

| ディレクトリ | 内容 | 中身の状態 |
| --- | --- | --- |
| `architecture/` | システム全体図・技術スタック・モノレポ構成・**API アーキテクチャ** | 記述済み（実装の一次情報源） |
| `design/api/`, `design/db/` | エンドポイント仕様・ER 図・テーブル定義 | 記述済み |
| `overview/`, `requirements/` | コンセプト・要件 | 記述済み |
| `rules/`, `decisions/`, `overview/glossary` | 規約・ADR・用語集 | **ほぼ空のテンプレート**（引用元にしない） |

- 設計と実装に齟齬がある場合は、どちらを正とするかをユーザーに確認する。
- 既知の齟齬: `overview/concept.mdx` は体力・気力を 0〜5、`design/db/` と `design/api/` は 0〜100 としている。この範囲を実装する前に確認すること。

## コマンド

パッケージマネージャは **pnpm**（`packageManager: pnpm@9`）。npm は使わない。

```bash
pnpm dev          # 全アプリ (turbo run dev)
pnpm dev:web      # web のみ  → http://localhost:3000
pnpm dev:docs     # docs のみ → http://localhost:3060
pnpm build        # turbo run build
pnpm lint         # turbo run lint（各パッケージの Biome）
pnpm format       # turbo run format（各パッケージの biome format --write）
pnpm check-types  # turbo run check-types（web / docs / ui）
pnpm test         # turbo run test（現状 web の vitest のみ）
```

パッケージ個別:

```bash
pnpm --filter web check-types                        # tsc --noEmit
pnpm --filter docs check-types                       # fumadocs-mdx + next typegen + tsc
pnpm --filter web exec vitest run src/foo.test.ts    # 単一ファイル
pnpm --filter web exec vitest run -t "テスト名"       # 名前で絞り込み
pnpm --filter web exec vitest                        # watch モード
pnpm --filter docs exec fumadocs-mdx                 # docs の .source/ を再生成
cd apps/web && pnpm dlx shadcn@latest add button     # shadcn/ui コンポーネント追加
```

補足:

- Lint / Format は Biome に一本化済み。ルート README は Turborepo starter のままで「Prettier + ESLint」と書かれているが古い。
- `apps/web` のテストは `vite.config.ts` の `test.environment: "jsdom"` で動く。テストファイルはまだ 1 つもない。
- `docs` の `check-types` は `.source/` 生成（`fumadocs-mdx`）と `next typegen` を伴うため、単独の `tsc` より時間がかかる。

## アーキテクチャ

### モノレポ

- `apps/web` — メインアプリ。TanStack Start (Vite) + React 19 + TanStack Router（ファイルベース、`src/routeTree.gen.ts` は自動生成なので手で編集しない）+ Tailwind v4 + shadcn/ui。
- `apps/docs` — Fumadocs + Next.js の設計ドキュメントサイト。
- `packages/ui` — 共有 UI（現状 button/card/code のみ。**まだどのアプリからも import されていない**）。
- `packages/typescript-config` — 共有 tsconfig プリセット。
- `packages/eslint-config` — 残存しているが Lint は Biome に移行済みで未使用。
- `packages/db` — **未作成**。設計上は Drizzle スキーマ置き場（`architecture/monorepo-structure.mdx` 参照）。

### import エイリアス

- `apps/web`: `#/*` と `@/*` がどちらも `./src/*`（`#/` は package.json の `imports`、shadcn の `components.json` もこちら）。
- `apps/docs`: `@/*` → `./*`、`collections/*` → `./.source/*`（fumadocs 生成物）。

### サーバーサイド（実装時に従う構成）

`apps/docs/content/docs/architecture/api-architecture.mdx` が一次情報源。要点:

- Hono を TanStack Start の `/api/*` にマウントする。
- `apps/web/src/server/features/<feature>/<操作>/` の **操作単位の垂直スライス**。各操作ディレクトリに `repository.ts`（その操作専用の最小 interface）・`use-case.ts`・`infrastructure.ts`（Drizzle 実装）を置く。
- 依存は内側向き: `use-case.ts` は `repository.ts` の interface のみに依存し、`@repo/db` に触れてよいのは `infrastructure.ts` だけ。
- Entity 型は feature 内の `shared/entities.ts` に置き、DB スキーマ型とは分離する（`infrastructure.ts` の `toEntity` でマッピング）。
- Use Case はクラスではなく関数。第 1 引数 `deps` で依存注入する。DI ライブラリは使わず `server/container.ts` の関数でワイヤリングし、Hono の middleware で `c.set("deps", ...)` して渡す。
- feature 間の直接参照は禁止。横断的関心事は `server/shared/`（`errors.ts`・`middleware/auth.ts`・`middleware/error-handler.ts`）へ。
- エラーは `DomainError` サブクラス（`NotFoundError` / `AuthenticationError` / `ForbiddenError` / `ConflictError`）を投げ、`error-handler` middleware が `{ error: { code, message, details? } }` の統一フォーマットに変換する。
- 認証は Cookie ベースのサーバーサイドセッション（`sessions` テーブル、30 日、`HttpOnly; Secure; SameSite=Lax`）。パスワード＋WebAuthn パスキー併用。

### docs サイト

- コンテンツは `apps/docs/content/docs/**/*.mdx`。frontmatter は `title` / `description`。
- Mermaid は ` ```mermaid ` フェンスで書く（`source.config.ts` の `remarkMdxMermaid` が `components/mdx/mermaid.tsx` に変換する）。
- `lib/shared.ts` の `appName` / `gitConfig` は fumadocs テンプレートの初期値のまま（`My App` / `fuma-nama`）。

## 規約

- Biome が Lint + Format（ESLint / Prettier は使わない）。設定はルート `biome.json` を各パッケージが extends する形で、**`apps/docs` だけスペース 2 に上書き**している（ルートはタブ・ダブルクォート）。各パッケージの `biome.json` が正。
- TypeScript は全パッケージ strict。`apps/web` は `noUnusedLocals` / `noUnusedParameters` / `verbatimModuleSyntax` も有効。
- コミットメッセージは Conventional Commits 形式 `<type>(<scope>): <subject>`（`feat` / `fix` / `docs` / `chore`）。件名は命令形・50 文字目安。本文・件名とも日本語で書かれている。
