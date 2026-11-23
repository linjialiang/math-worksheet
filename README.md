# 算术练习卷生成器（math-worksheet）

单文件、无构建的算术练习卷生成器，双击即用，也可部署为在线网页；拍照批改功能需要 Vercel 后端。

## 功能

-   三种填空题型：括号填数、运算符填空（圆圈）、比较关系（＞＜＝虚线圆圈）
-   章节与题量自定义（步进器 ±）、数值范围 5/10/20/50/99 以内、四则运算
-   随机种子：同种子 + 同设置 = 完全相同的卷
-   A4 打印 / 直接导出 PDF（300dpi）双通道
-   题中直接显示答案（红色），导出答案卷文件名带「答案」
-   拍照批改：手机拍照上传，AI 读取手写答案，与标准答案比对，输出分数和错题表格（需 Vercel + 百炼 API Key；弹窗内可一键检查 Key 与模型连接）
-   响应式：手机端单页预览、左右滑动翻页、双指捏合缩放、放大拖拽

## 拍照批改（可选）

流程：拍照/上传 → 压缩 → 调 `/api/grade` 读取手写答案 → 与当前页标准答案比对 → 分数 + 错题表格。**不在照片上画标记，服务端不保存照片。** 部署后可点「检查连接」（`GET /api/health`）确认 Key 和视觉模型是否连通。

批改弹窗可选择**识别模型**：目录由 `GET /api/catalog` 提供，覆盖百炼、DeepSeek、Moonshot、OpenAI、Gemini、OpenRouter 等平台的视觉模型，带输入类型标签（图片、视频、OCR）；支持搜索、分页懒加载，也能手动输入 `provider/model`。选中模型会优先尝试，失败后按 `GRADE_MODELS` 轮换。

### 部署

1. 在至少一个模型平台创建 API Key（阿里云百炼、DeepSeek、Moonshot / Kimi、OpenAI、Google Gemini、OpenRouter，或任意 OpenAI 兼容平台）。
2. 将本仓库导入 Vercel，项目根目录无需构建命令；添加环境变量：
   - 至少配置一个平台的 Key：`DASHSCOPE_API_KEY`、`DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`、`OPENAI_API_KEY`、`GEMINI_API_KEY`、`OPENROUTER_API_KEY`
   - 自定义平台：`CUSTOM_API_KEY` + `CUSTOM_BASE_URL` + `CUSTOM_MODELS`
   - 各平台可选 `*_BASE_URL`；模型列表用 `QWEN_MODELS`、`DEEPSEEK_MODELS`、`MOONSHOT_MODELS` 等
   - `GRADE_MODELS`：可选，跨平台尝试顺序，格式 `provider/model`，优先级最高，例如 `dashscope/qwen3.8-flash,deepseek/deepseek-flash,moonshot/kimi-k3.1-pro`
3. 部署后打开 Vercel 地址，点「拍照批改」。

### 模型平台（provider）

| provider | Key 环境变量 | 默认 Base URL | 默认模型 |
| --- | --- | --- | --- |
| `dashscope` | `DASHSCOPE_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3.8-flash`、`deepseek-v4.1-flash`、`qwen4-max` |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | `deepseek-flash` |
| `moonshot` | `MOONSHOT_API_KEY` | `https://api.moonshot.cn/v1` | `kimi-k3.1-pro` |
| `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` | 由 `OPENAI_MODELS` 指定 |
| `gemini` | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/openai` | 由 `GEMINI_MODELS` 指定 |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` | 由 `OPENROUTER_MODELS` 指定 |
| `custom` | `CUSTOM_API_KEY` | 由 `CUSTOM_BASE_URL` 指定 | 由 `CUSTOM_MODELS` 指定 |

> 模型引用统一为 `provider/model`；不写 provider 时默认 `dashscope`，兼容旧的 `QWEN_MODELS` / `QWEN_MODEL`。
>
> 新增平台有两种方式：直接用 `custom` 接入任意 OpenAI 兼容服务，无需改代码；或在 `api/_providers.js` 注册一条，供目录与诊断复用。

