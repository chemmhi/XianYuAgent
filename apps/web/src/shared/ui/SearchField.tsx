import type { InputHTMLAttributes, ReactNode } from 'react';
import './field.css';
import './search-field.css';

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode;
  clearable?: boolean;
  onClear?: () => void;
};

export function SearchField({ label, clearable = false, onClear, className = '', value, defaultValue, ...inputProps }: SearchFieldProps) {
  const currentValue = value ?? defaultValue ?? '';
  const hasValue = typeof currentValue === 'string' ? currentValue.length > 0 : currentValue !== undefined && currentValue !== null;
  const field = (
    <label className={`ui-search-control ${className}`.trim()}>
      <svg className="ui-search-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.25" /><path d="m10.3 10.3 3 3" /></svg>
      <input {...inputProps} type="search" value={value} defaultValue={defaultValue} />
      {clearable && hasValue && onClear && <button type="button" className="ui-search-clear" onClick={onClear} aria-label="清空搜索"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>}
    </label>
  );

  if (label === undefined) return field;
  return <span className="ui-field ui-search-field"><span className="ui-field-label">{label}</span>{field}</span>;
}
