'use client';

/* eslint-disable @next/next/no-img-element */

import { ExportOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import WorkspacePageHeader from '@/components/WorkspacePageHeader';
import styles from './quick-links.module.css';

const { Title } = Typography;

type SiteIcon = {
  src?: string;
  fallback: string;
};

type SystemEntry = {
  name: string;
  icon: SiteIcon;
  href: string;
};

type SystemGroup = {
  title: string;
  entries: SystemEntry[];
};

const systemGroups: SystemGroup[] = [
  {
    title: '广告投放',
    entries: [
      {
        name: '百度推广',
        icon: {
          src: 'https://www.baidu.com/favicon.ico',
          fallback: '百',
        },
        href: 'https://www2.baidu.com/',
      },
    ],
  },
  {
    title: '流量与站点',
    entries: [
      {
        name: '百度统计',
        icon: {
          src: 'https://tongji.baidu.com/favicon.ico',
          fallback: '统',
        },
        href: 'https://tongji.baidu.com/',
      },
      {
        name: '百度搜索资源平台',
        icon: {
          src: 'https://zy.baidu.com/favicon.ico',
          fallback: '搜',
        },
        href: 'https://zy.baidu.com/',
      },
      {
        name: 'Bing 网站管理平台',
        icon: {
          src: 'https://www.bing.com/favicon.ico',
          fallback: 'B',
        },
        href: 'https://www.bing.com/webmasters/',
      },
    ],
  },
  {
    title: '落地页',
    entries: [
      {
        name: '官网首页',
        icon: {
          src: 'https://gato.com.cn/uploads/images/6fd57a1b-0523-460d-a4a7-4d3aa7001d60.svg',
          fallback: '广',
        },
        href: 'https://gato.com.cn/',
      },
      {
        name: '爱采购',
        icon: {
          src: 'https://b2b.baidu.com/favicon.ico',
          fallback: '采',
        },
        href: 'https://b2b.baidu.com/',
      },
      {
        name: '基木鱼',
        icon: {
          fallback: '基',
        },
        href: 'https://www2.baidu.com/',
      },
      {
        name: '百度巧舱／商家智能体',
        icon: {
          src: 'https://fe-resource.cdn.bcebos.com/agent/qiaoCangIcon.png',
          fallback: '巧',
        },
        href: 'https://aiagent.baidu.com/mbot/index',
      },
    ],
  },
  {
    title: '接待与管理',
    entries: [
      {
        name: '官网后台',
        icon: {
          src: 'https://gato.com.cn/uploads/images/6fd57a1b-0523-460d-a4a7-4d3aa7001d60.svg',
          fallback: '广',
        },
        href: 'https://gato.com.cn/admin',
      },
      {
        name: '爱采购商家后台',
        icon: {
          src: 'https://b2b.baidu.com/favicon.ico',
          fallback: '商',
        },
        href: 'https://b2bwork.baidu.com/login',
      },
      {
        name: '53KF 后台',
        icon: {
          src: 'https://www.53kf.com/favicon.ico',
          fallback: '53',
        },
        href: 'https://www.53kf.com/login/guide',
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
      {icon.src ? (
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
      ) : null}
    </span>
  );
}

function SystemCard({ entry }: { entry: SystemEntry }) {
  const content = (
    <>
      <WebsiteIcon icon={entry.icon} name={entry.name} />
      <Title level={4} className={styles.systemName}>{entry.name}</Title>
      <ExportOutlined className={styles.launchIcon} aria-hidden="true" />
    </>
  );

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

export default function QuickLinksPage() {
  return (
    <div className={styles.page} aria-label="常用网站">
      <div className={styles.pageStack}>
        <WorkspacePageHeader title="常用网站" />
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
    </div>
  );
}
