const MAX_ID_LENGTH = 63;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidId(id: string): boolean {
  if (id.length > MAX_ID_LENGTH) {
    return false;
  }
  return ID_PATTERN.test(id);
}
