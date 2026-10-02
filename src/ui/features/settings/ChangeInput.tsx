import { useEffect, useEffectEvent, useRef, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  value: string;
  /** The native change event: Enter, or leaving the field after an edit. */
  onCommit: (value: string, input: HTMLInputElement) => void;
};

/** A text input that reports when its text is committed rather than on every key. What is typed is the input's own
 *  until then; it shows `value` again whenever that changes. */
export function ChangeInput({ value, onCommit, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const committed = useEffectEvent((input: HTMLInputElement) => onCommit(input.value, input));
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);
  useEffect(() => {
    const input = ref.current!;
    const changed = () => committed(input);
    input.addEventListener("change", changed);
    return () => input.removeEventListener("change", changed);
  }, []);
  return <input ref={ref} defaultValue={value} {...rest} />;
}
