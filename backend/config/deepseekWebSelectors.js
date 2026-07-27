module.exports = Object.freeze({
  selectorVersion: 'deepseek-web-v1',
  allowedOrigins: ['https://chat.deepseek.com'],
  loginMarkers: [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'form[action*="login" i]',
    '[data-testid*="login" i]'
  ],
  verificationMarkers: [
    'iframe[src*="captcha" i]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
    '[data-testid*="captcha" i]'
  ],
  composer: [
    'textarea:not([disabled])',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]'
  ],
  newConversationControl: [
    { text: '开启新对话', roles: ['button', 'clickable'] }
  ],
  searchToggle: [
    { text: '智能搜索', selectedAttributes: ['aria-pressed', 'class'] }
  ],
  assistantTurns: [
    '.ds-markdown.ds-assistant-message-main-content'
  ],
  generationControls: [
    'button[aria-label*="停止"]',
    'button[title*="停止"]',
    '[role="button"][aria-label*="stop" i]'
  ],
  citationAnchors: [
    '.ds-assistant-message-main-content a[href]'
  ],
  citationCards: [
    '.ds-message [class*="citation" i] a[href]'
  ]
});
