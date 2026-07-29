module.exports = Object.freeze({
  selectorVersion: 'doubao-web-v2',
  allowedOrigins: ['https://www.doubao.com'],
  loginMarkers: [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[placeholder="请输入手机号"]',
    'button[data-testid*="login" i]',
    '[data-testid*="login" i]'
  ],
  verificationMarkers: [
    'iframe[src*="captcha" i]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
    '[data-testid*="captcha" i]'
  ],
  composer: [
    'textarea[placeholder="发消息..."]:not([disabled])',
    '[contenteditable="true"][role="textbox"]'
  ],
  newConversationControl: Object.freeze({
    navigationText: '新对话',
    blankUrlPath: '/chat/'
  }),
  search: Object.freeze({
    actionButton: 'button[data-skill-id="skill_bar_button_25"]',
    selectedChip: [
      '[data-input-engine-action-source="actionbar"][data-value="25"]',
      '[data-value="25"][contenteditable="false"]'
    ],
    selectedText: '深入研究',
    resultBlock: '[data-plugin-identifier*="search_query_result_block.search_type:1"]'
  }),
  message: Object.freeze({
    owner: '[data-message-id]',
    streaming: '.md-box-root[data-streaming]',
    renderedBlock: [
      '.md-box-root',
      '[data-container-type="block-v1"][data-render-engine="block"]',
      '[data-render-engine="node"]'
    ]
  }),
  generationControls: [
    'button[aria-label*="停止"]',
    'button[title*="停止"]',
    '[role="button"][aria-label*="stop" i]'
  ]
});
