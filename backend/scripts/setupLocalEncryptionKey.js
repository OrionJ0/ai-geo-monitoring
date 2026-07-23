const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const envPath = path.resolve(__dirname, '../.env');
const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const configured = original.match(/^CONFIG_ENCRYPTION_KEY=(.+)$/m);

if (configured?.[1]?.trim()) {
  console.log('本地配置加密主密钥已存在，未做修改');
  process.exit(0);
}

const generated = crypto.randomBytes(32).toString('base64');
const next = /^CONFIG_ENCRYPTION_KEY=.*$/m.test(original)
  ? original.replace(/^CONFIG_ENCRYPTION_KEY=.*$/m, `CONFIG_ENCRYPTION_KEY=${generated}`)
  : `${original}${original && !original.endsWith('\n') ? '\n' : ''}CONFIG_ENCRYPTION_KEY=${generated}\n`;

fs.writeFileSync(envPath, next, { encoding: 'utf8', mode: 0o600 });
fs.chmodSync(envPath, 0o600);
console.log('已生成本机专用配置加密主密钥（内容未回显）');
