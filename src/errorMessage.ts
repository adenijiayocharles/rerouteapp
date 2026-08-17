export function errorMessage(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}
