/** A quiet centred line: "stopped", "moved to …", the empty conversation. */
export function NoteLine({ text }: { text: string }) {
  return <div className="text-center text-sm text-secondary">{text}</div>;
}
