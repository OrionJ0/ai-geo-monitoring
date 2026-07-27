'use client';

import { getDeepSeekWebRuntimePresentation } from '@/utils/deepSeekWebRuntimeStatus.cjs';
import { useDeepSeekWebRuntimeStatus } from '@/lib/useDeepSeekWebRuntimeStatus';
import styles from './DeepSeekWebRuntimeStatus.module.css';

export default function DeepSeekWebRuntimeStatus() {
  const { status, loading, unavailable } = useDeepSeekWebRuntimeStatus();
  if (loading && !status && !unavailable) return null;

  const presentation = getDeepSeekWebRuntimePresentation(status, { unavailable });
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
        <span className={styles.kicker}>DEEPSEEK WEB · 单通道队列</span>
        <strong>{presentation.title}</strong>
        <span className={styles.description}>{presentation.description}</span>
      </div>
    </section>
  );
}
