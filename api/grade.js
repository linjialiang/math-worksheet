'use strict';

/**
 * 拍照批改接口（Vercel Function）
 *
 * 前端只上传：
 *   - image: 压缩后的 JPEG data URL
 *   - questions: 当前页的题目与正确空位（只用于本地比对，不发给模型）
 *   - meta: 页码/种子/标题
 *
 * 模型只负责“读出孩子写了什么”，对错由本接口和标准答案比对。
 * 需要环境变量 DASHSCOPE_API_KEY；可选 DASHSCOPE_BASE_URL、QWEN_MODEL。
 */

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen3-vl-plus';
const MAX_IMAGE_CHARS = 4_000_000;   // data URL 长度，约 3MB 图片
const MAX_QUESTIONS = 120;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

function asArray(v) {
  if (Array.isArray(v)) return v.map(x => String(x == null ? '' : x).trim());
  if (v == null || v === '') return [];
  return String(v).split(/[,，、;；\n\s]+/).map(x => x.trim()).filter(Boolean);
}

function norm(v) {
  let s = String(v == null ? '' : v).trim();
  s = s
    .replace(/[（(]/g, '')
    .replace(/[）)]/g, '')
    .replace(/[＋﹢]/g, '+')
    .replace(/[－﹣−–—]/g, '-')
    .replace(/[×✕✖xX·]/g, '*')
    .replace(/[÷／:：]/g, '/')
    .replace(/[＞]/g, '>')
    .replace(/[＜]/g, '<')
    .replace(/[＝]/g, '=')
    .replace(/\s+/g, '');
  if (/^\d+$/.test(s)) s = String(parseInt(s, 10));
  return s;
}

function same(a, b) {
  return norm(a) === norm(b);
}

function confidenceOf(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.8;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function parseJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(s); } catch (e) {}
  const l = s.indexOf('{');
  const r = s.lastIndexOf('}');
  if (l >= 0 && r > l) {
    try { return JSON.parse(s.slice(l, r + 1)); } catch (e) {}
  }
  const la = s.indexOf('[');
  const ra = s.lastIndexOf(']');
  if (la >= 0 && ra > la) {
    try { return JSON.parse(s.slice(la, ra + 1)); } catch (e) {}
  }
  return null;
}

function modelPrompt(questions) {
  // 只给模型题号、题干和空位类型；绝不把正确答案放进提示，避免它“照着答案写”。
  const tasks = questions.map(q => ({
    no: q.no,
    section: q.section || '',
    expr: q.expr || '',
    blanks: (q.blanks || []).map(b => b.kind)
  }));
  return [
    '你是小学数学练习卷批改助手。图片是一张学生做完的 A4 练习卷照片。',
    '下面按题目顺序列出题目清单。no 只是给你对齐用，卷面不一定印题号。',
    '只读取学生在括号 ( )、圆圈 ○ 中手写的内容；不要抄写印刷数字，不要自行计算，不要判断对错。',
    '题目下方可能有折线/括号标注（用来提示先算哪一步），那不是答题空位；忽略它以及其中的中间结果，只读取算式同一行的括号/圆圈。',
    '每道题都必须返回一项；看不清就返回空数组，并把 confidence 设低。',
    'student 按该题空位从左到右排列；运算符写 + - × ÷，比较符写 > < =。',
    '只返回严格 JSON，不要 markdown，不要解释：',
    '{"answers":[{"no":1,"student":["19"],"confidence":0.9}]}',
    '题目清单：' + JSON.stringify(tasks)
  ].join('\n');
}

function callModel(base, key, model, prompt, image, signal) {
  return fetch(base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: prompt }
        ]
      }]
    }),
    signal
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: '只支持 POST 请求。' });
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return send(res, 503, {
      error: '服务端未配置 DASHSCOPE_API_KEY，请先在 Vercel 环境变量里配置百炼 API Key。'
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { error: '请求体不是合法 JSON。' });
  }

  const image = body && body.image;
  const questions = body && body.questions;
  if (typeof image !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
    return send(res, 400, { error: '缺少有效的图片数据。' });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return send(res, 413, { error: '照片过大，请重新拍摄或降低分辨率。' });
  }
  if (!Array.isArray(questions) || !questions.length || questions.length > MAX_QUESTIONS) {
    return send(res, 400, { error: '题目清单为空或数量异常。' });
  }

  const base = process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE;
  const model = process.env.QWEN_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  let resp;
  try {
    resp = await callModel(base, apiKey, model, modelPrompt(questions), image, controller.signal);
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && e.name === 'AbortError';
    return send(res, aborted ? 504 : 502, {
      error: aborted ? '模型请求超时，请重试。' : '模型请求失败，请检查网络和 Key。',
      detail: aborted ? undefined : String(e && e.message || e).slice(0, 300)
    });
  }
  clearTimeout(timer);

  const raw = await resp.text();
  if (!resp.ok) {
    let detail = raw.slice(0, 500);
    try {
      const j = JSON.parse(raw);
      detail = (j.error && (j.error.message || j.error.code)) || j.message || detail;
    } catch (e) {}
    return send(res, 502, {
      error: '模型调用失败（HTTP ' + resp.status + '）。',
      detail: String(detail)
    });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    return send(res, 502, { error: '模型返回的不是合法 JSON。' });
  }

  const content = payload && payload.choices && payload.choices[0] &&
    payload.choices[0].message && payload.choices[0].message.content;
  const parsed = parseJson(content);
  const answers = parsed
    ? (Array.isArray(parsed) ? parsed : (parsed.answers || parsed.data || []))
    : [];

  if (!Array.isArray(answers) || !answers.length) {
    return send(res, 502, {
      error: '模型没有返回可用的识别结果。',
      detail: String(content || '').slice(0, 300)
    });
  }

  const byNo = new Map();
  const byExpr = new Map();
  answers.forEach(a => {
    if (!a || typeof a !== 'object') return;
    if (a.no != null) byNo.set(String(a.no), a);
    if (a.expr) {
      const k = norm(a.expr);
      if (k && !byExpr.has(k)) byExpr.set(k, a);
    }
  });

  const rows = questions.map(q => {
    let a = byNo.get(String(q.no));
    if (!a && q.expr) a = byExpr.get(norm(q.expr));
    const student = a ? asArray(a.student) : [];
    const confidence = a ? confidenceOf(a.confidence) : 0;
    const blanks = Array.isArray(q.blanks) ? q.blanks : [];
    const correct = blanks.map(b => String(b.correct == null ? '' : b.correct));

    let status;
    if (q.open) {
      status = 'open';
    } else if (!a || !student.length || !blanks.length || confidence < 0.45) {
      status = 'uncertain';
    } else if (student.length !== blanks.length) {
      status = 'uncertain';
    } else if (blanks.every((b, i) => same(b.correct, student[i]))) {
      status = 'correct';
    } else {
      status = 'wrong';
    }

    return {
      no: q.no,
      section: q.section || '',
      expr: q.expr || '',
      student,
      correct,
      status,
      confidence: Math.round(confidence * 100) / 100
    };
  });

  const correct = rows.filter(r => r.status === 'correct').length;
  const wrong = rows.filter(r => r.status === 'wrong').length;
  const uncertain = rows.filter(r => r.status === 'uncertain').length;
  const open = rows.filter(r => r.status === 'open').length;
  const judged = correct + wrong;

  return send(res, 200, {
    ok: true,
    summary: {
      total: rows.length,
      gradable: rows.length - open,
      correct,
      wrong,
      uncertain,
      open,
      accuracy: judged ? Math.round((correct / judged) * 100) : 0
    },
    rows
  });
};