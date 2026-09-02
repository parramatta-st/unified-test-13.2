export function hasWrittenOverrideReason(value: unknown) {
  return String(value ?? '').trim().length > 0;
}
