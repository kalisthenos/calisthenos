import { type SkillTier, TIER_LABEL } from "~/lib/skill-tier";

/**
 * Plakietka tieru — mono wersalik w idiomie `.badge` (klasa nadaje uppercase i mono).
 * Celowo BEZ koloru per tier: w piramidzie tier niesie ciężar, nie barwę, a lime
 * jest zarezerwowany dla postępu podopiecznego (design-system → „Piramida umiejętności").
 */
export function TierBadge({ tier }: { tier: SkillTier }): React.JSX.Element {
  return (
    <span className="badge" aria-label={`Poziom trudności: ${TIER_LABEL[tier]}`}>
      {TIER_LABEL[tier]}
    </span>
  );
}
