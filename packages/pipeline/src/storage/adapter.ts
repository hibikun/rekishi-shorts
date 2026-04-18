/**
 * StorageAdapter: Phase 0 はローカル、Phase 1 以降は Supabase Storage に差し替え可能にする interface。
 * 現時点では LocalStorageAdapter のみ。
 */
export interface StorageAdapter {
  /** job ごとの作業ディレクトリを確保し絶対パスを返す */
  ensureJobDir(jobId: string, subdir: string): Promise<string>;
  /** 成果物の保存（local: そのまま、supabase: upload） */
  save(localPath: string, logicalPath: string): Promise<string>;
}
