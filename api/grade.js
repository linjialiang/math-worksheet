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
 * 模型平台通过 api/_providers.js 注册，模型引用为 provider/model。
 * 至少配置一个平台的 API Key；可选 GRADE_MODELS 控制跨平台尝试顺序。
 * 只会使用能识图的模型；配置里的纯文本模型会被忽略，全部无效时直接报错。
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

function detailOf(raw) {
  let detail = String(raw || '').slice(0, 500);
  try {
    const j = JSON.parse(raw);
    detail = (j.error && (j.error.message || j.error.code)) || j.message || detail;
  } catch (e) {}
  return String(detail);
}

function isFallbackError(status, raw) {
  const s = String(raw || '').toLowerCase();
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status === 504) return true;
  if (/allocationquota|freetieronly|insufficient_quota|rate.?limit|quota|arrears|free.?tier|exceeded|insufficient/i.test(s)) return true;
  if (status === 400 && /model|invalidparameter|not.?found/i.test(s)) return true;
  return false;
}

function failureInfo(last) {
  if (!last) {
    return {
      error: '模型调用失败。',
      detail: '请先点「检查连接」确认 Key 与模型是否可用。'
    };
  }
  const at = last.model ? '（最后尝试：' + last.model + '）' : '';
  const status = Number(last.status) || 0;
  const detail = String(last.detail || '');
  const quota = /allocationquota|freetieronly|insufficient_quota|rate.?limit|quota|arrears|free.?tier|exceeded|insufficient/i.test(detail);
  if (status === 504 || /abort/i.test(detail)) {
    return {
      error: '模型响应超时' + at + '。',
      detail: '照片可能过大或网络较慢，请重试；也可以先点「检查连接」确认模型是否连通。'
    };
  }
  if (status === 401) {
    return {
      error: 'API Key 无效或与 Base URL 不匹配' + at + '。',
      detail: '请核对对应平台的环境变量：Key 与 Base URL 必须属于同一平台/地域。'
    };
  }
  if (status === 403 || status === 429 || quota) {
    return {
      error: '模型额度用完、限流或没有权限' + at + '。',
      detail: '请在百炼控制台确认免费额度与模型授权，并开启「用完即停」；额度恢复后重试。'
    };
  }
  if (status === 404 || /model.{0,24}(not|invalid|does not exist)/i.test(detail)) {
    return {
      error: '模型不可用或名称不正确' + at + '。',
      detail: '请在百炼模型广场确认该模型在当前地域已开通，或改用 qwen3-vl-plus / qwen3.8-flash。'
    };
  }
  return {
    error: '模型调用失败' + at + (status ? '（HTTP ' + status + '）' : '') + '。',
    detail: detail || '请先点「检查连接」确认 Key 与模型是否可用。'
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: '只支持 POST 请求。' });
  }

  const anyProvider = configuredProviders().some(p => p.configured);
  if (!anyProvider) {
    return send(res, 503, {
      error: '服务端未配置任何模型平台的 API Key。',
      detail: '请配置 DASHSCOPE_API_KEY，或 DEEPSEEK_API_KEY / MOONSHOT_API_KEY / OPENAI_API_KEY 等；也可以用 GRADE_MODELS 指定 provider/model。'
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

  const requestedRaw = body && typeof body.model === 'string' ? body.model.trim().slice(0, 120) : '';
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
        detail: '请选择支持图片输入、输出文本的模型；OCR 与生图模型不适用。'
      });
    }
    const p = getProvider(requested.provider);
    if (!keyOf(p)) {
      return send(res, 400, {
        error: '模型平台未配置 API Key：' + p.label + '。',
        detail: '请在 Vercel 环境变量添加 ' + p.keyEnv + ' 后重新部署。'
      });
    }
  }

  const usable = listModels();
  const models = requested
    ? [requested].concat(usable.filter(r => refOf(r) !== refOf(requested)))
    : usable;
  if (!models.length) {
    return send(res, 400, {
      error: '没有可用的视觉模型。',
      detail: '请检查 GRADE_MODELS，或各平台的模型变量（QWEN_MODELS / DEEPSEEK_MODELS / MOONSHOT_MODELS 等）。'
    });
  }
  const prompt = modelPrompt(questions);
  const deadline = Date.now() + 55000;
  const attempts = [];
  let answers = null;
  let usedModel = '';
  let lastErr = null;

  function record(err) {
    lastErr = err;
    attempts.push(err);
  }

  for (const ref of models) {
    const remain = deadline - Date.now();
    if (remain < 3000) break;
    const controller = new AbortController();
    // 单模型最多 25 秒；超时就换下一个，避免前面的慢请求把总预算耗尽。
    const timer = setTimeout(() => controller.abort(), Math.min(25000, Math.max(5000, remain)));
    const label = refOf(ref);
    let resp, raw;
    try {
      resp = await chat(ref, {
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            { type: 'text', text: prompt }
          ]
        }],
        maxTokens: 6000,
        temperature: 0,
        thinkingOff: true,
        signal: controller.signal
      });
      raw = await resp.text();
    } catch (e) {
      clearTimeout(timer);
      record({
        model: label,
        provider: ref.provider,
        status: e && e.name === 'AbortError' ? 504 : 502,
        detail: String(e && e.message || e).slice(0, 300)
      });
      continue;
    }
    clearTimeout(timer);

    if (!resp.ok) {
      const detail = detailOf(raw);
      record({ model: label, provider: ref.provider, status: resp.status, detail });
      if (isFallbackError(resp.status, raw)) continue;
      const info = failureInfo(lastErr);
      return send(res, resp.status === 401 ? 401 : 502, {
        error: info.error,
        detail: info.detail,
        attempts
      });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      record({ model: label, provider: ref.provider, status: 502, detail: '模型返回的不是合法 JSON。' });
      continue;
    }

    const content = payload && payload.choices && payload.choices[0] &&
      payload.choices[0].message && payload.choices[0].message.content;
    const parsed = parseJson(content);
    const found = parsed
      ? (Array.isArray(parsed) ? parsed : (parsed.answers || parsed.data || []))
      : [];

    if (!Array.isArray(found) || !found.length) {
      record({
        model: label,
        provider: ref.provider,
        status: 502,
        detail: String(content || '').slice(0, 300) || '模型没有返回识别结果。'
      });
      continue;
    }

    answers = found;
    usedModel = label;
    break;
  }

  if (!answers) {
    const info = failureInfo(lastErr);
    return send(res, 502, {
      error: info.error,
      detail: info.detail,
      attempts
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
    model: usedModel,
    requestedModel: requestedRaw || undefined,
    attempts: attempts.length ? attempts : undefined,
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