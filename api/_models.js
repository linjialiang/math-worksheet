'use strict';

/**
 * 拍照批改共用配置（以 _ 开头的文件不会被 Vercel 暴露成路由）。
 *
 * 只允许能识图的模型：Qwen-VL / Qwen2-VL / Qwen2.5-VL / Qwen3-VL / QVQ / Omni。
 * 纯文本模型（qwen-plus、qwen-max、qwen-turbo 等）拿到图片只会报错或乱答，必须提前挡住。
 */

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const DEFAULT_MODELS = [
  'qwen3-vl-flash',
  'qwen3-vl-plus',
  'qwen3-vl-8b-instruct',
  'qwen-vl-plus',
  'qwen-vl-max'
];

const VISION_MODEL_RE = /^(?:qwen[\d.]*-vl|qvq|qwen[\d.]*-omni)(?:-|$)/i;

// Qwen3-VL 的 Plus / Flash 默认开启思考模式，批改只需要照读数字，关掉可显著缩短耗时。
const THINKING_TOGGLE_RE = /^qwen3(?:\.\d+)?-(?:vl-)?(?:plus|flash)(?:-|$)/i;

function isVisionModel(name) {
  return VISION_MODEL_RE.test(String(name == null ? '' : name).trim());
}

function supportsThinkingToggle(name) {
  return THINKING_TOGGLE_RE.test(String(name == null ? '' : name).trim());
}

function readModels(env) {
  const source = env || process.env;
  const configured = (source.QWEN_MODELS || source.QWEN_MODEL || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const list = configured.length ? configured : DEFAULT_MODELS;
  const models = [];
  const ignored = [];
  list.forEach(raw => {
    const name = String(raw == null ? '' : raw).trim();
    if (!name) return;
    if (!isVisionModel(name)) {
      if (!ignored.includes(name)) ignored.push(name);
      return;
    }
    if (!models.includes(name)) models.push(name);
  });
  return { models, ignored, configured: configured.length > 0 };
}

module.exports = {
  DEFAULT_BASE,
  DEFAULT_MODELS,
  isVisionModel,
  supportsThinkingToggle,
  readModels
};