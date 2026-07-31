'use client';

import { ExportOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import styles from './quick-links.module.css';

const { Paragraph, Text, Title } = Typography;

type ExternalLink = {
  label: string;
  href: string;
};

type SiteIcon = {
  src: string;
  fallback: string;
};

type SystemEntry = {
  name: string;
  description: string;
  icon: SiteIcon;
  links?: ExternalLink[];
  unavailable?: string;
};

type SystemGroup = {
  title: string;
  description: string;
  entries: SystemEntry[];
};

const systemGroups: SystemGroup[] = [
  {
    title: '投放与访问',
    description: '广告投放、落地页和网站流量相关入口。',
    entries: [
      {
        name: '百度营销',
        description: '管理项目、方案、关键词、创意、预算、oCPC 和转化追踪。',
        icon: {
          src: 'https://www.baidu.com/favicon.ico',
          fallback: '百',
        },
        links: [{ label: '打开广告投放后台', href: 'https://www2.baidu.com/' }],
      },
      {
        name: '基木鱼',
        description: '管理百度推广使用的落地页，从百度营销后台进入“基木鱼”。',
        icon: {
          src: 'https://www.baidu.com/favicon.ico',
          fallback: '基',
        },
        links: [{ label: '从百度营销进入', href: 'https://www2.baidu.com/' }],
      },
      {
        name: '百度统计',
        description: '查看官网流量、页面行为、访问来源及转化数据。',
        icon: {
          src: 'https://tongji.baidu.com/favicon.ico',
          fallback: '统',
        },
        links: [{ label: '打开百度统计', href: 'https://tongji.baidu.com/' }],
      },
    ],
  },
  {
    title: '接待与线索',
    description: '智能接待、咨询表单和线索跟进相关入口。',
    entries: [
      {
        name: '百度巧舱／商家智能体',
        description: '配置商家智能体、知识内容和接待策略。',
        icon: {
          src: 'https://fe-resource.cdn.bcebos.com/agent/qiaoCangIcon.png',
          fallback: '巧',
        },
        links: [{ label: '打开巧舱管理后台', href: 'https://aiagent.baidu.com/mbot/index' }],
      },
      {
        name: '百度 Agent 对话页',
        description: '面向访客的智能体咨询页面，每个商家的访问地址不同。',
        icon: {
          src: 'https://fe-resource.cdn.bcebos.com/agent/qiaoCangIcon.png',
          fallback: 'A',
        },
        unavailable: '完整地址待补充',
      },
      {
        name: '营销通',
        description: '管理咨询、表单、智能电话等营销组件。',
        icon: {
          src: 'https://fe-resource.cdn.bcebos.com/vector/images/fm_favicon.ico',
          fallback: '营',
        },
        links: [{ label: '打开营销通', href: 'https://yingxiaotong.baidu.com/' }],
      },
      {
        name: '爱番番',
        description: '汇总、分配和跟进线索及会话。',
        icon: {
          src: 'https://aifanfan.baidu.com/favicon.ico',
          fallback: '爱',
        },
        links: [{ label: '打开爱番番', href: 'https://aifanfan.baidu.com/' }],
      },
    ],
  },
  {
    title: '官网与采购',
    description: '公司官网内容维护和百度采购业务入口。',
    entries: [
      {
        name: '上海广拓官网后台',
        description: '维护公司官网和自建落地页内容。',
        icon: {
          src: 'https://gato.com.cn/uploads/images/6fd57a1b-0523-460d-a4a7-4d3aa7001d60.svg',
          fallback: '广',
        },
        links: [{ label: '打开官网后台', href: 'https://gato.com.cn/admin' }],
      },
      {
        name: '百度爱采购',
        description: '查看商品与店铺展示，或进入商家后台维护采购业务。',
        icon: {
          src: 'https://b2b.baidu.com/favicon.ico',
          fallback: '采',
        },
        links: [
          { label: '打开买家平台', href: 'https://b2b.baidu.com/' },
          { label: '打开商家后台', href: 'https://b2bwork.baidu.com/login' },
        ],
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
  return (
    <article className={styles.systemCard}>
      <div className={styles.cardHeading}>
        <WebsiteIcon icon={entry.icon} name={entry.name} />
        <Title level={4} className={styles.systemName}>{entry.name}</Title>
      </div>
      <Paragraph className={styles.description}>{entry.description}</Paragraph>
      <div className={styles.actions}>
        {entry.links?.map((link) => (
          <a
            className={styles.externalLink}
            href={link.href}
            key={`${entry.name}-${link.label}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`${link.label}，在新标签页打开`}
          >
            {link.label}
            <ExportOutlined aria-hidden="true" />
          </a>
        ))}
        {entry.unavailable ? (
          <Text className={styles.unavailable}>{entry.unavailable}</Text>
        ) : null}
      </div>
    </article>
  );
}

export default function QuickLinksPage() {
  return (
    <div className={styles.page} aria-labelledby="quick-links-title">
      <header className={styles.pageHeader}>
        <Text className={styles.eyebrow}>内部工作入口</Text>
        <Title id="quick-links-title" level={2} className={styles.pageTitle}>
          快捷导航
        </Title>
        <Paragraph className={styles.intro}>
          集中打开常用营销、官网和线索系统。所有入口都会在新标签页打开，业务操作仍在来源系统完成。
        </Paragraph>
      </header>

      <div className={styles.groupList}>
        {systemGroups.map((group) => (
          <section className={styles.group} key={group.title} aria-labelledby={`group-${group.title}`}>
            <div className={styles.groupHeader}>
              <Title level={3} id={`group-${group.title}`} className={styles.groupTitle}>
                {group.title}
              </Title>
              <Text className={styles.groupDescription}>{group.description}</Text>
            </div>
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
