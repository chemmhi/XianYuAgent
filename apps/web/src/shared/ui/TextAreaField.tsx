import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
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
  const textarea = <textarea {...textareaProps} ref={ref} className={`ui-textarea-control ui-textarea ${className}`.trim()} required={required || undefined} aria-required={required || undefined} />;
  if (label === undefined && !hint && !error) return textarea;
  const content = <>{label !== undefined && <span className="ui-field-label">{label}{required && <span className="ui-field-required" aria-hidden="true">*</span>}</span>}{textarea}{error ? <span className="ui-field-error">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}</>;
  return label === undefined
    ? <span className={`ui-field ${fieldClassName}`.trim()}>{content}</span>
    : <label className={`ui-field ${fieldClassName}`.trim()}>{content}</label>;
});
