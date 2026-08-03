import {
  ORDER_RESULTS_DEMO_CONSULTATION_OPTIONS,
  ORDER_RESULTS_DEMO_ORDERS,
  ORDER_RESULTS_DEMO_RANGE
} from '@/fixtures/orderResults.fixture.cjs';
import type {
  OrderConsultation,
  OrderResult
} from '@/lib/orderResults/orderResultsTypes';

export type OrderResultsDataSource = {
  state: 'UNAVAILABLE' | 'DEMO';
  sourceSystem: 'SALES_SYSTEM' | 'FRONTEND_FIXTURE';
  orders: readonly OrderResult[];
  consultationOptions: readonly OrderConsultation[];
  coverage: {
    from: string;
    to: string;
    defaultFrom: string;
    defaultTo: string;
  } | null;
  message: string;
};

export function resolveOrderResultsDataSource(
  demoRequested: boolean
): OrderResultsDataSource {
  const demoEnabled = demoRequested && process.env.NODE_ENV !== 'production';
  if (demoEnabled) {
    return {
      state: 'DEMO',
      sourceSystem: 'FRONTEND_FIXTURE',
      orders: ORDER_RESULTS_DEMO_ORDERS as unknown as readonly OrderResult[],
      consultationOptions: ORDER_RESULTS_DEMO_CONSULTATION_OPTIONS as unknown as readonly OrderConsultation[],
      coverage: {
        from: ORDER_RESULTS_DEMO_RANGE.coverageFrom,
        to: ORDER_RESULTS_DEMO_RANGE.coverageTo,
        defaultFrom: ORDER_RESULTS_DEMO_RANGE.from,
        defaultTo: ORDER_RESULTS_DEMO_RANGE.to
      },
      message: '当前为前端开发示例，不请求销售系统、不写入数据库，刷新页面后恢复。'
    };
  }
  return {
    state: 'UNAVAILABLE',
    sourceSystem: 'SALES_SYSTEM',
    orders: [],
    consultationOptions: [],
    coverage: null,
    message: demoRequested
      ? '生产构建不会启用前端示例数据。订单数据源尚未接入。'
      : '订单数据源尚未接入。销售系统提供稳定只读 API 后再展示真实订单。'
  };
}
