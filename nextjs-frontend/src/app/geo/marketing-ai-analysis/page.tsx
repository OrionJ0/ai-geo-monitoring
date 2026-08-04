'use client';

import React, { useMemo, useState } from 'react';
import { Line } from '@ant-design/plots';
import {
  ArrowLeftOutlined,
  EyeOutlined,
  HistoryOutlined,
  LockOutlined
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Tag,
  Tooltip
} from 'antd';
import WorkspacePageHeader from '@/components/WorkspacePageHeader';
import MarketingMetricCard, {
  MarketingMetricGrid
} from '@/components/marketing/MarketingMetricCard';
import {
  MARKETING_AI_REPORT_PREVIEW,
  type PreviewTrend
} from '@/fixtures/marketingAiReportPreview.fixture';
import styles from './marketing-ai-analysis.module.css';

type ChartDatum = {
  slot: number;
  actualDate: string;
  value: number;
  period: '当前周期' | '上一周期';
  unit: string;
};

const preview = MARKETING_AI_REPORT_PREVIEW;

function formatChartValue(value: number, unit: string) {
  return unit === '元'
    ? `¥${value.toLocaleString('zh-CN')}`
    : `${value.toLocaleString('zh-CN')} ${unit}`;
}

function buildChartData(trend: PreviewTrend): ChartDatum[] {
  return trend.points.flatMap((point) => {
    const rows: ChartDatum[] = [{
      slot: point.slot,
      actualDate: point.date,
      value: point.current,
      period: '当前周期',
      unit: trend.unit
    }];
    if (point.previous !== null) {
      rows.push({
        slot: point.slot,
        actualDate: point.date,
        value: point.previous,
        period: '上一周期',
        unit: trend.unit
      });
    }
    return rows;
  });
}

function ReportHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      title="示例报告历史"
      open={open}
      onClose={onClose}
      width="min(420px, 100vw)"
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        title="这里展示的是页面交互样例"
        description="尚未读取数据库，也没有真实历史报告。"
      />
      <ol className={styles.historyList} aria-label="示例报告历史列表">
        <li className={styles.historyItem} data-current="true">
          <div>
            <strong>营销表现月度分析</strong>
            <span>2026-07-05 至 2026-08-03</span>
          </div>
          <Tag color="blue">当前示例</Tag>
        </li>
        <li className={styles.historyItem}>
          <div>
            <strong>营销表现月度分析</strong>
            <span>2026-06-05 至 2026-07-04</span>
          </div>
          <Tag>示例</Tag>
        </li>
        <li className={styles.historyItem}>
          <div>
            <strong>营销表现月度分析</strong>
            <span>2026-05-06 至 2026-06-04</span>
          </div>
          <Tag>示例</Tag>
        </li>
      </ol>
    </Drawer>
  );
}

function EmptyReport({ onPreview }: { onPreview: () => void }) {
  return (
    <section className={styles.emptyPanel} aria-labelledby="empty-title">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={(
          <div className={styles.emptyCopy}>
            <h1 id="empty-title">生成第一份营销分析报告</h1>
            <p>正式功能将读取完整历史周期，由程序计算事实，再由 AI 生成固定报告和必要图表。</p>
          </div>
        )}
      >
        <Button icon={<EyeOutlined />} onClick={onPreview}>
          查看示例报告
        </Button>
      </Empty>
    </section>
  );
}

