'use client';

import { ExportOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import styles from './quick-links.module.css';

const { Text, Title } = Typography;

type SiteIcon = {
  src: string;
  fallback: string;
};

type SystemEntry = {
  name: string;
  icon: SiteIcon;
  href?: string;
  unavailable?: string;
};

type SystemGroup = {
  title: string;
  entries: SystemEntry[];
};

const systemGroups: SystemGroup[] = [
  {
    title: '投放与访问',
    entries: [
      {
        name: '百度营销',
        icon: {
          src: 'https://www.baidu.com/favicon.ico',
          fallback: '百',
        },
        href: 'https://www2.baidu.com/',
      },
      {
        name: '基木鱼',
        icon: {
          src: 'https://www.baidu.com/favicon.ico',
          fallback: '基',
        },
        href: 'https://www2.baidu.com/',
      },
      {
        name: '百度统计',
        icon: {
          src: 'https://tongji.baidu.com/favicon.ico',
          fallback: '统',
        },
        href: 'https://tongji.baidu.com/',
      },
    ],
  },
  {
    title: '接待与线索',
    entries: [
      {
        name: '百度巧舱／商家智能体',
        icon: {
          src: 'https://fe-resource.cdn.bcebos.com/agent/qiaoCangIcon.png',
          fallback: '巧',
        },
        href: 'https://aiagent.baidu.com/mbot/index',
      },
      {
        name: '百度 Agent 对话页',
        icon: {
          src: 'https://fe-resource.cdn.bcebos.com/agent/qiaoCangIcon.png',
          fallback: 'A',
        },
        unavailable: '完整地址待补充',
      },
      {
        name: '营销通',
        icon: {
          src: 'https://fe-resource.cdn.bcebos.com/vector/images/fm_favicon.ico',
          fallback: '营',
        },
        href: 'https://yingxiaotong.baidu.com/',
      },
      {
        name: '爱番番',
        icon: {
          src: 'https://aifanfan.baidu.com/favicon.ico',
          fallback: '爱',
        },
        href: 'https://aifanfan.baidu.com/',
      },
    ],
  },
  {
    title: '官网与采购',
    entries: [
      {
        name: '上海广拓官网后台',
        icon: {
          src: 'https://gato.com.cn/uploads/images/6fd57a1b-0523-460d-a4a7-4d3aa7001d60.svg',
          fallback: '广',
        },
        href: 'https://gato.com.cn/admin',
      },
      {
        name: '百度爱采购',
        icon: {
          src: 'https://b2b.baidu.com/favicon.ico',
          fallback: '采',
        },
        href: 'https://b2b.baidu.com/',
      },
      {
        name: '爱采购商家后台',
        icon: {
          src: 'https://b2b.baidu.com/favicon.ico',
          fallback: '商',
        },
        href: 'https://b2bwork.baidu.com/login',
      },
    ],
  },
];

function WebsiteIcon({
  icon,
  name,
}: {
  icon: SiteIcon;
  name: string;
}) {
  return (
    <span className={styles.siteIcon} aria-hidden="true">
      <span className={styles.iconFallback}>{icon.fallback}</span>
      {/* 外部站点图标需保留原始地址，并在失败时显示本地文字回退。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={icon.src}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
        data-site={name}
      />
    </span>
  );
}

function SystemCard({ entry }: { entry: SystemEntry }) {
  const content = (
    <>
      <WebsiteIcon icon={entry.icon} name={entry.name} />
      <Title level={4} className={styles.systemName}>{entry.name}</Title>
      {entry.href ? <ExportOutlined className={styles.launchIcon} aria-hidden="true" /> : null}
      {entry.unavailable ? (
        <Text className={styles.unavailable}>{entry.unavailable}</Text>
      ) : null}
    </>
  );

  if (entry.href) {
    return (
      <a
        className={styles.systemCard}
        href={entry.href}
        target="_blank"
        rel="noreferrer"
        aria-label={`${entry.name}，在新标签页打开`}
      >
        {content}
      </a>
    );
  }

  return (
    <article className={`${styles.systemCard} ${styles.disabledCard}`}>
      {content}
    </article>
  );
}

export default function QuickLinksPage() {
  return (
    <div className={styles.page} aria-label="常用网站">
      <div className={styles.groupList}>
        {systemGroups.map((group) => (
          <section className={styles.group} key={group.title} aria-labelledby={`group-${group.title}`}>
            <Title level={3} id={`group-${group.title}`} className={styles.groupTitle}>
              {group.title}
            </Title>
            <div className={styles.cardGrid}>
              {group.entries.map((entry) => (
                <SystemCard entry={entry} key={entry.name} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