> 后端只接受能识图的模型：Qwen3-VL、Qwen3.5+、Qwen4+、Kimi 多模态、DeepSeek V4.1、GPT、Gemini 等。纯文本模型、OCR 与生图模型不能用于批改；批量轮换时遇到 401/403/404/429/超时会自动换下一个平台或模型。

### 检查连接与排错

批改弹窗底部有「检查连接」：它会对 `GRADE_MODELS`（或各平台配置的模型）里的视觉模型各发一次最小请求（“只回复 OK”，不传照片），返回 Key 是否有效、模型是否可用、额度状态和耗时。选定具体模型时只检测该模型。

常见错误对照：

| 提示 | 含义 | 处理 |
| --- | --- | --- |
| `This operation was aborted` / 模型响应超时 | 请求在 25 秒内没有返回，不是额度问题 | 重试；照片过大时换更小的照片；先点「检查连接」 |
| HTTP 401 / Key 无效或与 Base URL 不匹配 | Key 与平台/地域不对应 | 核对对应平台的 `*_API_KEY` 与 `*_BASE_URL` |
| HTTP 429 / 403 | 额度用完、限流或模型未授权 | 平台控制台查看额度与模型开通状态 |
| HTTP 404 / 400（模型名） | 模型在当前平台/地域不存在、已下线或名称不对 | 换一个可用模型，或检查 `GRADE_MODELS` |
| QVQ 报错 | QVQ 只支持流式输出 | 批改接口是非流式，请改用 Qwen3-VL |

> 多数平台的 OpenAI 兼容端点没有统一的模型列表接口，检查连接只能实际发一次最小对话请求；每次检查消耗的 token 很少。
>
> 百炼的 Qwen3-VL 与 Qwen3.5+ 系列默认开启思考模式，批改请求已显式设置 `enable_thinking: false`，避免思考过程拖慢识别；其他平台保持各自默认设置。

> GitHub Pages 只能托管静态页，不能运行 `/api/grade`；拍照批改必须部署到 Vercel（或其他支持 Serverless Function 的平台）。
>
> 当前接口没有用户鉴权。如果把站点公开分享，别人也会消耗你的免费额度；建议只在家庭内部使用，或在前面加访问控制。

### 免费额度与费用

先分清两个概念：

-   **输入图片不等于输出图片**。批改只需要模型“看懂照片里的手写数字”，输出仍然是文字（分数、错题表格）。Qwen 的视觉模型都是“图像/视频输入 → 文本输出”。
-   **不是所有大模型都能看图**。2026 年起 Qwen3.5 / 3.6 / 3.7 / 3.8 系列是原生视觉语言模型，Plus / Flash / Max 都能输入文本、图像、视频；Qwen3-VL 是专用视觉系列。旧文本模型（qwen-plus、qwen-max、qwen-turbo、qwen3-max）只接受文本。

截至 2026-11，华北 2（北京）**同时有免费额度、又能输入图片**的常用模型（以控制台免费额度页面为准）：

| 模型 | 图片输入 | 免费额度 |
| --- | --- | --- |
| `qwen4-max` | 支持 | 100 万 Token |
| `qwen3.8-flash` | 支持 | 100 万 Token |
| `qwen3-vl-plus` | 支持 | 100 万 Token |
| `qwen3.7-plus` | 支持 | 100 万 Token |
| `qwen3.7-flash` | 支持 | 100 万 Token |
| `qwen3.8-max` / `qwen3.8-max-0902` | 支持 | 100 万 Token |
| `qwen-vl-ocr` / `qwen3.5-ocr` | 支持（OCR） | 100 万 Token |
| `kimi-k3.1-pro` | 支持 | 100 万 Token（需在百炼开通 Kimi） |
| `deepseek-v4.1-flash` | 支持 | 100 万 Token |

