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
