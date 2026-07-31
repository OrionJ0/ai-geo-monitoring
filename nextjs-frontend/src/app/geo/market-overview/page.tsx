// @ts-nocheck
'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Card,
  Empty,
  Space,
  Statistic,
  Tag,
  Typography
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import useDefaultProjectContext from '@/lib/useDefaultProjectContext';
import useMarketingCapabilities from '@/lib/useMarketingCapabilities';
import useMarketOverview from '@/lib/marketing/useMarketOverview';
import { formatScaled, groupDigits } from '@/utils/marketingValues.cjs';
import { buildRelativeSeries } from '@/utils/marketingChartSeries.cjs';
import styles from './market-overview.module.css';

const { Paragraph, Text, Title } = Typography;

const sourceStatus = {
  AVAILABLE: { label: '数据正常', color: 'success' },
  ZERO: { label: '当前为零', color: 'default' },
  NO_DATA: { label: '当前无数据', color: 'default' },
  STALE: { label: '数据陈旧', color: 'warning' },
  SOURCE_ERROR: { label: '来源异常', color: 'error' },
  LOADING: { label: '读取中', color: 'processing' },
  IDLE: { label: '待开放', color: 'default' }
};

function statusTag(state) {
  const status = sourceStatus[state] || sourceStatus.IDLE;
  return <Tag color={status.color}>{status.label}</Tag>;
}

function exactAdCost(ad) {
  if (!ad?.data?.coverage || !ad?.data?.summary) return null;
  return formatScaled(
    ad.data.summary.costAmountScaled,
    ad.data.coverage.costScale,
    ad.data.coverage.currency
  );
}

function exactVisitors(traffic) {
  const value = traffic?.data?.summary?.visitors;
  return value == null ? null : groupDigits(value);
}

function overviewStatus(status, enabled) {
  if (!enabled) return { label: '数据来源待开放', color: 'default' };
  return {
    PARTIAL: { label: '部分数据可用', color: 'warning' },
    SOURCE_ERROR: { label: '来源暂不可用', color: 'error' },
    EMPTY: { label: '当前无数据', color: 'default' },
    LOADING: { label: '正在读取', color: 'processing' },
    READY: { label: '数据已更新', color: 'success' }
  }[status] || { label: '等待读取', color: 'default' };
}

