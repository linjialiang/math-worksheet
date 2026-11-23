'use strict';

/**
 * 模型目录（GET /api/catalog）
 *
 * 只做展示与选择，不包含密钥。数据按百炼模型信息页整理（2026-11），
 * 免费额度会调整，最终以控制台「免费额度」页面为准。
 *
 * input / output 取值：text、image、video、audio、embedding
 * gradable：输入含 image、输出含 text，且能按结构化 JSON 回答，才可用于批改。
 */

const MODELS = [
  { id: 'qwen3.8-flash', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '速度快、单价低' },
  { id: 'qwen3.8-max', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '旗舰，单价较高' },
  { id: 'qwen3.8-max-0902', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '快照，老用户可能有额度' },
  { id: 'qwen4-max', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '新一代旗舰' },
  { id: 'qwen3.7-plus', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { id: 'qwen3.7-flash', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { id: 'qwen3-vl-plus', family: 'Qwen', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true, note: '专用视觉模型' },
  { id: 'qwen3.5-ocr', family: 'Qwen', input: ['image'], output: ['text'], quota: true, gradable: false, kind: 'ocr', note: 'OCR，不适合整卷结构化批改' },
  { id: 'qwen-vl-ocr', family: 'Qwen', input: ['image'], output: ['text'], quota: true, gradable: false, kind: 'ocr', note: 'OCR，不适合整卷结构化批改' },
  { id: 'qwen-image-3.0', family: 'Qwen', input: ['text', 'image'], output: ['image'], quota: true, gradable: false, kind: 'gen', note: '生图模型，输出不是文本' },
  { id: 'qwen-image-3.0-pro', family: 'Qwen', input: ['text', 'image'], output: ['image'], quota: true, gradable: false, kind: 'gen', note: '生图模型，输出不是文本' },
  { id: 'kimi-k3.1-pro', family: 'Kimi', input: ['text', 'image'], output: ['text'], quota: true, gradable: true, note: '需在百炼开通 Kimi' },
  { id: 'kimi-k3', family: 'Kimi', input: ['text', 'image'], output: ['text'], quota: true, gradable: true },
  { id: 'kimi-k2.5', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { id: 'kimi-k2.6', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { id: 'kimi-k2.7-code', family: 'Kimi', input: ['text', 'image', 'video'], output: ['text'], quota: true, gradable: true },
  { id: 'deepseek-v4.1-flash', family: 'DeepSeek', input: ['text', 'image'], output: ['text'], quota: true, gradable: true, note: '原生多模态，单价低' },
  { id: 'deepseek-v4.1-flash-1017', family: 'DeepSeek', input: ['text', 'image'], output: ['text'], quota: true, gradable: true }
];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: '模型目录只支持 GET 请求。' });
  }
  return send(res, 200, {
    updated: '2026-11-23',
    count: MODELS.length,
    gradableCount: MODELS.filter(m => m.gradable).length,
    models: MODELS
  });
};