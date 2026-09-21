import { SelectField } from '../../../shared/ui/SelectField';

export interface AgentDynamicsDropdownOption<T extends string> {
  value: T;
  label: string;
}

interface AgentDynamicsDropdownProps<T extends string> {
  value: T;
  options: readonly AgentDynamicsDropdownOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  triggerClassName?: string;
}

export function AgentDynamicsDropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  triggerClassName = '',
}: AgentDynamicsDropdownProps<T>) {
  return <SelectField
    aria-label={ariaLabel}
    className={triggerClassName}
    value={value}
    onChange={(event) => onChange(event.target.value as T)}
    options={options}
  />;
}
