/**
 * Zygos i18n scanner — now a thin re-export of the FLEET-WIDE detector.
 *
 * The detector originally lived here, because zygos is where the defect class was first caught
 * (44 missing keys at once, three of them shipped to the deployed console in `aria-label`s that no
 * screenshot could ever show). Nothing about it was ever zygos-specific: `FM()` has no fallback in
 * ANY of these apps, and the shared `@dloizides/ui-*` kit resolves its strings through whichever
 * host app embeds it — so the same bug is one kit upgrade away in every portal.
 *
 * It therefore moved to `helpers/i18n-raw-key-scan.ts` and is now pointed at agora-web,
 * erevna-web, katalogos-web and kefi-web as well. This file stays so the existing
 * `zygos-i18n.ui.spec.ts` keeps importing from its own directory, and — more importantly — so
 * zygos and the other portals can never drift onto two subtly different detectors. There is one
 * implementation and one set of exclusion rules.
 */
export {
  collectDomStrings,
  describeRawKeys,
  findRawKeys,
  isLegitimateDottedText,
  isRawTranslationKey,
} from '../../helpers/i18n-raw-key-scan.js';

export type { RawKeyHit, RawKeySource } from '../../helpers/i18n-raw-key-scan.js';
