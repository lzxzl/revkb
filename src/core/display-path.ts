// revkb quotes paths in messages with forward slashes on every platform,
// matching the Markdown link format used inside the Vault.
export function displayPath(value: string): string {
  return value.replaceAll("\\", "/");
}
