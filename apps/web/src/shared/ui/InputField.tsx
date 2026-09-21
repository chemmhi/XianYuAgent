import type { InputHTMLAttributes, ReactNode } from 'react';
import './field.css';
import './input-field.css';

export type InputFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  fieldClassName?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
};

export function InputField({ label, fieldClassName = '', required = false, hint, error, className = '', ...inputProps }: InputFieldProps) {
  const input = <input {...inputProps} className={`ui-input-control ui-input ${className}`.trim()} required={required || undefined} aria-required={required || undefined} />;
  if (label === undefined && !hint && !error) return input;
  const content = <>{label !== undefined && <span className="ui-field-label">{label}{required && <span className="ui-field-required" aria-hidden="true">*</span>}</span>}{input}{error ? <span className="ui-field-error">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}</>;
  return label === undefined
    ? <span className={`ui-field ${fieldClassName}`.trim()}>{content}</span>
    : <label className={`ui-field ${fieldClassName}`.trim()}>{content}</label>;
}
