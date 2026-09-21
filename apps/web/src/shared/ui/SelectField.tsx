import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
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
   * Preview-only visual menu. When present with `is-open`, it renders the same
   * menu markup as the live dropdown while keeping the native select in place.
   */
  previewMenuOptions?: readonly SelectFieldOption[];
  previewSelectedValue?: string;
};

function stringValue(value: SelectHTMLAttributes<HTMLSelectElement>['value']): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  if (value === undefined || value === null) return '';
  return String(value);
}

function firstEnabledIndex(options: readonly SelectFieldOption[], selectedValue: string): number {
  const selectedIndex = options.findIndex((option) => option.value === selectedValue && !option.disabled);
  if (selectedIndex >= 0) return selectedIndex;
  return options.findIndex((option) => !option.disabled);
}

export function SelectField({
  label,
  required = false,
  hint,
  options,
  previewMenuOptions,
  previewSelectedValue,
  className = '',
  value,
  defaultValue,
  disabled = false,
  onChange: externalOnChange,
  onFocus: externalOnFocus,
  onBlur: externalOnBlur,
  onClick: externalOnClick,
  onKeyDown: externalOnKeyDown,
  ...selectProps
}: SelectFieldProps) {
  const classTokens = className.split(/\s+/).filter(Boolean);
  const previewIsOpen = classTokens.includes('is-open') && Boolean(previewMenuOptions?.length);
  const stateClassNames = classTokens.filter((token) => token === 'is-focus' || token === 'is-open').join(' ');
  const controlClassName = label === undefined ? className : stateClassNames;
  const reactId = useId().replace(/:/g, '');
  const menuId = `ui-select-menu-${reactId}`;
  const labelId = `ui-select-label-${reactId}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controlled = value !== undefined;
  const initialValue = stringValue(value ?? defaultValue ?? options[0]?.value ?? '');
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const [isOpen, setIsOpen] = useState(false);
  const selectedValue = controlled ? stringValue(value) : uncontrolledValue;
  const menuOptions = previewMenuOptions ?? options;
  const menuIsOpen = previewIsOpen || isOpen;
  const selectedOption = menuOptions.find((option) => option.value === (previewSelectedValue ?? selectedValue)) ?? menuOptions[0];
  const [highlightedIndex, setHighlightedIndex] = useState(() => firstEnabledIndex(menuOptions, previewSelectedValue ?? selectedValue));
  const ariaLabel = selectProps['aria-label'];
  const ariaDescribedBy = selectProps['aria-describedby'];

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsidePointer = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, [isOpen]);

  useEffect(() => {
    const nextIndex = firstEnabledIndex(menuOptions, previewSelectedValue ?? selectedValue);
    setHighlightedIndex(nextIndex);
  }, [menuOptions, previewSelectedValue, selectedValue]);

  const notifyTriggerFocus = (event: FocusEvent<HTMLButtonElement>) => {
    externalOnFocus?.(event as unknown as FocusEvent<HTMLSelectElement>);
  };

  const notifyTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    externalOnClick?.(event as unknown as MouseEvent<HTMLSelectElement>);
  };

  const commitValue = (nextValue: string) => {
    const nextOption = options.find((option) => option.value === nextValue);
    if (!nextOption || nextOption.disabled || disabled) return;
    if (!controlled) setUncontrolledValue(nextValue);
    const nativeSelect = selectRef.current;
    if (nativeSelect) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(nativeSelect, nextValue);
      nativeSelect.dispatchEvent(new Event('input', { bubbles: true }));
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleNativeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!controlled) setUncontrolledValue(event.target.value);
    externalOnChange?.(event);
    setIsOpen(false);
  };

  const handleNativeFocus = (event: FocusEvent<HTMLSelectElement>) => {
    externalOnFocus?.(event);
  };

  const handleNativeBlur = (event: FocusEvent<HTMLSelectElement>) => {
    externalOnBlur?.(event);
  };

  const handleNativeClick = (event: MouseEvent<HTMLSelectElement>) => {
    externalOnClick?.(event);
    if (!disabled) {
      setHighlightedIndex(firstEnabledIndex(menuOptions, previewSelectedValue ?? selectedValue));
      setIsOpen((open) => !open);
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    externalOnKeyDown?.(event as unknown as KeyboardEvent<HTMLSelectElement>);
    if (event.defaultPrevented || disabled) return;

    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!isOpen) {
        setHighlightedIndex(firstEnabledIndex(menuOptions, previewSelectedValue ?? selectedValue));
        setIsOpen(true);
        return;
      }
      const nextIndex = (() => {
        let index = highlightedIndex;
        for (let step = 0; step < menuOptions.length; step += 1) {
          index = (index + direction + menuOptions.length) % menuOptions.length;
          if (!menuOptions[index]?.disabled) return index;
        }
        return highlightedIndex;
      })();
      setHighlightedIndex(nextIndex);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const indexes = menuOptions.map((option, index) => (!option.disabled ? index : -1)).filter((index) => index >= 0);
      if (indexes.length) setHighlightedIndex(event.key === 'Home' ? indexes[0] : indexes[indexes.length - 1]);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOpen) {
        setHighlightedIndex(firstEnabledIndex(menuOptions, previewSelectedValue ?? selectedValue));
        setIsOpen(true);
      } else {
        const option = menuOptions[highlightedIndex];
        if (option) commitValue(option.value);
      }
    }
  };

  const controlStateClassName = `${controlClassName}${menuIsOpen && !stateClassNames.includes('is-open') ? ' is-open' : ''}`.trim();
  const field = (
    <span ref={rootRef} className={`ui-select-control ${controlStateClassName}`.trim()}>
      <select
        {...selectProps}
        ref={selectRef}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled || undefined}
        required={required || undefined}
        aria-required={required || undefined}
        aria-hidden="true"
        tabIndex={-1}
        className="ui-select-native"
        onChange={handleNativeChange}
        onFocus={handleNativeFocus}
        onBlur={handleNativeBlur}
        onClick={handleNativeClick}
      >
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={menuIsOpen}
        aria-controls={menuIsOpen ? menuId : undefined}
        aria-label={label === undefined ? ariaLabel : undefined}
        aria-labelledby={label === undefined ? undefined : labelId}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onFocus={notifyTriggerFocus}
        onClick={(event) => {
          event.preventDefault();
          notifyTriggerClick(event);
          if (!disabled) {
            setHighlightedIndex(firstEnabledIndex(menuOptions, previewSelectedValue ?? selectedValue));
            setIsOpen((open) => !open);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="ui-select-value">{selectedOption?.label ?? ''}</span>
        <svg className="ui-select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {menuIsOpen && menuOptions.length > 0 && <div id={menuId} className="ui-select-menu" role="listbox" aria-label={`${String(ariaLabel ?? label ?? '下拉选项')}展开菜单`} data-preview-only={previewIsOpen ? 'true' : undefined}>
        {menuOptions.map((option, index) => {
          const selected = option.value === (previewSelectedValue ?? selectedValue);
          const highlighted = index === highlightedIndex;
          return <button
            key={option.value}
            type="button"
            className={`ui-select-menu-option${selected ? ' is-selected' : ''}${highlighted && !selected ? ' is-highlighted' : ''}${option.disabled ? ' is-disabled' : ''}`}
            role="option"
            aria-selected={selected}
            aria-disabled={option.disabled || undefined}
            disabled={option.disabled}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={(event) => {
              event.preventDefault();
              commitValue(option.value);
            }}
          >
            <span>{option.label}</span>
            {selected && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}
          </button>;
        })}
      </div>}
    </span>
  );

  if (label === undefined) return field;

  return <label className={`ui-field ${className}`.trim()}>
    <span id={labelId} className="ui-field-label">{label}{required && <span className="ui-field-required" aria-hidden="true">*</span>}</span>
    {field}
    {hint && <span className="ui-field-hint">{hint}</span>}
  </label>;
}
