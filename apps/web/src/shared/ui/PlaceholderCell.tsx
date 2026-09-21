import type { ReactNode } from 'react';
import './placeholder-cell.css';

export type PlaceholderCellTone = 'default' | 'tinted';

export function PlaceholderCell({ children = '暂无数据', tone = 'default', className = '' }: { children?: ReactNode; tone?: PlaceholderCellTone; className?: string }) {
  return <span className={`ui-placeholder-cell placeholder-cell ui-placeholder-cell-${tone} ${className}`.trim()}>{children}</span>;
}
