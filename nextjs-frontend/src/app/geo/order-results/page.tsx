'use client';

import { Alert, Card, Space, Typography } from 'antd';

const { Paragraph, Text, Title } = Typography;

export default function OrderResultsPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Title level={2} style={{ marginBottom: 4 }}>订单结果</Title>
        <Text type="secondary">查看销售系统中的订单签订金额。</Text>
      </div>
      <Alert
        type="info"
        showIcon
        title="来源暂不可接入"
        description="销售系统尚未提供稳定 API。接入前本页不会展示模拟订单或金额。"
      />
      <Card title="数据范围">
        <Paragraph>未来只同步订单签订金额，不同步有效线索、销售机会或沟通过程。</Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          订单维护仍在销售系统完成，本系统只读展示结果。
        </Paragraph>
      </Card>
    </Space>
  );
}
