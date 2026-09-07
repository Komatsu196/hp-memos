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