function PreviewReport() {
  const [trendKey, setTrendKey] = useState<PreviewTrend['key']>('adCost');
  const selectedTrend = preview.trends.find((trend) => trend.key === trendKey)
    || preview.trends[0];
  const chartData = useMemo(
    () => buildChartData(selectedTrend),
    [selectedTrend]
  );

  return (
    <article className={styles.report} aria-label="营销数据 AI 分析示例报告">
      <section className={styles.snapshot} aria-labelledby="report-title">
        <div className={styles.snapshotIdentity}>
          <div className={styles.reportSeal}>
            <LockOutlined aria-hidden="true" />
            已冻结示例
          </div>
          <h1 id="report-title">{preview.title}<span>示例</span></h1>
          <p className={styles.reportSummary}>{preview.summary}</p>
          <dl className={styles.reportMeta}>
            <div><dt>本期</dt><dd>{preview.currentPeriod}</dd></div>
            <div><dt>上一周期</dt><dd>{preview.previousPeriod}</dd></div>
            <div><dt>生成时间</dt><dd>{preview.generatedAt}</dd></div>
          </dl>
        </div>

        <div className={styles.coveragePanel} aria-labelledby="coverage-heading">
          <div className={styles.coverageHeading}>
            <h2 id="coverage-heading">数据覆盖</h2>
            <span>3 个首版来源</span>
          </div>
          <div className={styles.coverageBar}>
            {preview.sources.map((source) => (
              <div
                className={styles.coverageSource}
                data-state={source.state === '完整' ? 'complete' : 'partial'}
                key={source.key}
              >
                <div>
                  <strong>{source.label}</strong>
                  <span className={styles.coverageState}>{source.state}</span>
                </div>
                <span>{source.currentCoverage} · 上期 {source.previousCoverage}</span>
                <small>{source.note}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.metricSection} aria-labelledby="metric-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="metric-heading">核心指标</h2>
            <p>数值由程序按来源口径计算；本页仅展示样例。</p>
          </div>
          <span className={styles.factLabel}>程序事实</span>
        </div>
        <div className={styles.metricGridOverride}>
          <MarketingMetricGrid ariaLabel="示例报告核心指标">
            {preview.metrics.map((metric) => (
              <MarketingMetricCard
                key={metric.title}
                title={metric.title}
                current={metric.current}
                previous={metric.previous}
                change={metric.change}
                tone={metric.tone}
                info={metric.info}
                previousMissingReason={metric.missingReason}
                changeMissingReason={metric.missingReason}
              />
            ))}
          </MarketingMetricGrid>
        </div>
      </section>

      <div className={styles.analysisGrid}>
        <section className={styles.insightSection} aria-labelledby="insight-heading">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="insight-heading">关键洞察</h2>
              <p>每条解释都与程序事实并排，不把推测写成结论。</p>
            </div>
            <span className={styles.aiLabel}>AI 解读</span>
          </div>
          <div className={styles.insightList}>
            {preview.insights.map((insight) => (
              <article className={styles.insightItem} key={insight.id}>
                <div className={styles.insightTitleRow}>
                  <Tag>{insight.source}</Tag>
                  <h3>{insight.title}</h3>
                </div>
                <div className={styles.evidenceSplit}>
                  <div>
                    <span>程序事实</span>
                    <p>{insight.fact}</p>
                  </div>
                  <div>
                    <span>AI 解读</span>
                    <p>{insight.interpretation}</p>
                  </div>
                </div>
                <small>{insight.evidence}</small>
              </article>
            ))}
          </div>
        </section>

        <aside className={styles.actionSection} aria-labelledby="action-heading">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="action-heading">建议优先级</h2>
              <p>建议是待执行或待验证方向，不是已证明事实。</p>
            </div>
          </div>
          <ol className={styles.actionList}>
            {preview.actions.map((action) => (
              <li key={action.title}>
                <span>{action.priority}</span>
                <div>
                  <strong>{action.title}</strong>
                  <p>{action.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <section className={styles.trendSection} aria-labelledby="trend-heading">
        <div className={styles.trendHeader}>
          <div>
            <h2 id="trend-heading">来源趋势</h2>
            <p>一次只查看一个来源、一个量纲，避免跨来源混绘。</p>
          </div>
          <label className={styles.trendSelect}>
            <span>指标</span>
            <select
              aria-label="示例趋势指标"
              value={trendKey}
              onChange={(event) => setTrendKey(event.target.value as PreviewTrend['key'])}
            >
              {preview.trends.map((trend) => (
                <option key={trend.key} value={trend.key}>{trend.label}</option>
              ))}
            </select>
          </label>
        </div>
        <dl className={styles.trendSummary} aria-label="示例趋势摘要">
          <div><dt>来源</dt><dd>{selectedTrend.source}</dd></div>
          <div><dt>本期</dt><dd>{selectedTrend.currentTotal}</dd></div>
          <div><dt>上一周期</dt><dd>{selectedTrend.previousTotal}</dd></div>
          <div><dt>周期变化</dt><dd>{selectedTrend.change}</dd></div>
        </dl>
        <div
          className={styles.chartRegion}
          role="img"
          aria-label={`${selectedTrend.label}示例趋势，本期${selectedTrend.currentTotal}，上一周期${selectedTrend.previousTotal}，${selectedTrend.change}`}
        >
          <Line
            data={chartData}
            xField="slot"
            yField="value"
            seriesField="period"
            colorField="period"
            height={248}
            scale={{
              x: { tickCount: selectedTrend.points.length },
              y: { domainMin: 0 },
              color: {
                domain: ['当前周期', '上一周期'],
                range: ['#2f6bff', '#94a3b8']
              }
            }}
            axis={{
              x: {
                title: false,
                tick: false,
                labelAutoRotate: false,
                labelFormatter: (value: string) => (
                  selectedTrend.points[Math.round(Number(value))]?.date || ''
                )
              },
              y: {
                title: false,
                grid: true,
                labelFormatter: (value: string) => Number(value).toLocaleString('zh-CN')
              }
            }}
            legend={{ color: { position: 'bottom' } }}
            point={{ size: 3 }}
            style={{
              lineWidth: 2,
              lineDash: (datum: Record<string, unknown> | Array<Record<string, unknown>>) => (
                (Array.isArray(datum) ? datum[0]?.period : datum?.period) === '上一周期'
                  ? [6, 4]
                  : [0, 0]
              )
            }}
            tooltip={{
              title: { field: 'actualDate' },
              items: [
                (datum: ChartDatum) => ({
                  name: datum.period,
                  value: formatChartValue(datum.value, datum.unit),
                  color: datum.period === '当前周期' ? '#2f6bff' : '#94a3b8'
                })
              ]
            }}
            animate={false}
          />
        </div>
        <details className={styles.dataDetails}>
          <summary>查看趋势等价数据</summary>
          <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="示例趋势等价数据表">
            <table className={styles.dataTable}>
              <caption>{selectedTrend.label}示例趋势等价数据</caption>
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">本期</th>
                  <th scope="col">上一周期</th>
                </tr>
              </thead>
              <tbody>
                {selectedTrend.points.map((point) => (
                  <tr key={point.slot}>
                    <td>{point.date}</td>
                    <td>{formatChartValue(point.current, selectedTrend.unit)}</td>
                    <td>{point.previous === null ? '—' : formatChartValue(point.previous, selectedTrend.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className={styles.coverageTableSection} aria-labelledby="coverage-table-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="coverage-table-heading">来源覆盖与口径</h2>
            <p>缺失、部分覆盖和真实零值不会合并成同一种状态。</p>
          </div>
        </div>
        <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="示例来源覆盖表">
          <table className={styles.dataTable}>
            <caption>示例报告来源覆盖</caption>
            <thead>
              <tr>
                <th scope="col">来源</th>
                <th scope="col">本期覆盖</th>
                <th scope="col">上一周期覆盖</th>
                <th scope="col">状态</th>
                <th scope="col">说明</th>
              </tr>
            </thead>
            <tbody>
              {preview.sources.map((source) => (
                <tr key={source.key}>
                  <th scope="row">{source.label}</th>
                  <td>{source.currentCoverage}</td>
                  <td>{source.previousCoverage}</td>
                  <td>
                    <span
                      className={styles.statusPill}
                      data-state={source.state === '完整' ? 'complete' : 'partial'}
                    >
                      {source.state}
                    </span>
                  </td>
                  <td>{source.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.limitations}>
          <h3>口径限制</h3>
          <ul>
            {preview.limitations.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>
    </article>
  );
}

export default function MarketingAiAnalysisPage() {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const previewEnabled = process.env.NODE_ENV !== 'production';

  if (!previewEnabled) {
    return (
      <div className={styles.page} aria-label="营销数据 AI 分析未启用">
        <WorkspacePageHeader title="营销数据 AI 分析" />
        <Alert
          type="info"
          showIcon
          title="营销数据 AI 分析尚未在生产环境启用"
          description="当前正式流程不会展示示例报告，也不会读取来源数据。"
        />
      </div>
    );
  }

  return (
    <div className={styles.page} aria-label="营销数据 AI 分析">
      <WorkspacePageHeader
        title="营销数据 AI 分析"
        actions={(
          <div className={styles.headerActions}>
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
              示例历史
            </Button>
            <Tooltip title="后端报告生成接口尚未接入">
              <span>
                <Button type="primary" disabled>生成报告</Button>
              </span>
            </Tooltip>
          </div>
        )}
      />

      <Alert
        type={previewVisible ? 'warning' : 'info'}
        showIcon
        title={previewVisible
          ? '正在查看示例报告，所有数字均为非真实数据'
          : '前端预览页已开放，真实报告生成尚未接入'}
        description={previewVisible
          ? '示例只用于确认信息结构和视觉效果，不读取来源数据、不写入数据库，也不能用于业务判断。'
          : '当前不会读取来源数据，也不会生成或保存报告。你可以主动打开示例，预览未来报告的页面结构。'}
        action={(
          <Button
            icon={previewVisible ? <ArrowLeftOutlined /> : <EyeOutlined />}
            onClick={() => setPreviewVisible((visible) => !visible)}
          >
            {previewVisible ? '返回未接入状态' : '查看示例报告'}
          </Button>
        )}
      />

      {previewVisible
        ? <PreviewReport />
        : <EmptyReport onPreview={() => setPreviewVisible(true)} />}

      <ReportHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
