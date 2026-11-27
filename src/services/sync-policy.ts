export interface SyncCategorySelection {
  lessonMetadata: boolean;
  notes: boolean;
  quizzes: boolean;
  attempts: boolean;
}

/**
 * Old local preference records may predate dependency enforcement. Never
 * silently enable quiz uploads to satisfy an old attempts choice; disable the
 * dependent attempts flag instead.
 */
export function normalizeSyncCategoryPreferences(categories: SyncCategorySelection): SyncCategorySelection {
  return {
    ...categories,
    lessonMetadata: categories.lessonMetadata === true,
    notes: categories.notes === true,
    quizzes: categories.quizzes === true,
    attempts: categories.attempts === true && categories.quizzes === true
  };
}

export function assertSyncCategoryDependencies(categories: SyncCategorySelection): void {
  for (const value of Object.values(categories)) {
    if (typeof value !== "boolean") throw new Error("Invalid sync category selection.");
  }
  if (categories.attempts && !categories.quizzes) {
    throw new Error("Quiz attempts can only be synced when Quiz definitions are also enabled.");
  }
}
