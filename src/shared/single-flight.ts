/** `load` wrapped so calls made while one is running share its promise instead of starting another. */
export function singleFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => (running ??= load().finally(() => (running = null)));
}
