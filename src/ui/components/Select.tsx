import { useEffect, useRef, type SelectHTMLAttributes } from "react";

type SelectOption = { id: string; name: string };

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "defaultValue" | "onChange"> & {
  options: SelectOption[];
  value: string;
  /** An empty first choice ("") with this text. */
  empty?: string;
  onChange: (value: string) => void;
};

/** A select over options. It is uncontrolled, so a pick shows at once while the save or load it starts runs; it moves
 *  to `value` when that (or the list of options) changes. A value the options lack leaves the browser's choice, the
 *  first option. */
export function Select({ options, value, empty, onChange, ...rest }: Props) {
  const select = useRef<HTMLSelectElement>(null);
  const ids = options.map(option => option.id).join("\n");
  useEffect(() => {
    const element = select.current;
    if (element && [...element.options].some(option => option.value === value)) element.value = value;
  }, [value, ids]);
  return (
    <select ref={select} defaultValue={value} onChange={e => onChange(e.target.value)} {...rest}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map(option => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
