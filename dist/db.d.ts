import Database from "better-sqlite3";
declare const AION_DB: string;
declare const JENN_DB: string;
export declare function getDb(): Database.Database;
export declare function getJennDb(): Database.Database | null;
export declare function closeAll(): void;
export { AION_DB, JENN_DB };
//# sourceMappingURL=db.d.ts.map