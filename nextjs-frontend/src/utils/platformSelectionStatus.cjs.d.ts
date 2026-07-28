export type PlatformSelectionStatus = {
  code: string;
  name: string;
  selectable: boolean;
  unavailableLabel: string | null;
  displayLabel: string;
};

export function getUnavailablePlatformLabel(reason?: string | null): string;

export function describeSelectedPlatforms(
  codes: unknown[],
  catalog: Array<{
    code?: string;
    name?: string;
    selectable?: boolean;
    unavailable_reason?: string | null;
  }>,
  options?: {
    catalogReady?: boolean;
  }
): PlatformSelectionStatus[];

export function formatUnavailablePlatformSummary(
  statuses: PlatformSelectionStatus[]
): string;
