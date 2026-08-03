import type { KeywordDailyFact } from '@/lib/marketing/keywordAnalysisTypes';

export const KEYWORD_FIXTURE_RANGE: Readonly<{
  from: string;
  to: string;
}>;

export type KeywordFixture = {
  source: 'development-fixture';
  dataState: 'ready' | 'empty';
  projectId: string;
  projectName: string;
  currency: string;
  costScale: number;
  updatedAt: string;
  availableFrom: string;
  availableTo: string;
  facts: KeywordDailyFact[];
};

export function buildKeywordFixture(empty?: boolean): KeywordFixture;
