export function isRenovateAuthor(login?: string | null): boolean {
  return /^renovate(?:\[bot\])?$/i.test(login ?? '');
}
