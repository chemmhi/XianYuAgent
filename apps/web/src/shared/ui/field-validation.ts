/** Constraint messages are shared with fields outside a Form, without invoking browser popovers. */
export type ValidatedControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function controlValidationMessage(control: ValidatedControl): string {
  if (!control.willValidate || control.matches(':disabled')) return '';
  const { validity, value } = control;
  if (validity.valueMissing || (control.required && !value.trim() && !['checkbox', 'radio', 'file', 'password'].includes(control.type))) return '请填写此项';
  if (validity.badInput) return '请输入有效的数字';
  if (validity.customError) return control.validationMessage || '输入内容不正确';
  if (!value) return '';
  if (validity.typeMismatch) return control.type === 'email' ? '请输入有效的邮箱地址' : '请输入有效的 URL 地址';
  if ('minLength' in control && control.minLength >= 0 && value.length < control.minLength) return `至少输入 ${control.minLength} 个字符`;
  if ('maxLength' in control && control.maxLength >= 0 && value.length > control.maxLength) return `最多输入 ${control.maxLength} 个字符`;
  if (validity.patternMismatch) return control.title || '输入格式不正确';
  if (validity.rangeUnderflow) return `不能小于 ${'min' in control ? control.min : ''}`;
  if (validity.rangeOverflow) return `不能大于 ${'max' in control ? control.max : ''}`;
  if (validity.stepMismatch) return `请输入符合步长${'step' in control && control.step ? ` ${control.step}` : ''}的数值`;
  return validity.valid ? '' : '输入内容不正确';
}

export function isValidatedControl(value: unknown): value is ValidatedControl {
  return value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement;
}

export function focusValidationControl(control: ValidatedControl): void {
  const trigger = control.type === 'select-one' || control.type === 'select-multiple'
    ? control.parentElement?.querySelector<HTMLButtonElement>('[data-validation-trigger]') : null;
  (trigger ?? control).focus();
}

export function validateFormControls(elements: Iterable<ValidatedControl>): { errors: Record<string, string>; touched: Set<string>; firstInvalid?: ValidatedControl } {
  const errors: Record<string, string> = {};
  const touched = new Set<string>();
  let firstInvalid: ValidatedControl | undefined;
  for (const element of elements) {
    const key = element.dataset.validationKey;
    const message = controlValidationMessage(element);
    if (key) { errors[key] = message; touched.add(key); }
    if (message && !firstInvalid) firstInvalid = element;
  }
  return { errors, touched, firstInvalid };
}
