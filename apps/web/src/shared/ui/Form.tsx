import { createContext, forwardRef, useContext, useId, useState, type FormHTMLAttributes, type ReactNode } from 'react';
import { controlValidationMessage, focusValidationControl, isValidatedControl, validateFormControls, type ValidatedControl } from './field-validation';

type ValidationContextValue = {
  errors: Record<string, string>;
  revalidate: (control: ValidatedControl, touched?: boolean) => void;
};
const ValidationContext = createContext<ValidationContextValue | null>(null);

export const Form = forwardRef<HTMLFormElement, FormHTMLAttributes<HTMLFormElement>>(function Form({ onSubmit, onChangeCapture, onBlurCapture, onReset, children, ...props }, ref) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  function revalidate(control: ValidatedControl, markTouched = false) {
    const key = control.dataset.validationKey;
    if (!key || (!markTouched && !touched.has(key))) return;
    if (markTouched) setTouched(previous => new Set(previous).add(key));
    const message = controlValidationMessage(control);
    setErrors(previous => previous[key] === message ? previous : { ...previous, [key]: message });
  }
  return <ValidationContext.Provider value={{ errors, revalidate }}><form {...props} ref={ref} noValidate
    onChangeCapture={event => { onChangeCapture?.(event); if (isValidatedControl(event.target)) revalidate(event.target); }}
    onBlurCapture={event => { onBlurCapture?.(event); if (isValidatedControl(event.target)) revalidate(event.target, true); }}
    onReset={event => { onReset?.(event); if (!event.defaultPrevented) { setErrors({}); setTouched(new Set()); } }}
    onSubmit={event => {
      const { errors: nextErrors, touched: nextTouched, firstInvalid } = validateFormControls(Array.from(event.currentTarget.elements).filter(isValidatedControl));
      setErrors(nextErrors); setTouched(nextTouched);
      if (firstInvalid) { event.preventDefault(); focusValidationControl(firstInvalid); return; }
      onSubmit?.(event);
    }}>{children}</form></ValidationContext.Provider>;
});

export function useFieldValidation(error?: ReactNode) {
  const key = useId();
  const context = useContext(ValidationContext);
  const message = error || context?.errors[key];
  return { key, error: message, errorId: `field-error-${key.replace(/:/g, '')}`, inForm: Boolean(context),
    revalidate: (control: ValidatedControl | null, touched = false) => { if (control) context?.revalidate(control, touched); } };
}

export function describedBy(existing: string | undefined, errorId: string | undefined): string | undefined {
  return [...new Set([...(existing?.split(/\s+/).filter(Boolean) ?? []), ...(errorId ? [errorId] : [])])].join(' ') || undefined;
}
