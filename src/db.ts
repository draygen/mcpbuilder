import Database from "better-sqlite3";
import { homedir } from "os";
import { existsSync } from "fs";

const AION_DB = process.env.AION_DB_PATH ?? `${homedir()}/.aion/aion.db`;
const JENN_DB = process.env.JENN_DB_PATH ?? "/mnt/c/aion_v2/data/jenn/jenn.db";

let db: Database.Database | null = null;
let jennDb: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    if (!existsSync(AION_DB)) {
      throw new Error(
        `AION database not found at: ${AION_DB}\n` +
        `Set AION_DB_PATH env var or make sure AION has been run at least once.`
      );
    }
    db = new Database(AION_DB);
    // Improve read performance
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  return db;
}

export function getJennDb(): Database.Database | null {
  if (!jennDb) {
    if (!existsSync(JENN_DB)) return null;
    jennDb = new Database(JENN_DB, { readonly: true });
  }
  return jennDb;
}

export function closeAll(): void {
  db?.close();
  db = null;
  jennDb?.close();
  jennDb = null;
}

export { AION_DB, JENN_DB };
