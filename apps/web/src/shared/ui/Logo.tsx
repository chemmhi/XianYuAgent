import { logoAssetPath, resolveLogoVariant, type LogoVariant } from './brand';

type LogoProps = {
  variant?: LogoVariant;
  className?: string;
  label?: string;
  size?: number;
};

export function Logo({ variant, className, label = 'XianyuSellerAgent', size = 28 }: LogoProps) {
  const resolvedVariant = variant ?? resolveLogoVariant();
  return <img className={className} src={logoAssetPath(resolvedVariant)} width={size} height={size} alt={label} />;
}
