/** What a note may be called: letters, digits, `_`, `.` and `-`, at most 80. */
export const NOTE_NAME = /^[A-Za-z0-9_.-]{1,80}/;

export function isNoteName(name: string): boolean {
  return NOTE_NAME.test(name);
}

/** The most bytes a note may hold, from the operator's setting. */
export function noteCap(setting: string | undefined): number {
  return Number(setting);
}
