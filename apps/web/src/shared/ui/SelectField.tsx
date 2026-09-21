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
  /**
   * Preview-only visual menu. The native select remains the sole semantic
   * control; this adjunct is aria-hidden and should not be used in business
   * flows. It exists to reproduce the approved design open-state preview.
   */
  previewMenuOptions?: readonly SelectFieldOption[];
  previewSelectedValue?: string;
};

export function SelectField({ label, required = false, hint, options, previewMenuOptions, previewSelectedValue, className = '', ...selectProps }: SelectFieldProps) {
  const previewIsOpen = className.split(/\s+/).includes('is-open');
  const field = <span className={`ui-select-control ${label === undefined ? className : ''}`.trim()}>
    <select {...selectProps} required={required || undefined} aria-required={required || undefined}>
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
    <svg className="ui-select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    {previewIsOpen && previewMenuOptions && previewMenuOptions.length > 0 && <div className="ui-select-menu" aria-hidden="true" data-preview-only="true">
      {previewMenuOptions.map((option) => {
        const selected = option.value === (previewSelectedValue ?? selectProps.value);
        return <div key={option.value} className={`ui-select-menu-option${selected ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}`}>
          <span>{option.label}</span>
          {selected && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}
        </div>;
      })}
    </div>}
  </span>;

  if (label === undefined) return field;

  return <label className={`ui-field ${className}`.trim()}>
    <span className="ui-field-label">{label}{required && <span className="ui-field-required" aria-hidden="true">*</span>}</span>
    {field}
    {hint && <span className="ui-field-hint">{hint}</span>}
  </label>;
}
