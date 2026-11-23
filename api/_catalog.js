'use strict';

/**
 * 模型目录（数据层，供 /api/catalog 与前端使用）
 *
 * provider 与 /api/_providers.js 中的注册表对应；model 是各平台实际的模型 ID。
 * input / output 取值：text、image、video、audio、embedding
 * gradable：输入含 image、输出含 text，且能按结构化 JSON 回答，才可用于批改。
 *
 * 数据按各平台模型信息页整理（2026-11），免费额度与模型生命周期会变，以控制台为准。
 */

const MODELS = [
  // 阿里云百炼
  { provider: 'dashscope', model: 'qwen3.8-flash', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '速度快、单价低' },
  { provider: 'dashscope', model: 'qwen3.8-max', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '旗舰，单价较高' },
  { provider: 'dashscope', model: 'qwen3.8-max-0902', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '快照，老用户可能有额度' },
  { provider: 'dashscope', model: 'qwen4-max', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '新一代旗舰' },
  { provider: 'dashscope', model: 'qwen3.7-plus', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { provider: 'dashscope', model: 'qwen3.7-flash', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { provider: 'dashscope', model: 'qwen3-vl-plus', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '专用视觉模型' },
  { provider: 'dashscope', model: 'qwen3.5-ocr', family: 'Qwen', input: ['image'], output: ['text'], quota: true, gradable: false, kind: 'ocr', note: 'OCR，不适合整卷结构化批改' },
  { provider: 'dashscope', model: 'qwen-vl-ocr', family: 'Qwen', input: ['image'], output: ['text'], quota: true, gradable: false, kind: 'ocr', note: 'OCR，不适合整卷结构化批改' },
  { provider: 'dashscope', model: 'qwen-image-3.0', family: 'Qwen', input: ['text', 'image'], output: ['image'], quota: true, gradable: false, kind: 'gen', note: '生图模型，输出不是文本' },
  { provider: 'dashscope', model: 'qwen-image-3.0-pro', family: 'Qwen', input: ['text', 'image'], output: ['image'], quota: true, gradable: false, kind: 'gen', note: '生图模型，输出不是文本' },
  { provider: 'dashscope', model: 'kimi-k3.1-pro', family: 'Kimi', input: ['text', 'image'], output: ['text'], quota: true, gradable: true, note: '百炼托管，需开通 Kimi' },
  { provider: 'dashscope', model: 'kimi-k3', family: 'Kimi', input: ['text', 'image'], output: ['text'], quota: true, gradable: true },
  { provider: 'dashscope', model: 'kimi-k2.5', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { provider: 'dashscope', model: 'kimi-k2.6', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { provider: 'dashscope', model: 'kimi-k2.7-code', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { provider: 'dashscope', model: 'deepseek-v4.1-flash', family: 'DeepSeek', input: ['text', 'image'], output: ['text'], quota: true, gradable: true, note: '百炼托管，原生多模态' },
  { provider: 'dashscope', model: 'deepseek-v4.1-flash-1017', family: 'DeepSeek', input: ['text', 'image'], output: ['text'], quota: true, gradable: true },

  // DeepSeek 官方（OpenAI 兼容）
  { provider: 'deepseek', model: 'deepseek-flash', family: 'DeepSeek', input: ['text', 'image'], output: ['text'], quota: false, gradable: true, note: 'DeepSeek 官方，按量计费' },

  // Moonshot 官方（OpenAI 兼容）
  { provider: 'moonshot', model: 'kimi-k3.1-pro', family: 'Kimi', input: ['text', 'image'], output: ['text'], quota: false, gradable: true, note: 'Moonshot 官方，按量计费' },
  { provider: 'moonshot', model: 'kimi-k3', family: 'Kimi', input: ['text', 'image'], output: ['text'], quota: false, gradable: true },
  { provider: 'moonshot', model: 'kimi-k2.5', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: false, gradable: true },
  { provider: 'moonshot', model: 'kimi-k2.6', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: false, gradable: true },
  { provider: 'moonshot', model: 'kimi-k2.7-code', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: false, gradable: true }
];

module.exports = { MODELS };