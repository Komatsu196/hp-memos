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
		unique("uq_records_user_date_tod").on(
			table.userId,
			table.date,
			table.timeOfDay,
		),
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
