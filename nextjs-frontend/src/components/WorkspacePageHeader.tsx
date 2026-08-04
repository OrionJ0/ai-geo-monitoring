'use client';

import type { ReactNode } from 'react';
import { Breadcrumb } from 'antd';
import styles from './WorkspacePageHeader.module.css';

export default function WorkspacePageHeader({
  section,
  title,
  actions
}: {
  section?: string;
  title: string;
  actions?: ReactNode;
}) {
  const items = [
    { title: '首页' },
    ...(section ? [{ title: section }] : []),
    { title }
  ];

  return (
    <div className={styles.header}>
      <Breadcrumb items={items} />
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
