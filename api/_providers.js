'use strict';

/**
 * 模型平台注册表（provider 模块）
 *
 * 新增平台 = 在这里加一条配置，不需要改 grade / health / 前端。
 * 模型引用统一写成 `provider/model`，例如：
 *   dashscope/qwen3.8-flash
 *   deepseek/deepseek-flash
 *   moonshot/kimi-k3.1-pro
 *   openrouter/anthropic/claude-sonnet-4
 *
 * 所有平台走 OpenAI 兼容的 /chat/completions，图片用 image_url 传 data URL。
 */

const { MODELS: CATALOG } = require('./_catalog');

const PROVIDERS = {
  dashscope: {
    id: 'dashscope',
    label: '阿里云百炼',
    keyEnv: 'DASHSCOPE_API_KEY',
    baseEnv: 'DASHSCOPE_BASE_URL',
    defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelsEnv: 'QWEN_MODELS',
    defaultModels: ['qwen3.8-flash', 'deepseek-v4.1-flash', 'qwen4-max'],
    vision: /^(?:qwen[\d.]*-vl|qvq|qwen[\d.]*-omni|qwen(?:3\.[5-9]|[4-9])|qwen[\d.]*-ocr|kimi-k(?:2\.[5-9]|3(?:\.\d+)?)|deepseek-v4\.1)(?:-|$)/i
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    keyEnv: 'DEEPSEEK_API_KEY',
    baseEnv: 'DEEPSEEK_BASE_URL',
    defaultBase: 'https://api.deepseek.com/v1',
    modelsEnv: 'DEEPSEEK_MODELS',
    defaultModels: ['deepseek-flash'],
    vision: /^deepseek-(?:flash|v4)/i
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    keyEnv: 'MOONSHOT_API_KEY',
    baseEnv: 'MOONSHOT_BASE_URL',
    defaultBase: 'https://api.moonshot.cn/v1',
    modelsEnv: 'MOONSHOT_MODELS',
    defaultModels: ['kimi-k3.1-pro'],
    vision: /^kimi-/i
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    baseEnv: 'OPENAI_BASE_URL',
    defaultBase: 'https://api.openai.com/v1',
    modelsEnv: 'OPENAI_MODELS',
    defaultModels: [],
    vision: /^(?:gpt|o\d|chatgpt)/i
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    keyEnv: 'GEMINI_API_KEY',
    baseEnv: 'GEMINI_BASE_URL',
    defaultBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsEnv: 'GEMINI_MODELS',
    defaultModels: [],
    vision: /^gemini/i
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    baseEnv: 'OPENROUTER_BASE_URL',
    defaultBase: 'https://openrouter.ai/api/v1',
    modelsEnv: 'OPENROUTER_MODELS',
    defaultModels: [],
    vision: /./i
  },
  custom: {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    keyEnv: 'CUSTOM_API_KEY',
    baseEnv: 'CUSTOM_BASE_URL',
    defaultBase: '',
    modelsEnv: 'CUSTOM_MODELS',
    defaultModels: [],
    vision: /./i
  }
};

const THINKING_TOGGLE_RE = /^(?:qwen3(?:\.\d+)?|qwen[4-9])-(?:vl-)?(?:plus|flash|max)(?:-|$)/i;

function getProvider(id) {
  const p = PROVIDERS[String(id == null ? '' : id).toLowerCase()];
  if (!p) throw new Error('未知模型平台：' + id);
  return p;
}

function keyOf(provider, env) {
  const e = env || process.env;
  return String(e[provider.keyEnv] || '').trim();
}

function baseOf(provider, env) {
  const e = env || process.env;
  return String(e[provider.baseEnv] || provider.defaultBase || '').trim().replace(/\/$/, '');
}

function providerConfigured(provider, env) {
  return !!(keyOf(provider, env) && baseOf(provider, env));
}

function modelsOf(provider, env) {
  const e = env || process.env;
  let raw = e[provider.modelsEnv] || '';
  // 兼容旧配置：QWEN_MODEL 只填一个模型
  if (!raw && provider.id === 'dashscope') raw = e.QWEN_MODEL || '';
  const list = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : provider.defaultModels.slice();
}

function parseRef(ref) {
  const s = String(ref == null ? '' : ref).trim();
  if (!s) throw new Error('模型名不能为空');
  const m = s.match(/^([a-z0-9_-]+)\/(.+)$/i);
  const provider = m ? m[1].toLowerCase() : 'dashscope';
  const model = m ? m[2].trim() : s;
  if (!PROVIDERS[provider]) throw new Error('未知模型平台：' + provider);
  if (!/^[a-z0-9._\/-]{1,120}$/i.test(model)) throw new Error('模型名不合法');
  return { provider, model };
}

function refOf(ref) {
  return ref.provider + '/' + ref.model;
}

function dedupe(refs) {
  const seen = new Set();
  const out = [];
  refs.forEach(r => {
    if (!r) return;
    const k = refOf(r);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  });
  return out;
}

/**
 * 读取要尝试的模型列表。
 * 优先 GRADE_MODELS（跨平台，逗号分隔的 provider/model）；
 * 否则收集所有已配置 Key 的平台的模型。
 */
function listModels(env) {
  const e = env || process.env;
  const global = String(e.GRADE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (global.length) {
    const parsed = [];
    global.forEach(s => {
      try { parsed.push(parseRef(s)); } catch (err) {}
    });
    return dedupe(parsed);
  }
  const out = [];
  Object.values(PROVIDERS).forEach(p => {
    if (!providerConfigured(p, e)) return;
    modelsOf(p, e).forEach(model => out.push({ provider: p.id, model }));
  });
  return dedupe(out);
}

function configuredProviders(env) {
  const e = env || process.env;
  return Object.values(PROVIDERS).map(p => ({
    id: p.id,
    label: p.label,
    configured: providerConfigured(p, e)
  }));
}

function isVisionRef(ref) {
  const entry = CATALOG.find(m => m.provider === ref.provider && m.model === ref.model);
  if (entry) {
    return entry.gradable !== false &&
      entry.input.includes('image') &&
      entry.output.includes('text');
  }
  const p = getProvider(ref.provider);
  return p.vision.test(ref.model);
}

function supportsThinkingToggle(model) {
  return THINKING_TOGGLE_RE.test(String(model == null ? '' : model).trim());
}

async function chat(ref, opts) {
  const p = getProvider(ref.provider);
  const key = keyOf(p);
  if (!key) throw new Error('未配置 ' + p.keyEnv);
  const base = baseOf(p);
  if (!base) throw new Error('未配置 ' + p.baseEnv);

  const body = {
    model: ref.model,
    messages: opts.messages
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens) {
    if (p.id === 'openai' && /^(?:o\d|gpt-5)/i.test(ref.model)) body.max_completion_tokens = opts.maxTokens;
    else body.max_tokens = opts.maxTokens;
  }
  // 百炼的 Qwen3-VL / Qwen3.5+ / Qwen4 默认开启思考，批改只需要照读数字
  if (opts.thinkingOff && p.id === 'dashscope' && supportsThinkingToggle(ref.model)) {
    body.enable_thinking = false;
  }

  return fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify(body),
    signal: opts.signal
  });
}

module.exports = {
  PROVIDERS,
  getProvider,
  keyOf,
  baseOf,
  providerConfigured,
  modelsOf,
  parseRef,
  refOf,
  listModels,
  configuredProviders,
  isVisionRef,
  supportsThinkingToggle,
  chat
};