'use client';

import { Alert, Card, Space, Typography } from 'antd';

const { Paragraph, Text, Title } = Typography;

export default function ConsultationsPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Title level={2} style={{ marginBottom: 4 }}>原始咨询</Title>
        <Text type="secondary">查看官网落地页提交的原始咨询与表单。</Text>
      </div>
      <Alert
        type="info"
        showIcon
        title="来源暂不可接入"
        description="落地页系统尚未提供稳定 API。接入前本页不会展示模拟咨询数据。"
      />
      <Card title="数据范围">
        <Paragraph>未来只读展示原始咨询记录，并保留来源和发生时间。</Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          咨询是否有效仍由市场部在现有业务流程中确认，本系统不修改来源数据。
        </Paragraph>
      </Card>
    </Space>
  );
}
