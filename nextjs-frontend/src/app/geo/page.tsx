'use client';

import { useEffect } from 'react';
import { Spin } from 'antd';
import { useRouter } from 'next/navigation';
import { resolveGeoDefaultRoute } from '@/utils/geoNavigation.cjs';

export default function GeoPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(resolveGeoDefaultRoute());
  }, [router]);

  return (
    <div
      role="status"
      aria-label="正在进入数据工作台"
      style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}
    >
      <Spin tip="正在进入数据工作台" />
    </div>
  );
}
