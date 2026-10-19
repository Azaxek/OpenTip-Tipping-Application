import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

/**
 * Safety floor, not a branding element: always shown above the tip form, cannot be dismissed, and takes no
 * props that could reword or hide it. `strong` only makes it louder (used when the tipster flags "urgent");
 * `lang` only chooses which built-in translation is shown.
 */
export const EMERGENCY_TEXT = en.emergency;

export function EmergencyBanner({ strong = false, lang = 'en' }: { strong?: boolean; lang?: 'en' | 'es' }) {
  const m = lang === 'es' ? es : en;
  return (
    <aside
      aria-label={m.emergencyLabel}
      data-testid="emergency-banner"
      className={
        strong
          ? 'rounded-lg border-2 border-red-800 bg-red-700 p-4 text-base font-bold text-white'
          : 'rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900'
      }
    >
      {m.emergency}
    </aside>
  );
}
