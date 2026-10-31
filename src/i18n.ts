import { signal } from "@preact/signals";

export type Locale = "zh-TW" | "en";

const en = {
  tagline: "Private markdown notepad on Cloudflare Workers",
  signIn: "Sign in",
  signingIn: "Signing in…",
  username: "Username",
  password: "Password",
  invalidCredentials: "Invalid username or password",
  serverMisconfigured: "Server is missing ADMIN_PASSWORD (set it in .dev.vars locally, or via wrangler secret in production)",
  loginFailed: "Sign-in failed, please try again",
  signOut: "Sign out",
  language: "Language",
  theme: "Theme",
  light: "Light",
  dark: "Dark",
  system: "System",
  accentColor: "Accent color",
  settings: "Settings",
  cancel: "Cancel",
  apply: "Apply",
  folders: "Folders",
  notesLabel: "Notes",
  showNoteList: "Show notes list",
  hideNoteList: "Hide notes list",
  purge: "Delete forever",
  purgeConfirm: "Permanently delete this note? This cannot be undone.",
  allNotes: "All notes",
  trash: "Trash",
  newNote: "New note",
  newFolder: "New folder",
  folderNamePrompt: "Folder name…",
  folderRenamePrompt: "Rename folder",
  renameFolder: "Rename folder",
  moveToFolder: "Move to folder",
  noFolder: "No folder",
  tags: "Tags",
  noTags: "No tags yet — type #tag in a note",
  folderDeleteConfirm: 'Delete folder "{name}"? Its notes will move to the root.',
  noNotes: "No notes yet — create one!",
  noNotesTrash: "Trash is empty",
  noSelection: "Select a note on the left, or create a new one",
  untitled: "Untitled",
  titlePlaceholder: "Note title",
  contentPlaceholder: "Start writing in Markdown… (CodeMirror 6 editor arrives in M1)",
  saving: "Saving…",
  saved: "Saved",
  saveError: "Save failed",
  conflict: "Version conflict — the server has a newer version",
  conflictReload: "Load server version",
  conflictKeepMine: "Keep my version",
  deleteNote: "Delete",
  deleteConfirm: "Move this note to trash?",
  restore: "Restore",
  deleteForever: "Delete forever",
  deleteForeverConfirm: "Permanently delete? This cannot be undone.",
  favorite: "Favorite",
  pin: "Pin to top",
  versionPrefix: "Version",
  updatedPrefix: "Updated",
  charCount: "{n} characters",
  loadError: "Could not load this note",
} as const;

export type StringKey = keyof typeof en;

const zhTW: Record<StringKey, string> = {
  tagline: "運行在 Cloudflare Workers 上的私有 Markdown 筆記本",
  signIn: "登入",
  signingIn: "登入中…",
  username: "用戶名",
  password: "密碼",
  invalidCredentials: "用戶名或密碼錯誤",
  serverMisconfigured: "伺服器未設置 ADMIN_PASSWORD(本地在 .dev.vars、生產用 wrangler secret 設置)",
  loginFailed: "登入失敗,請稍後重試",
  signOut: "登出",
  language: "語言",
  theme: "主題",
  light: "淺色",
  dark: "深色",
  system: "跟隨系統",
  accentColor: "強調色",
  settings: "設置",
  cancel: "取消",
  apply: "套用",
  folders: "文件夾",
  notesLabel: "筆記",
  showNoteList: "展開筆記列表",
  hideNoteList: "收合筆記列表",
  purge: "永久刪除",
  purgeConfirm: "永久刪除這篇筆記?此操作無法復原。",
  allNotes: "全部筆記",
  trash: "回收站",
  newNote: "新建筆記",
  newFolder: "新建文件夾",
  folderNamePrompt: "文件夾名稱…",
  folderRenamePrompt: "重新命名文件夾",
  renameFolder: "重新命名",
  moveToFolder: "移到文件夾",
  noFolder: "未分類",
  tags: "標籤",
  noTags: "尚無標籤——在筆記中輸入 #標籤",
  folderDeleteConfirm: "刪除文件夾「{name}」?其中的筆記會移到根目錄。",
  noNotes: "尚無筆記——點「新建筆記」開始",
  noNotesTrash: "回收站是空的",
  noSelection: "選擇左側筆記,或新建一篇",
  untitled: "無標題",
  titlePlaceholder: "筆記標題",
  contentPlaceholder: "用 Markdown 開始寫作…(CodeMirror 6 編輯器將於 M1 上線)",
  saving: "保存中…",
  saved: "已保存",
  saveError: "保存失敗",
  conflict: "版本衝突——伺服器上有更新的版本",
  conflictReload: "載入伺服器版本",
  conflictKeepMine: "保留我的版本",
  deleteNote: "刪除",
  deleteConfirm: "把這篇筆記移到回收站?",
  restore: "還原",
  deleteForever: "徹底刪除",
  deleteForeverConfirm: "徹底刪除後無法恢復,確定?",
  favorite: "收藏",
  pin: "置頂",
  versionPrefix: "版本",
  updatedPrefix: "更新於",
  charCount: "{n} 字元",
  loadError: "無法載入這篇筆記",
};

const dictionaries: Record<Locale, Record<StringKey, string>> = { en, "zh-TW": zhTW };

const LOCALE_STORAGE_KEY = "notetion.locale";

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh-TW" || stored === "en") return stored;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

export const locale = signal<Locale>(detectLocale());

export function setLocale(next: Locale): void {
  locale.value = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
}

export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let text = dictionaries[locale.value][key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** Human-friendly relative time, following the current locale. */
export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  try {
    const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" });
    const minutes = Math.round(diff / 60_000);
    if (Math.abs(minutes) < 1) return rtf.format(-Math.round(diff / 1000), "second");
    if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 30) return rtf.format(-days, "day");
  } catch {
    /* fall through to absolute date */
  }
  return new Date(ts).toLocaleDateString(locale.value);
}
