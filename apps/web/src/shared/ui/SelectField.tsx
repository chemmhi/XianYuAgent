import type { ReactNode, SelectHTMLAttributes } from 'react';
import './field.css';
import './select-field.css';

export type SelectFieldOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  options: readonly SelectFieldOption[];
};

export function SelectField({ label, required = false, hint, options, className = '', ...selectProps }: SelectFieldProps) {
  const field = <span className={`ui-select-control ${label === undefined ? className : ''}`.trim()}>
    <select {...selectProps} required={required || undefined} aria-required={required || undefined}>
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
    <svg className="ui-select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
  </span>;

  if (label === undefined) return field;

  return <label className={`ui-field ${className}`.trim()}>
    <span className="ui-field-label">{label}{required && <span className="ui-field-required" aria-hidden="true">*</span>}</span>
    {field}
    {hint && <span className="ui-field-hint">{hint}</span>}
  </label>;
}
