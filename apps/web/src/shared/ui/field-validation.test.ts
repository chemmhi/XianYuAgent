import { describe, expect, it, vi } from 'vitest';
import { controlValidationMessage, focusValidationControl, validateFormControls, type ValidatedControl } from './field-validation';

function control(overrides: Record<string, unknown> = {}, validity: Partial<ValidityState> = {}): ValidatedControl {
  return { type: 'text', value: 'valid', required: false, willValidate: true, matches: () => false,
    minLength: -1, maxLength: -1, dataset: { validationKey: 'field' },
    validity: { valid: Object.keys(validity).length === 0, ...validity }, ...overrides } as unknown as ValidatedControl;
}

describe('field constraint validation', () => {
  it('allows valid and optional empty values without invoking a browser popup', () => {
    expect(controlValidationMessage(control())).toBe('');
    expect(controlValidationMessage(control({ value: '', minLength: 8 }))).toBe('');
    expect(controlValidationMessage(control({ type: 'password', required: true, value: '        ', minLength: 8 }))).toBe('');
    expect(controlValidationMessage(control({ value: '', validationMessage: '自定义约束未通过' }, { customError: true }))).toBe('自定义约束未通过');
  });
  it('rejects required empty values including whitespace', () => {
    expect(controlValidationMessage(control({ value: '', required: true }, { valueMissing: true }))).toBe('请填写此项');
    expect(controlValidationMessage(control({ value: '  ', required: true }))).toBe('请填写此项');
    expect(controlValidationMessage(control({ type: 'checkbox', value: 'on' }, { valueMissing: true }))).toBe('请填写此项');
  });
  it('skips disabled controls, disabled fieldsets, readonly and hidden controls', () => {
    expect(controlValidationMessage(control({ willValidate: false, required: true, value: '' }, { valueMissing: true }))).toBe('');
    expect(controlValidationMessage(control({ matches: () => true, required: true, value: '' }, { valueMissing: true }))).toBe('');
  });
  it('checks length for controlled and programmatically supplied values', () => {
    expect(controlValidationMessage(control({ value: '1234567', minLength: 8 }))).toBe('至少输入 8 个字符');
    expect(controlValidationMessage(control({ value: '12345678', minLength: 8, maxLength: 8 }))).toBe('');
    expect(controlValidationMessage(control({ value: '123456789', maxLength: 8 }))).toBe('最多输入 8 个字符');
  });
  it.each([
    [{ type: 'email' }, { typeMismatch: true }, '请输入有效的邮箱地址'],
    [{ type: 'url' }, { typeMismatch: true }, '请输入有效的 URL 地址'],
    [{ title: '只能使用字母' }, { patternMismatch: true }, '只能使用字母'],
    [{ min: '1' }, { rangeUnderflow: true }, '不能小于 1'],
    [{ max: '30' }, { rangeOverflow: true }, '不能大于 30'],
    [{ step: '0.01' }, { stepMismatch: true }, '请输入符合步长 0.01的数值'],
    [{ type: 'number', value: '' }, { badInput: true }, '请输入有效的数字'],
    [{ validationMessage: '此值已被占用' }, { customError: true }, '此值已被占用'],
  ])('maps constraint failures to field messages %#', (overrides, validity, expected) => {
    expect(controlValidationMessage(control(overrides, validity))).toBe(expected);
  });
  it('collects all errors in DOM order and excludes disabled fields from first failure', () => {
    const disabled = control({ dataset: { validationKey: 'disabled' }, willValidate: false }, { valueMissing: true });
    const first = control({ dataset: { validationKey: 'email' }, type: 'email' }, { typeMismatch: true });
    const next = control({ dataset: { validationKey: 'password' }, minLength: 8, value: 'abc' });
    const result = validateFormControls([disabled, first, next]);
    expect(result.firstInvalid).toBe(first);
    expect(result.errors).toEqual({ disabled: '', email: '请输入有效的邮箱地址', password: '至少输入 8 个字符' });
    expect([...result.touched]).toEqual(['disabled', 'email', 'password']);
  });
  it('focuses the visible select trigger rather than the hidden native select', () => {
    const focus = vi.fn();
    const nativeFocus = vi.fn();
    focusValidationControl(control({ type: 'select-one', parentElement: { querySelector: () => ({ focus }) }, focus: nativeFocus }));
    expect(focus).toHaveBeenCalledOnce();
    expect(nativeFocus).not.toHaveBeenCalled();
    focusValidationControl(control({ parentElement: null, focus: nativeFocus }));
    expect(nativeFocus).toHaveBeenCalledOnce();
  });
  it('keeps a text input focused even when its parent also contains a select trigger', () => {
    const inputFocus = vi.fn();
    const selectFocus = vi.fn();
    focusValidationControl(control({ type: 'text', parentElement: { querySelector: () => ({ focus: selectFocus }) }, focus: inputFocus }));
    expect(inputFocus).toHaveBeenCalledOnce();
    expect(selectFocus).not.toHaveBeenCalled();
  });
});
