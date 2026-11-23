'use strict';

/**
 * 百炼连通性诊断（GET /api/health）
 *
 * 用服务端配置的 DASHSCOPE_API_KEY，对 QWEN_MODELS 里的视觉模型各发一次最小请求，
 * 返回 Key 是否有效、模型是否存在/有权限、额度是否用完、以及耗时。
 * 只发纯文本 "ping"，不传照片；单个模型消耗个位数 token。
 *
 * 注意：百炼 OpenAI 兼容端点不提供 GET /models，不能用模型列表判断 Key，只能实际调用。
 */

const { DEFAULT_BASE, readModels, supportsThinkingToggle } = require('./_models');

const MAX_PROBE_MODELS = 6;
const PROBE_TIMEOUT = 12000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function codeOf(raw) {
  try {
    const j = JSON.parse(raw);
    const err = j && (j.error || {});
    return String(err.code || err.type || j.code || '').slice(0, 80);
  } catch (e) {}
  return '';
}

function detailOf(raw) {
  let detail = String(raw || '').slice(0, 500);
  try {
    const j = JSON.parse(raw);
    const err = j && (j.error || {});
    detail = err.message || err.code || j.message || detail;
  } catch (e) {}
  return String(detail || '').slice(0, 160);
}

function describe(status, code, detail) {
  const suffix = code ? '（' + code + '）' : '';
  if (status === 0) return '超时（12 秒内没有响应）';
  if (status === 401) return 'Key 无效，或 Key 与地域不匹配' + suffix;
  if (status === 403) return '额度用完、限流或没有模型权限' + suffix;
  if (status === 429) return '额度用完或触发限流' + suffix;
  if (status === 404) return '模型不存在，或当前地域未开通' + suffix;
  if (status === 400) return '请求被拒绝，模型名可能不对' + suffix;
  if (status >= 500) return '百炼服务异常' + suffix;
  return (detail ? 'HTTP ' + status + '：' + detail : 'HTTP ' + status);
}

async function probe(base, key, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  const started = Date.now();
  const body = {
    model,
    temperature: 0,
    max_tokens: 8,
    messages: [{ role: 'user', content: '只回复 OK' }]
  };
  // 与批改请求保持一致：Plus/Flash 关闭思考，排除思考模式拖慢的可能。
  if (supportsThinkingToggle(model)) body.enable_thinking = false;
  try {
    const resp = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await resp.text();
    const latencyMs = Date.now() - started;
    const code = resp.ok ? '' : codeOf(raw);
    return {
      model,
      ok: resp.ok,
      status: resp.status,
      code: code || undefined,
      latencyMs,
      text: resp.ok ? '可用（' + latencyMs + ' ms）' : describe(resp.status, code, detailOf(raw))
    };
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return {
      model,
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      text: aborted ? describe(0, '', '') : '请求失败：' + String(e && e.message || e).slice(0, 120)
    };
  } finally {
    clearTimeout(timer);
  }
}

function conclusionOf(results, ignored) {
  const okCount = results.filter(r => r.ok).length;
  const ignoredText = ignored.length ? '已忽略不能识图的模型：' + ignored.join('、') + '。' : '';
  if (okCount) {
    return 'Key 可用：' + okCount + '/' + results.length + ' 个模型连通。' + ignoredText;
  }
  const statuses = results.map(r => r.status);
  if (statuses.length && statuses.every(s => s === 401)) {
    return 'Key 无效，或 API Key 与 DASHSCOPE_BASE_URL 的地域不匹配（北京 Key 只能调北京域名）。';
  }
  if (statuses.length && statuses.every(s => s === 0)) {
    return '全部请求超时：Key 可能有效，但 Vercel 到百炼的网络太慢，请重试。';
  }
  if (statuses.every(s => s === 429 || s === 403)) {
    return 'Key 可用，但免费额度已用完、被限流或没有模型权限。' + ignoredText;
  }
  if (statuses.some(s => s === 404 || s === 400)) {
    return '部分模型名不可用或当前地域未开通，请核对模型名。' + ignoredText;
  }
  return '没有模型连通，请看下面每个模型的状态。' + ignoredText;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: '诊断接口只支持 GET 请求。' });
  }

  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) {
    return send(res, 503, {
      error: '服务端未配置 DASHSCOPE_API_KEY。',
      detail: '请在 Vercel 项目 Settings -> Environment Variables 里添加 Key，然后重新部署。'
    });
  }

  const { models, ignored } = readModels();
  if (!models.length) {
    return send(res, 400, {
      error: '配置的模型都不能识别图片：' + (ignored.join('、') || '（空）') + '。',
      detail: '请把 QWEN_MODELS 改为 qwen3-vl-plus、qwen3.8-flash 等视觉模型。',
      ignoredModels: ignored
    });
  }

  const base = process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE;
  const targets = models.slice(0, MAX_PROBE_MODELS);
  const results = await Promise.all(targets.map(m => probe(base, key, m)));
  const okCount = results.filter(r => r.ok).length;

  return send(res, 200, {
    ok: okCount > 0,
    keyConfigured: true,
    total: results.length,
    available: okCount,
    models: results,
    ignoredModels: ignored.length ? ignored : undefined,
    truncated: models.length > targets.length ? '只检测了前 ' + MAX_PROBE_MODELS + ' 个模型。' : undefined,
    conclusion: conclusionOf(results, ignored)
  });
};