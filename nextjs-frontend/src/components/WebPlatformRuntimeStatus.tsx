'use client';

import Link from 'next/link';
import {
  getWebPlatformRuntimePresentation,
  selectManagedWebPlatformCodes
} from '@/utils/webPlatformRuntimeStatus.cjs';
import { useWebPlatformRuntimeStatus } from '@/lib/useWebPlatformRuntimeStatus';
import styles from './WebPlatformRuntimeStatus.module.css';

const PLATFORMS = [
  { code: 'deepseek-web', name: 'DeepSeek Web' },
  { code: 'doubao-web', name: '豆包 Web' }
] as const;

function RuntimeStrip({ platform }: { platform: typeof PLATFORMS[number] }) {
  const { status, loading, unavailable } = useWebPlatformRuntimeStatus(platform.code);
  if (loading && !status && !unavailable) return null;

  const presentation = getWebPlatformRuntimePresentation(status, {
    unavailable,
    platformName: platform.name
  });
  if (!presentation) return null;

  return (
    <section
      className={styles.runtimeStrip}
      data-tone={presentation.type}
      data-state={status?.state || 'unknown'}
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.signal} aria-hidden="true">
        <span />
      </span>
      <div className={styles.copy}>
        <strong>{presentation.title}</strong>
        <span className={styles.description}>{presentation.description}</span>
        {presentation.actionHref ? (
          <Link className={styles.action} href={presentation.actionHref}>
            {presentation.actionLabel}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

export default function WebPlatformRuntimeStatus({
  platformCodes
}: {
  platformCodes: readonly string[];
}) {
  return selectManagedWebPlatformCodes(platformCodes).map((code) => {
    const platform = PLATFORMS.find((item) => item.code === code);
    return platform
      ? <RuntimeStrip key={platform.code} platform={platform} />
      : null;
  });
}
