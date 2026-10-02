import { useEffect, useRef, type SelectHTMLAttributes } from "react";

// `group`: shown under an <optgroup> of that label, groups in the order they first appear
type SelectOption = { id: string; name: string; group?: string };

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
const renderOption = (option: SelectOption) => (
  <option key={option.id} value={option.id}>
    {option.name}
  </option>
);

export function Select({ options, value, empty, onChange, ...rest }: Props) {
  const select = useRef<HTMLSelectElement>(null);
  const ids = options.map(option => option.id).join("\n");
  const groups = [...new Set(options.map(option => option.group))];
  useEffect(() => {
    const element = select.current;
    if (element && [...element.options].some(option => option.value === value)) element.value = value;
  }, [value, ids]);
  return (
    <select ref={select} defaultValue={value} onChange={e => onChange(e.target.value)} {...rest}>
      {empty !== undefined && <option value="">{empty}</option>}
      {groups.map(group =>
        group === undefined ? (
          options.filter(option => option.group === undefined).map(renderOption)
        ) : (
          <optgroup key={group} label={group}>
            {options.filter(option => option.group === group).map(renderOption)}
          </optgroup>
        ),
      )}
    </select>
  );
}
