const panelStyle: React.CSSProperties = {
  maxWidth: 840,
  padding: 32,
  border: '1px solid #d9d9d9',
  borderRadius: 12,
  background: '#ffffff',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
};

const listStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  margin: '20px 0',
  paddingLeft: 24,
  lineHeight: 1.7,
};

export default function MarketingPage() {
  return (
    <main aria-labelledby="marketing-page-title">
      <section style={panelStyle}>
        <p style={{ margin: 0, color: '#1677ff', fontWeight: 600 }}>
          模块准备中
        </p>
        <h1
          id="marketing-page-title"
          style={{ margin: '8px 0 12px', fontSize: 30 }}
        >
          营销监控
        </h1>
        <p style={{ margin: 0, lineHeight: 1.8, color: '#475569' }}>
          这里将提供按项目查看的只读营销数据。本阶段先完成安全的模块、
          配置和迁移基础，外部数据契约验收通过前不会显示未经验证的数据。
        </p>

        <h2 style={{ margin: '28px 0 0', fontSize: 20 }}>当前边界</h2>
        <ul style={listStyle}>
          <li>营销监控只用于观察，不在本站修改外部投放。</li>
          <li>落地页系统和销售系统尚未接入。</li>
          <li>不会展示模拟的咨询、订单或完整业务漏斗。</li>
        </ul>

        <p
          role="status"
          style={{
            margin: 0,
            padding: '12px 16px',
            borderRadius: 8,
            background: '#f6f8fa',
            color: '#334155',
            lineHeight: 1.7,
          }}
        >
          完成外部只读契约确认与生产验收后，系统才会开放正式入口。
        </p>
      </section>
    </main>
  );
}
