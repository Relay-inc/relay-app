import { useRef, useSyncExternalStore } from "react";
import { stores, tracked, unchanged } from "../../application/make-store";

const subscribe = (changed: () => void) => {
  const offs = stores.map(store => store.subscribe(changed));
  return () => offs.forEach(off => off());
};

// plain data compared by value, Sets and Maps by their entries; functions and class instances by identity
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a instanceof Set) return b instanceof Set && a.size === b.size && [...a].every(x => b.has(x));
  if (a instanceof Map)
    return b instanceof Map && a.size === b.size && [...a].every(([key, x]) => b.has(key) && same(x, b.get(key)));
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(key => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  );
}

/** A value an application read builds from several stores (`useDerived(() => sidebarModel())`,
 *  `useDerived(() => label(key))`). The read runs again only when a store it read (through getState) changed, and
 *  the component only redraws when the result differs by value. A read returns plain data (objects, arrays, Sets,
 *  Maps) and reads only store state: something else it depends on (the clock) is only read again on the next change
 *  of a store it read. For one store's own slice, select from that store instead. */
export function useDerived<T>(compute: () => T): T {
  const last = useRef<{ value: T; deps: ReturnType<typeof tracked>["deps"]; compute: () => T } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    // React reads the snapshot on every change of any store, and several times per render: skip unless what this
    // read looked at changed, or the read itself did
    const prev = last.current;
    if (prev && prev.compute === compute && unchanged(prev.deps)) return prev.value;
    const { value: next, deps } = tracked(compute);
    const value = prev && same(prev.value, next) ? prev.value : next;
    last.current = { value, deps, compute };
    return value;
  });
}
