import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { describedBy, useFieldValidation } from './Form';
import './field.css';
import './input-field.css';

export type InputFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  fieldClassName?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
};

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField({ label, fieldClassName = '', required = false, hint, error, className = '', ...inputProps }, ref) {
  const validation = useFieldValidation(error);
  const reserveMessage = validation.inForm && Boolean(required || inputProps.minLength || inputProps.maxLength || inputProps.pattern || inputProps.min !== undefined || inputProps.max !== undefined || inputProps.type === 'email' || inputProps.type === 'url');
  const input = <input {...inputProps} ref={ref} data-validation-key={validation.key} className={`ui-input-control ui-input ${className}`.trim()} required={required || undefined} aria-required={required || undefined} aria-invalid={validation.error ? true : inputProps['aria-invalid']} aria-describedby={describedBy(inputProps['aria-describedby'], validation.error ? validation.errorId : undefined)} />;
  const message = validation.error ? <span id={validation.errorId} className="ui-field-error">{validation.error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : reserveMessage ? <span className="ui-field-message-placeholder" aria-hidden="true">&nbsp;</span> : null;
  // Keep the control under the same parent when feedback appears, including standalone fields.
  if (label === undefined) return fieldClassName ? <span className={`ui-field ${fieldClassName}`}>{input}{message}</span> : <>{input}{message}</>;
  return <label className={`ui-field ${fieldClassName}`.trim()}><span className="ui-field-label">{label}{required && <span className="ui-field-required" aria-hidden="true">*</span>}</span>{input}{message}</label>;
});
