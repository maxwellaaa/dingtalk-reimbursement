import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  gatewayMode: process.env.GATEWAY_MODE === 'true',
  port: Number(
    process.env.PORT || (process.env.GATEWAY_MODE === 'true' ? 8792 : 3000),
  ),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  jwt: {
    secret: process.env.JWT_SECRET || 'hongshengyuan-workplace-dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'reimb',
    password: process.env.DB_PASSWORD || 'reimb123',
    database: process.env.DB_NAME || 'reimbursement',
  },
  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxSizeMb: Number(process.env.UPLOAD_MAX_MB || 10),
  },
  dingtalk: {
    appKey: process.env.DINGTALK_APP_KEY || '',
    appSecret: process.env.DINGTALK_APP_SECRET || '',
    agentId: process.env.DINGTALK_AGENT_ID || '',
    corpId: process.env.DINGTALK_CORP_ID || '',
  },
};

export function assertDingTalkConfig() {
  if (!config.dingtalk.appKey || !config.dingtalk.appSecret) {
    console.warn(
      '[warn] DINGTALK_APP_KEY / DINGTALK_APP_SECRET not set. Auth APIs will fail until configured.',
    );
  }
}
