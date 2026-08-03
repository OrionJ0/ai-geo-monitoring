const ORDER_RESULTS_DEMO_RANGE = Object.freeze({
  from: '2026-07-05',
  to: '2026-08-03',
  coverageFrom: '2026-06-05',
  coverageTo: '2026-08-03'
});

const SOURCE_LABELS = Object.freeze({
  BAIDU_PAID: '百度推广',
  ORGANIC_SEARCH: '搜索引擎',
  DIRECT: '直接访问',
  UNKNOWN: '来源未知'
});

function consultation({
  id,
  type,
  occurredAt,
  sourceKey,
  summary,
  maskedContact,
  landingPage
}) {
  return Object.freeze({
    id,
    type,
    occurredAt,
    sourceKey,
    sourceLabel: SOURCE_LABELS[sourceKey],
    summary,
    maskedContact,
    landingPage
  });
}

function order({
  id,
  number,
  date,
  project,
  customer,
  amount,
  sourceKey = null,
  attributionStatus = 'PENDING',
  primaryConsultation = null
}) {
  return Object.freeze({
    id,
    orderNumber: number,
    signedDate: date,
    projectName: project,
    customerName: customer,
    signedAmountYuan: amount,
    sourceKey,
    attributionStatus,
    primaryConsultation,
    salesSystemRecordUrl: null
  });
}

const consultations = Object.freeze({
  paidRing: consultation({
    id: 'demo-consultation-paid-ring',
    type: 'ONLINE_CHAT',
    occurredAt: '2026-07-12T02:18:00.000Z',
    sourceKey: 'BAIDU_PAID',
    summary: '咨询园区周界报警方案，希望确认覆盖范围与实施周期。',
    maskedContact: '张** / 138****5621',
    landingPage: '/solutions/perimeter-alarm'
  }),
  searchVibration: consultation({
    id: 'demo-consultation-search-vibration',
    type: 'WEBSITE_FORM',
    occurredAt: '2026-07-08T06:42:00.000Z',
    sourceKey: 'ORGANIC_SEARCH',
    summary: '希望获取振动光纤系统配置建议与项目报价。',
    maskedContact: '李** / 186****2038',
    landingPage: '/products/vibration-fiber'
  }),
  directGateway: consultation({
    id: 'demo-consultation-direct-gateway',
    type: 'ONLINE_CHAT',
    occurredAt: '2026-07-09T03:26:00.000Z',
    sourceKey: 'DIRECT',
    summary: '咨询园区网关兼容性、接入协议与交付周期。',
    maskedContact: '王** / w***@example.com',
    landingPage: '/products/edge-gateway'
  }),
  unknownUpgrade: consultation({
    id: 'demo-consultation-unknown-upgrade',
    type: 'WEBSITE_FORM',
    occurredAt: '2026-07-06T08:16:00.000Z',
    sourceKey: 'UNKNOWN',
    summary: '了解系统升级方案与实施范围，来源记录无法证实。',
    maskedContact: '周** / 139****8016',
    landingPage: '/contact'
  })
});

