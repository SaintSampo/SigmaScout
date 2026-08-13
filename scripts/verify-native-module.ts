/**
 * Wave 0 spike (RESEARCH.md Pitfall 3): prove better-sqlite3's native binding
 * loads and executes SQL on this machine before Plan 02 designs a corpus on
 * top of it. Exits non-zero with a readable message on any failure.
 */
import Database from "better-sqlite3";

function main(): void {
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(":memory:");
  } catch (err) {
    console.error("FAILED: could not open an in-memory better-sqlite3 database.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  try {
    db.exec("CREATE TABLE smoke_test (value TEXT)");
    db.prepare("INSERT INTO smoke_test (value) VALUES (?)").run("ok");
    const row = db.prepare("SELECT value FROM smoke_test").get() as
      | { value: string }
      | undefined;

    if (row?.value !== "ok") {
      throw new Error(`Unexpected round-trip result: ${JSON.stringify(row)}`);
    }

    const versionRow = db.prepare("select sqlite_version() as v").get() as { v: string } | undefined;
    console.log(`better-sqlite3 native module OK — SQLite version ${versionRow?.v ?? "unknown"}`);
  } catch (err) {
    console.error("FAILED: native module loaded but SQL round-trip failed.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
