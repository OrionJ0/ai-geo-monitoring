export type WebPlatformAdminSessionStatus = {
  browser_configured?: boolean;
  profile_initialized?: boolean;
  login_state?: string;
  last_verified_at?: string | null;
};

export function isManagedWebAdapter(adapterType?: string | null): boolean;

export function getWebPlatformAdminSessionPresentation(
  status?: WebPlatformAdminSessionStatus | null
): {
  color: string;
  label: string;
  detail: string;
};

export function getWebPlatformAdminSessionMeta(
  status?: WebPlatformAdminSessionStatus | null
): {
  lastVerifiedDetail: string;
  accountDetail: string;
};
