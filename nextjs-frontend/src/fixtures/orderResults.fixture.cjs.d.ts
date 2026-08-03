import type {
  OrderConsultation,
  OrderResult
} from '@/lib/orderResults/orderResultsTypes';

export const ORDER_RESULTS_DEMO_RANGE: Readonly<{
  from: string;
  to: string;
  coverageFrom: string;
  coverageTo: string;
}>;

export const ORDER_RESULTS_DEMO_ORDERS: readonly OrderResult[];
export const ORDER_RESULTS_DEMO_CONSULTATION_OPTIONS: readonly OrderConsultation[];
