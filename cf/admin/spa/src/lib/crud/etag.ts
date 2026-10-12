/**
 * The `If-Match` value for the version of an item the person loaded: its `updatedAt` in double quotes
 * (the Worker's `etagOf`, src/api/crud/concurrency.ts). The SPA never reads the `ETag` header, it builds
 * the value from the item it already has. test/crud-spa-contract.test.ts keeps the two in step.
 */
export function ifMatch(updatedAt: string): string {
  return `"${updatedAt}"`;
}
