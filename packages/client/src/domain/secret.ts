const GROUP_AND_OTHER = 0o077;
const OWNER_EXECUTE = 0o100;

/**
 * Whether a file's mode leaves a secret readable only by its owner. "0600 or
 * stricter" means: nothing for group or other, and nothing executable. 0400 and
 * 0200 are stricter than 0600 and are accepted; 0640 and 0601 are not.
 */
export function isTightMode(mode: number): boolean {
  return (mode & (GROUP_AND_OTHER | OWNER_EXECUTE)) === 0;
}

/** The three permission digits of a mode, the way `ls -l` and `stat` print them. */
export function modeText(mode: number): string {
  const digits = (mode & 0o777).toString(8).padStart(3, "0");
  return `0o${digits}`;
}
