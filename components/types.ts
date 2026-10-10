import type { Metrics } from '@/lib/metrics';
import type { Role } from '@/lib/store';
import type { Dataset } from '@/lib/types';
import type { SP } from '@/lib/url';

export type View = 'overview' | 'queue' | 'calls' | 'escalations' | 'calendar' | 'pricing';

/** Everything a view needs. Built once in app/page.tsx. */
export interface ViewCtx {
  /** Dataset for the signed-in role (the founder's is already stripped of personal data). */
  ds: Dataset;
  /** Metrics for the selected month. */
  m: Metrics;
  month: string;
  months: string[];
  now: Date;
  role: Role;
  includeSynthetic: boolean;
  /** Current search params — pass to href() to build links that keep state. */
  sp: SP;
  /** Current URL (path + query) — put in a hidden `return_to` input of every form so actions redirect back here. */
  returnTo: string;
  /** Anonymous visitor of the designer screens (PUBLIC_VIEW): can read everything, cannot change anything. */
  readOnly?: boolean;
}
