'use strict';

/**
 * 模型目录（GET /api/catalog）
 *
 * 返回多平台模型、输入/输出类型、是否可批改，以及各平台是否已配置 Key。
 * 只做展示与选择，不包含密钥。
 */

const { MODELS } = require('./_catalog');
const { configuredProviders, refOf } = require('./_providers');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: '模型目录只支持 GET 请求。' });
  }

  const providers = configuredProviders();
  const byId = new Map(providers.map(p => [p.id, p]));
  const models = MODELS.map(m => {
    const p = byId.get(m.provider);
    return Object.assign({}, m, {
      ref: refOf(m),
      providerLabel: p ? p.label : m.provider,
      available: !!(p && p.configured)
    });
  });

  return send(res, 200, {
    updated: '2026-11-23',
    providers,
    count: models.length,
    gradableCount: models.filter(m => m.gradable).length,
    models
  });
};