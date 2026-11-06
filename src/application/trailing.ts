/** `fn` once, `ms` after the first of a burst of calls (a pull changing 200 notes runs it once). The timer does not
 *  restart, so a steady stream of calls (Claude writing for a minute) still runs it every `ms`. */
export function trailing(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      fn();
    }, ms);
  };
}
