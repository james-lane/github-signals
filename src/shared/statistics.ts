export function percentile(
  values: readonly (number | null | undefined)[],
  fraction: number,
): number | null {
  const sortedValues = values
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right);
  if (!sortedValues.length) return null;
  return sortedValues[Math.min(sortedValues.length - 1, Math.ceil(fraction * sortedValues.length) - 1)];
}
