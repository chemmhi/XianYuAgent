/**
 * Mock adapters remain available for local previews and unit tests, but a
 * production page must never silently render fabricated business data.
 */
export function resolveRuntimeApi<T>(provided: T | undefined, fallback: () => T, errorCode: string): T {
  if (provided) return provided;
  if (import.meta.env.PROD) throw new Error(errorCode);
  return fallback();
}
