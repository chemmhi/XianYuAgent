import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './button.css';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'default' | 'small';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
};

export function Button({ variant = 'default', size = 'default', className = '', children, ...buttonProps }: ButtonProps) {
  return <button {...buttonProps} className={`btn ui-button ui-button-${variant} ${size === 'small' ? 'ui-button-small' : ''} ${className}`.trim()}>{children}</button>;
}