const ORDER_RESULTS_DEMO_ORDERS = Object.freeze([
  order({
    id: 'order-0086', number: 'GT-2026-0086', date: '2026-08-02',
    project: '园区周界报警系统', customer: '上海某工业园', amount: '320000',
    sourceKey: 'BAIDU_PAID', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.paidRing
  }),
  order({
    id: 'order-0085', number: 'GT-2026-0085', date: '2026-07-30',
    project: '振动光纤项目', customer: '华东某能源公司', amount: '186000',
    sourceKey: 'ORGANIC_SEARCH', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.searchVibration
  }),
  order({
    id: 'order-0084', number: 'GT-2026-0084', date: '2026-07-27',
    project: '电子围栏改造', customer: '某变电站', amount: '148000'
  }),
  order({
    id: 'order-0083', number: 'GT-2026-0083', date: '2026-07-22',
    project: '周界入侵监测系统', customer: '苏州某科技园', amount: '132000',
    sourceKey: 'BAIDU_PAID', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.paidRing
  }),
  order({
    id: 'order-0082', number: 'GT-2026-0082', date: '2026-07-18',
    project: '振动光纤系统升级', customer: '南京某数据中心', amount: '96000',
    sourceKey: 'UNKNOWN', attributionStatus: 'SOURCE_UNKNOWN',
    primaryConsultation: consultations.unknownUpgrade
  }),
  order({
    id: 'order-0081', number: 'GT-2026-0081', date: '2026-07-12',
    project: '电子围栏项目', customer: '合肥某化工厂', amount: '78000',
    sourceKey: 'ORGANIC_SEARCH', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.searchVibration
  }),
  order({
    id: 'order-0080', number: 'GT-2026-0080', date: '2026-07-08',
    project: '周界报警系统', customer: '杭州某物流园', amount: '65000',
    sourceKey: 'BAIDU_PAID', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.paidRing
  }),
  order({
    id: 'order-0079', number: 'GT-2026-0079', date: '2026-07-25',
    project: '仓储安防监测', customer: '无锡某仓储中心', amount: '70000',
    sourceKey: 'BAIDU_PAID', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.paidRing
  }),
  order({
    id: 'order-0078', number: 'GT-2026-0078', date: '2026-07-20',
    project: '厂区周界监控', customer: '常州某制造基地', amount: '59000',
    sourceKey: 'BAIDU_PAID', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.paidRing
  }),
  order({
    id: 'order-0077', number: 'GT-2026-0077', date: '2026-07-15',
    project: '光纤预警改造', customer: '嘉兴某产业园', amount: '52000',
    sourceKey: 'ORGANIC_SEARCH', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.searchVibration
  }),
  order({
    id: 'order-0076', number: 'GT-2026-0076', date: '2026-07-10',
    project: '边缘网关联调', customer: '上海某系统集成商', amount: '45000',
    sourceKey: 'DIRECT', attributionStatus: 'TRUSTED',
    primaryConsultation: consultations.directGateway
  }),
  order({
    id: 'order-0075', number: 'GT-2026-0075', date: '2026-07-05',
    project: '园区报警扩容', customer: '昆山某产业基地', amount: '35000'
  }),
  ...[
    ['0074', '2026-07-03', '厂区门禁改造', '苏州某制造企业', '118000'],
    ['0073', '2026-06-29', '光纤报警扩容', '杭州某运营中心', '92000'],
    ['0072', '2026-06-25', '周界监测项目', '南京某研究院', '165000'],
    ['0071', '2026-06-21', '仓储报警系统', '宁波某物流基地', '76000'],
    ['0070', '2026-06-18', '电子围栏升级', '常州某工业园', '84000'],
    ['0069', '2026-06-15', '园区网关部署', '上海某技术公司', '138000'],
    ['0068', '2026-06-12', '周界系统维保', '无锡某数据中心', '68000'],
    ['0067', '2026-06-09', '报警平台升级', '合肥某能源企业', '109000'],
    ['0066', '2026-06-07', '厂区安防扩容', '嘉兴某产业园', '97000'],
    ['0065', '2026-06-05', '光纤监测项目', '南通某制造企业', '137317']
  ].map(([suffix, date, project, customer, amount], index) => order({
    id: `order-${suffix}`,
    number: `GT-2026-${suffix}`,
    date,
    project,
    customer,
    amount,
    sourceKey: index % 3 === 0
      ? 'ORGANIC_SEARCH'
      : index % 3 === 1 ? 'DIRECT' : 'BAIDU_PAID',
    attributionStatus: 'TRUSTED',
    primaryConsultation: index % 3 === 0
      ? consultations.searchVibration
      : index % 3 === 1 ? consultations.directGateway : consultations.paidRing
  }))
]);

const ORDER_RESULTS_DEMO_CONSULTATION_OPTIONS = Object.freeze([
  consultations.paidRing,
  consultations.searchVibration,
  consultations.directGateway
]);

module.exports = {
  ORDER_RESULTS_DEMO_CONSULTATION_OPTIONS,
  ORDER_RESULTS_DEMO_ORDERS,
  ORDER_RESULTS_DEMO_RANGE
};
