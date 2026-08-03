export type OrderSourceKey =
  | 'BAIDU_PAID'
  | 'ORGANIC_SEARCH'
  | 'DIRECT'
  | 'UNKNOWN';

export type OrderSourceCategory = OrderSourceKey | 'PENDING';

export type OrderAttributionStatus =
  | 'TRUSTED'
  | 'SOURCE_UNKNOWN'
  | 'PENDING';

export type OrderConsultation = {
  id: string;
  type: 'WEBSITE_FORM' | 'ONLINE_CHAT';
  occurredAt: string;
  sourceKey: OrderSourceKey;
  sourceLabel: string;
  summary: string;
  maskedContact: string;
  landingPage: string;
};

export type OrderResult = {
  id: string;
  orderNumber: string;
  signedDate: string;
  projectName: string;
  customerName: string;
  signedAmountYuan: string;
  sourceKey: OrderSourceKey | null;
  attributionStatus: OrderAttributionStatus;
  primaryConsultation: OrderConsultation | null;
  salesSystemRecordUrl: string | null;
};

export type OrderResultFilters = {
  from: string;
  to: string;
  source: 'ALL' | OrderSourceCategory;
  status: 'ALL' | OrderAttributionStatus;
  query: string;
  sortKey: keyof OrderResult | 'source';
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
  metric: 'count' | 'amount';
};