function TrendTable({ caption, rows, renderValue }) {
  return (
    <details className={styles.dataDetails}>
      <summary>查看等价数据</summary>
      <div className={styles.tableScroller} tabIndex={0}>
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr><th scope="col">日期</th><th scope="col">数值</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <th scope="row">{row.date}</th>
                <td>{renderValue(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function MiniBars({ rows, source }) {
  return (
    <div className={styles.miniBars} data-source={source} aria-hidden="true">
      {rows.map((row) => (
        <div key={row.date}>
          <i style={{ height: row.relativePercent || '0%' }} />
          <span>{row.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function MarketOverviewPage() {
  const defaultContext = useDefaultProjectContext();
  const marketing = useMarketingCapabilities();
  const projectId = defaultContext.project?.id || '';
  const enabled = (
    marketing.capabilities.adsRead
    || marketing.capabilities.trafficRead
  );
  const overview = useMarketOverview({ projectId, enabled });

  const adSeries = useMemo(() => buildRelativeSeries(
    (overview.ad.data?.trend || []).map((row) => ({
      date: row.date,
      value: row.costAmountScaled
    }))
  ), [overview.ad.data?.trend]);
  const trafficSeries = useMemo(() => buildRelativeSeries(
    (overview.traffic.data?.trend || []).map((row) => ({
      date: row.date,
      value: row.visitors
    }))
  ), [overview.traffic.data?.trend]);

  const ad = overview.ad;
  const traffic = overview.traffic;
  const adCoverage = ad.data?.coverage;
  const trafficCoverage = traffic.data?.coverage;
  const adCost = exactAdCost(ad);
  const visitors = exactVisitors(traffic);
  const pageStatus = overviewStatus(overview.status, enabled);
  const attentionItems = [
    ad.state === 'SOURCE_ERROR'
      ? {
        id: 'ads-source-error',
        title: '广告来源读取异常',
        detail: ad.errorMessage || '广告快照暂时不可用',
        href: '/geo/ad-performance'
      }
      : null,
    ad.state === 'STALE'
      ? {
        id: 'ads-stale',
        title: '广告快照已陈旧',
        detail: '当前保留最后一次完整快照，请检查刷新状态。',
        href: '/geo/ad-performance'
      }
      : null,
    traffic.state === 'SOURCE_ERROR'
      ? {
        id: 'traffic-source-error',
        title: '网站流量来源异常',
        detail: traffic.errorMessage || '百度统计暂时不可用',
        href: '/geo/website-traffic'
      }
      : null
  ].filter(Boolean);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <Title level={2} style={{ marginBottom: 4 }}>市场总览</Title>
          <Text type="secondary">最近 30 天投入和网站流量，以及需要关注的数据状态。</Text>
        </div>
        <Space wrap>
          <Tag color={pageStatus.color}>{pageStatus.label}</Tag>
          <Button
            icon={<ReloadOutlined />}
            onClick={overview.reload}
            loading={overview.status === 'LOADING'}
            disabled={!enabled || !projectId}
          >
            重新读取
          </Button>
        </Space>
      </div>

      {defaultContext.errorMessage ? (
        <Alert
          type="warning"
          showIcon
          title="默认项目不可用"
          description={defaultContext.errorMessage}
        />
      ) : null}
      {!marketing.loading && !enabled ? (
        <Alert
          type="info"
          showIcon
          title="市场数据来源尚未正式开放"
          description="页面结构已开放；百度来源可用后会在对应位置展示真实数据。"
        />
      ) : null}

      <section aria-labelledby="journey-heading">
        <div className={styles.sectionHeader}>
          <div>
            <Title level={4} id="journey-heading">全链路概览</Title>
            <Text type="secondary">各来源独立观察，不构成跨来源归因。</Text>
          </div>
        </div>
        <div className={styles.journeyGrid}>
          <Card
            size="small"
            className={styles.stageCard}
            title="广告投放"
            extra={statusTag(ad.state)}
          >
            <Statistic
              title="广告消费"
              value={adCost || '—'}
              styles={{ content: { color: '#17366d' } }}
            />
            <div className={styles.stageMeta}>
              <Text type="secondary">覆盖范围</Text>
              <Text>{adCoverage ? `${adCoverage.from} 至 ${adCoverage.to}` : '暂无'}</Text>
              <Text type="secondary">最后成功</Text>
              <Text>{adCoverage?.lastSuccessfulAt
                ? new Date(adCoverage.lastSuccessfulAt).toLocaleString('zh-CN')
                : ad.errorMessage || '尚无'}</Text>
            </div>
            <Link href="/geo/ad-performance">查看广告表现</Link>
          </Card>

          <Card
            size="small"
            className={styles.stageCard}
            title="网站访问"
            extra={statusTag(traffic.state)}
          >
            <Statistic
              title="访客数（UV）"
              value={visitors || '—'}
              styles={{ content: { color: '#17366d' } }}
            />
            <div className={styles.stageMeta}>
              <Text type="secondary">覆盖范围</Text>
              <Text>{trafficCoverage
                ? `${trafficCoverage.from} 至 ${trafficCoverage.to}`
                : '暂无'}</Text>
              <Text type="secondary">读取方式</Text>
              <Text>{traffic.data?.mode === 'LIVE_PILOT'
                ? '百度统计实时试点'
                : traffic.errorMessage || '百度统计实时只读'}</Text>
            </div>
            <Link href="/geo/website-traffic">查看网站流量</Link>
          </Card>

          <Card
            size="small"
            className={`${styles.stageCard} ${styles.unavailableCard}`}
            title="原始咨询"
            extra={<Tag>来源暂不可接入</Tag>}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="尚无可展示数据"
            />
            <Paragraph type="secondary">落地页系统尚未提供稳定 API。</Paragraph>
            <Link href="/geo/consultations">查看接入说明</Link>
          </Card>

          <Card
            size="small"
            className={`${styles.stageCard} ${styles.unavailableCard}`}
            title="订单结果"
            extra={<Tag>来源暂不可接入</Tag>}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="尚无可展示数据"
            />
            <Paragraph type="secondary">销售系统尚未提供稳定 API；未来仅同步订单签订金额。</Paragraph>
            <Link href="/geo/order-results">查看接入说明</Link>
          </Card>
        </div>
      </section>

      <section aria-labelledby="trend-heading">
        <div className={styles.sectionHeader}>
          <div>
            <Title level={4} id="trend-heading">投入与流量趋势</Title>
            <Text type="secondary">广告和网站流量分别展示，不连接、不换算。</Text>
          </div>
        </div>
        <div className={styles.trendGrid}>
          <Card
            className={styles.trendCard}
            title="每日广告消费"
            extra={<Link href="/geo/ad-performance">查看明细</Link>}
          >
            {adSeries.length ? (
              <>
                <MiniBars rows={adSeries} source="ads" />
                <TrendTable
                  caption="广告逐日趋势等价数据表"
                  rows={adSeries}
                  renderValue={(row) => formatScaled(
                    row.exactValue,
                    adCoverage.costScale,
                    adCoverage.currency
                  )}
                />
              </>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={ad.errorMessage || '暂无广告趋势数据'}
              />
            )}
          </Card>

          <Card
            className={styles.trendCard}
            title="每日网站访客"
            extra={<Link href="/geo/website-traffic">查看明细</Link>}
          >
            {trafficSeries.length ? (
              <>
                <MiniBars rows={trafficSeries} source="traffic" />
                <TrendTable
                  caption="网站逐日趋势等价数据表"
                  rows={trafficSeries}
                  renderValue={(row) => groupDigits(row.exactValue)}
                />
              </>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={traffic.errorMessage || '暂无网站访客趋势数据'}
              />
            )}
          </Card>
        </div>
      </section>

      <section aria-labelledby="attention-heading">
        <div className={styles.sectionHeader}>
          <div>
            <Title level={4} id="attention-heading">需要关注</Title>
            <Text type="secondary">当前只提示数据健康；趋势阈值尚未批准。</Text>
          </div>
        </div>
        <Card className={styles.attentionCard}>
          {attentionItems.length ? (
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              {attentionItems.map((item) => (
                <Alert
                  key={item.id}
                  type="warning"
                  showIcon
                  title={item.title}
                  description={item.detail}
                  action={<Link href={item.href}>查看</Link>}
                />
              ))}
            </Space>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="当前未发现数据健康问题"
            />
          )}
        </Card>
      </section>
    </div>
  );
}
