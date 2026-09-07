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
