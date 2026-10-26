import { newId } from "./util";
import { STARTER_EN_CONTENT, STARTER_EN_TITLE, STARTER_ZH_CONTENT, STARTER_ZH_TITLE } from "./starter-notes";

/**
 * Seed the admin account's initial state: the two standard starter notes
 * (Traditional Chinese + English) and default settings.
 * Called exactly once — when the admin account row is first created.
 */
export async function seedStarterNotes(db: D1Database, accountId: string, ts: number): Promise<void> {
  const insertNote = (title: string, content: string, at: number): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO notes (id, account_id, folder_id, title, content, version, favorite, pinned, archived, created_at, updated_at)
         VALUES (?1, ?2, NULL, ?3, ?4, 1, 0, 1, 0, ?5, ?5)`,
      )
      .bind(newId(), accountId, title, content, at);

  const insertSetting = (key: string, value: string): D1PreparedStatement =>
    db
      .prepare(`INSERT INTO settings (account_id, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)`)
      .bind(accountId, key, value, ts);

  await db.batch([
    // English first so the zh-TW note (default locale) sorts on top.
    insertNote(STARTER_EN_TITLE, STARTER_EN_CONTENT, ts),
    insertNote(STARTER_ZH_TITLE, STARTER_ZH_CONTENT, ts + 1),
    insertSetting("locale", "zh-TW"),
    insertSetting("theme", "system"),
    insertSetting("accent", "indigo"),
  ]);
}
