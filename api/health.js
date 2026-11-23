'use strict';

/**
 * 多平台模型诊断（GET /api/health[?model=provider/model]）
 *
 * 对配置的模型各发一次最小请求（“只回复 OK”，不传照片），
 * 返回模型是否可用、耗时、HTTP 状态、额度/鉴权错误。
 * 不配置 Key 的平台会被跳过。
 */

const {
  chat,
  configuredProviders,
  getProvider,
  isVisionRef,
  keyOf,
  listModels,
  parseRef,
  refOf
} = require('./_providers');

const MAX_PROBE_MODELS = 6;
const PROBE_TIMEOUT = 12000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function queryParam(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  const m = String(req.url || '').match(new RegExp('[?&]' + name + '=([^&]*)'));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
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
  if (status === 401) return 'Key 无效，或 Key 与 Base URL 不匹配' + suffix;
  if (status === 403) return '额度用完、限流或没有模型权限' + suffix;
  if (status === 429) return '额度用完或触发限流' + suffix;
  if (status === 404) return '模型不存在，或当前地域未开通' + suffix;
  if (status === 400) return '请求被拒绝，模型名可能不对' + suffix;
  if (status >= 500) return '模型平台服务异常' + suffix;
  return (detail ? 'HTTP ' + status + '：' + detail : 'HTTP ' + status);
}

async function probe(ref) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  const started = Date.now();
  try {
    const resp = await chat(ref, {
      messages: [{ role: 'user', content: '只回复 OK' }],
      maxTokens: 8,
      temperature: 0,
      thinkingOff: true,
      signal: controller.signal
    });
    const raw = await resp.text();
    const latencyMs = Date.now() - started;
    const code = resp.ok ? '' : codeOf(raw);
    return {
      model: refOf(ref),
      provider: ref.provider,
      ok: resp.ok,
      status: resp.status,
      code: code || undefined,
      latencyMs,
      text: resp.ok ? '可用（' + latencyMs + ' ms）' : describe(resp.status, code, detailOf(raw))
    };
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return {
      model: refOf(ref),
      provider: ref.provider,
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      text: aborted ? describe(0, '', '') : '请求失败：' + String(e && e.message || e).slice(0, 120)
    };
  } finally {
    clearTimeout(timer);
  }
}

function conclusionOf(results) {
  const okCount = results.filter(r => r.ok).length;
  if (okCount) return 'Key 可用：' + okCount + '/' + results.length + ' 个模型连通。';
  const statuses = results.map(r => r.status);
  if (statuses.length && statuses.every(s => s === 401)) {
    return 'API Key 无效，或 Key 与 Base URL 不匹配（Key 与平台/地域必须对应）。';
  }
  if (statuses.length && statuses.every(s => s === 0)) {
    return '全部请求超时：Key 可能有效，但网络到模型平台太慢，请重试。';
  }
  if (statuses.length && statuses.every(s => s === 429 || s === 403)) {
    return 'Key 可用，但免费额度已用完、被限流或没有模型权限。';
  }
  if (statuses.some(s => s === 404 || s === 400)) {
    return '部分模型名不可用或当前地域未开通，请核对模型名。';
  }
  return '没有模型连通，请看下面每个模型的状态。';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: '诊断接口只支持 GET 请求。' });
  }

  const providers = configuredProviders();
  if (!providers.some(p => p.configured)) {
    return send(res, 503, {
      error: '服务端未配置任何模型平台的 API Key。',
      detail: '请配置 DASHSCOPE_API_KEY，或 DEEPSEEK_API_KEY / MOONSHOT_API_KEY / OPENAI_API_KEY 等。'
    });
  }

  const requestedRaw = queryParam(req, 'model').trim().slice(0, 120);
  let requested = null;
  if (requestedRaw) {
    try {
      requested = parseRef(requestedRaw);
    } catch (e) {
      return send(res, 400, {
        error: '模型引用不合法：' + requestedRaw + '。',
        detail: '格式应为 provider/model，例如 dashscope/qwen3.8-flash。'
      });
    }
    if (!isVisionRef(requested)) {
      return send(res, 400, {
        error: '所选模型不能用于批改：' + refOf(requested) + '。',
        detail: '请选择支持图片输入、输出文本的模型。'
      });
    }
    const p = getProvider(requested.provider);
    if (!keyOf(p)) {
      return send(res, 400, {
        error: '模型平台未配置 API Key：' + p.label + '。',
        detail: '请添加 ' + p.keyEnv + ' 后重新部署。'
      });
    }
  }

  const refs = requested ? [requested] : listModels();
  const targets = refs
    .filter(ref => keyOf(getProvider(ref.provider)))
    .slice(0, MAX_PROBE_MODELS);
  if (!targets.length) {
    return send(res, 400, {
      error: '没有已配置 Key 的模型可检测。',
      detail: '请检查 GRADE_MODELS，或各平台的模型变量（QWEN_MODELS / DEEPSEEK_MODELS 等）。'
    });
  }

  const results = await Promise.all(targets.map(probe));
  const okCount = results.filter(r => r.ok).length;

  return send(res, 200, {
    ok: okCount > 0,
    keyConfigured: true,
    providers,
    requestedModel: requested ? refOf(requested) : undefined,
    total: results.length,
    available: okCount,
    models: results,
    truncated: refs.length > targets.length ? '只检测了前 ' + MAX_PROBE_MODELS + ' 个模型。' : undefined,
    conclusion: conclusionOf(results)
  });
};