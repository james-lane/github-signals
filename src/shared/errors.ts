export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNodeError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error;
}
