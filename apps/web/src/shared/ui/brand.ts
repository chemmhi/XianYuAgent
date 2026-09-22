export const LOGO_VARIANTS = ['signal-grid', 'agent-fish', 'chat-spark', 'gateway-check', 'orbit-box'] as const;

export type LogoVariant = (typeof LOGO_VARIANTS)[number];

export const DEFAULT_LOGO_VARIANT: LogoVariant = 'agent-fish';

const LOGO_LABELS: Record<LogoVariant, string> = {
  'signal-grid': 'Signal Grid',
  'agent-fish': 'Agent Fish',
  'chat-spark': 'Chat Spark',
  'gateway-check': 'Gateway Check',
  'orbit-box': 'Orbit Box',
};

export function resolveLogoVariant(value?: string | null): LogoVariant {
  const normalized = value?.trim().toLowerCase().replace(/_/g, '-');
  return normalized && (LOGO_VARIANTS as readonly string[]).includes(normalized)
    ? normalized as LogoVariant
    : DEFAULT_LOGO_VARIANT;
}

export function logoAssetPath(variant: LogoVariant): string {
  return `/brand/${variant}.svg`;
}

export function logoLabel(variant: LogoVariant): string {
  return LOGO_LABELS[variant];
}
