'use strict';

/**
 * 拍照批改共用配置（以 _ 开头的文件不会被 Vercel 暴露成路由）。
 *
 * 只允许能识图的模型：Qwen-VL / Qwen2-VL / Qwen2.5-VL / Qwen3-VL / QVQ / Omni。
 * 纯文本模型（qwen-plus、qwen-max、qwen-turbo 等）拿到图片只会报错或乱答，必须提前挡住。
 */

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const DEFAULT_MODELS = [
  'qwen3.8-flash',        // 原生视觉语言，速度快、单价低，北京 100 万免费额度
  'deepseek-v4.1-flash',  // 原生多模态，Text+Image，单价低，有免费额度
  'qwen4-max'             // 原生视觉旗舰，额度有效期更长，作为兜底
];

// 能识图的模型：
// - Qwen-VL / Qwen2-VL / Qwen2.5-VL / Qwen3-VL 专用视觉系列
// - Qwen3.5 / 3.6 / 3.7 / 3.8 原生视觉语言系列（文本/图像/视频输入，文本输出）
// - Qwen4 及以后旗舰、QVQ、Omni、OCR
// - Kimi 多模态（kimi-k3.1-pro、kimi-k3、kimi-k2.5/2.6/2.7-code）
// - DeepSeek V4.1（原生多模态，Text+Image）
// 纯文本模型（qwen-plus、qwen-max、qwen-turbo、qwen3-max 等）不能看图。
const VISION_MODEL_RE = /^(?:qwen[\d.]*-vl|qvq|qwen[\d.]*-omni|qwen(?:3\.[5-9]|[4-9])|qwen[\d.]*-ocr|kimi-k(?:2\.[5-9]|3(?:\.\d+)?)|deepseek-v4\.1)(?:-|$)/i;

// Qwen3-VL、Qwen3.5+ 与 Qwen4+ 默认开启思考模式，批改只需要照读数字，关掉可显著缩短耗时。
const THINKING_TOGGLE_RE = /^(?:qwen3(?:\.\d+)?|qwen[4-9])-(?:vl-)?(?:plus|flash|max)(?:-|$)/i;

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