额度按账号发放，不是每个账号都有上表所有模型，请以控制台「免费额度」页面实际显示为准。默认列表放 `qwen3.8-flash`、`deepseek-v4.1-flash`、`qwen4-max`；把你账号里实际有额度的模型按顺序填进 `QWEN_MODELS` 即可，例如 `qwen3.8-flash,deepseek-v4.1-flash,qwen4-max,qwen3.8-max-0902`。

> `qwen-image-*` 是生图模型，虽然接受图片输入，但输出图片而不是文本，不能用于批改。

已下架免费额度的常见模型（新用户不再发放，老用户已领的仍可用到到期）：`qwen3-vl-flash`（模型已于 2026-10-10 下线）、`qwen-vl-plus`、`qwen-vl-max`、`qwen3-vl-8b-instruct`、Qwen3.5 / 3.6 系列、QVQ 系列。默认列表已避开这些模型。

-   免费额度有效期 90 天，仅华北 2（北京）地域；输入和输出 Token 共用同一份额度。
-   免费额度按模型独立计算，一个模型用完不会自动换；后端会按 `GRADE_MODELS` 跨平台顺序切换。
-   百炼额度不够时，可以再配置 `DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`、`OPENROUTER_API_KEY` 等，用 `GRADE_MODELS` 把其他平台排在前面。
-   请在百炼控制台开启「免费额度用完即停」：额度耗尽时返回 HTTP 403（`AllocationQuota.FreeTierOnly`），避免自动按量扣费。
-   额度到期/耗尽后，拍照批改会返回错误；生成、打印、导出 PDF 不受影响。
-   照片会发送给阿里云百炼，请避开姓名、班级等个人信息；服务端只做转发，不落盘、不写日志。

### 识别边界

-   手写识别不可能 100% 准确；字迹模糊、漏写、照片逆光会标为「存疑」，不冒充确定结果。
-   基础/巩固的唯一答案题自动判分；拓展里的开放题只给参考答案，不计入正确率。
-   题号用于表格对齐；卷面不印题号，模型按题目顺序和算式匹配。
-   只识别算式同一行的括号/圆圈；题目下方折线标注里的中间结果不作为答案。

## 使用

-   本地：直接用浏览器打开 `index.html`
-   在线：部署后访问站点地址

## 题量设计

每页固定 100 题，按数值范围自动分配基础 / 巩固 / 拓展：

| 范围 | 基础 | 巩固 | 拓展 |
| --- | --- | --- | --- |
| 5 以内 | 70 | 18 | 12 |
| 10 以内 | 75 | 15 | 10 |
| 20 以内 | 85 | 9 | 6 |
| 50 以内 | 70 | 18 | 12 |
| 99 以内 | 70 | 18 | 12 |

> 20 以内是默认配置（85/9/6）：基础 17 行、巩固 3 行、拓展 3 行，整页刚好排满。

依据（真实课堂研究）：

-   Ruitenburg 等（2026，*Educational Psychology Review*）对 53 项研究、7303 名中小学生的元分析：提取练习 g=0.37、间隔练习 g=0.20、交错练习 g=0.40。
-   Brunmair & Richter（2019）元分析：数学交错练习 g=0.34。
-   Rohrer 等（2020）随机对照试验：交错练习在延迟测验上 d=0.83；Rohrer & Hartwig（2020）指出同类题连续大量重复的长期收益很低。
-   Ophuis-Cox 等（2023）：二年级用提取练习（先回忆再看答案）能显著提升乘法事实流畅度。
-   Cooper 的“10 分钟/年级”作业量经验规则；Dolean & Lervag（2021）发现二年级约 20 分钟的适度作业效果最好，过量会出现收益递减。

因此基础题保证事实流畅，巩固/拓展提供变式与迁移；建议每天一张、间隔练习，并用延迟反馈（做完再对答案）。

## 说明

`index.html` 是完整前端，无构建步骤、无前端外部依赖；`api/grade.js` 是批改函数，`api/health.js` 诊断 Key 与模型，`api/catalog.js` 提供模型目录，`api/_providers.js` 是模型平台注册表，`api/_catalog.js` 是目录数据。不配置 API Key 时，生成、打印和导出 PDF 仍可正常使用。