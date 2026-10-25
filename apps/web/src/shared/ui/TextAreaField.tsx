import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { describedBy, useFieldValidation } from './Form';
import './field.css';
import './textarea-field.css';

export type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  fieldClassName?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
};

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField({ label, fieldClassName = '', required = false, hint, error, className = '', ...textareaProps }, ref) {
  const validation = useFieldValidation(error);
  const reserveMessage = validation.inForm && Boolean(required || textareaProps.minLength || textareaProps.maxLength);
  const textarea = <textarea {...textareaProps} ref={ref} data-validation-key={validation.key} className={`ui-textarea-control ui-textarea ${className}`.trim()} required={required || undefined} aria-required={required || undefined} aria-invalid={validation.error ? true : textareaProps['aria-invalid']} aria-describedby={describedBy(textareaProps['aria-describedby'], validation.error ? validation.errorId : undefined)} />;
  const message = validation.error ? <span id={validation.errorId} className="ui-field-error">{validation.error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : reserveMessage ? <span className="ui-field-message-placeholder" aria-hidden="true">&nbsp;</span> : null;
  if (label === undefined) return fieldClassName ? <span className={`ui-field ${fieldClassName}`}>{textarea}{message}</span> : <>{textarea}{message}</>;
  return <label className={`ui-field ${fieldClassName}`.trim()}><span className="ui-field-label">{label}{required && <span className="ui-field-required" aria-hidden="true">*</span>}</span>{textarea}{message}</label>;
});
