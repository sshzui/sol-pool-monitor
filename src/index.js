require('dotenv').config();
const config = require('./config');
const monitor = require('./monitor');

console.log('=== Solana Raydium 新池监听 v2.0 ===');
console.log('启动时间: ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
console.log('Telegram: ' + (config.TELEGRAM_BOT_TOKEN ? '已配置' : '未配置'));
console.log('Helius: ' + (config.HELIUS_API_KEY ? '已配置' : '未配置'));

// 启动监控
monitor.start();

// 优雅退出
process.on('SIGINT', function() {
  console.log('\n收到退出信号，正在停止...');
  process.exit(0);
});

process.on('SIGTERM', function() {
  console.log('\n收到终止信号，正在停止...');
  process.exit(0);
});

process.on('uncaughtException', function(err) {
  console.error('[未捕获异常]', err.message);
});

process.on('unhandledRejection', function(err) {
  console.error('[未处理拒绝]', err.message);
});
