export type KeywordPreviousSummaryIdentity = {
  projectId: string;
  revision: string;
  previousFrom: string;
  previousTo: string;
  query?: string;
  campaignId?: string;
  adGroupId?: string;
};

export type KeywordPreviousSummaryCache<T> = {
  read: (
    key: string,
    loader: () => Promise<T>,
    force?: boolean
  ) => Promise<T>;
  clear: () => void;
};

export function keywordPreviousSummaryKey(
  identity: KeywordPreviousSummaryIdentity
): string {
  return JSON.stringify([
    identity.projectId,
    identity.revision,
    identity.previousFrom,
    identity.previousTo,
    identity.query || null,
    identity.campaignId || null,
    identity.adGroupId || null
  ]);
}

export function createKeywordPreviousSummaryCache<T>(): KeywordPreviousSummaryCache<T> {
  let entry: { key: string; promise: Promise<T> } | null = null;

  return {
    read(key, loader, force = false) {
      if (!force && entry?.key === key) return entry.promise;
      const promise = loader();
      entry = { key, promise };
      return promise;
    },
    clear() {
      entry = null;
    }
  };
}
