import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BILIBILI_VIEW_API = "https://api.bilibili.com/x/web-interface/view";
const BILIBILI_PAGELIST_API = "https://api.bilibili.com/x/player/pagelist";
const BILIBILI_PLAYURL_API = "https://api.bilibili.com/x/player/playurl";
const DANMAKU_XML_API = "https://comment.bilibili.com";
const ENV_PATH = path.join(__dirname, "../../.env"); // Relative to backend/src/

function decodeHtmlEntities(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function parseDotEnv(content) {
  const vars = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

async function readModelEnv() {
  let raw = "";
  try {
    raw = await fs.readFile(ENV_PATH, "utf8");
  } catch (err) {
    // If we can't read the file, try to read from process.env if available (for testing or container environments)
    // But since we rely on .env file parsing here, we might just return empty or default
    console.warn(`Warning: Could not read .env file at ${ENV_PATH}: ${err.message}`);
  }
  
  const vars = parseDotEnv(raw);
  const apiKey = vars.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = vars.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "";
  const modelId = vars.MODEL_NAME || process.env.MODEL_NAME || "";
  const tavilyKey = vars.TAVILY_API_KEY || process.env.TAVILY_API_KEY || "";

  if (!apiKey || !baseUrl || !modelId || !tavilyKey) {
    // throw new Error("环境变量缺失：请检查 .env 中 OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME / TAVILY_API_KEY");
    // For development stability, let's log and return empty to allow fallback to work
     console.error("环境变量缺失：请检查 .env 中 OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME / TAVILY_API_KEY");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
    modelId
  };
}

export function extractBvid(videoUrl) {
  if (typeof videoUrl !== "string" || videoUrl.trim() === "") {
    return null;
  }

  const url = videoUrl.trim();
  const directMatch = url.match(/(BV[0-9A-Za-z]{10})/);
  if (directMatch) {
    return directMatch[1];
  }

  try {
    const parsed = new URL(url);
    const bvid = parsed.searchParams.get("bvid");
    return bvid && /^BV[0-9A-Za-z]{10}$/.test(bvid) ? bvid : null;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchVideoViewByBvid(bvid) {
  const data = await fetchJson(`${BILIBILI_VIEW_API}?bvid=${encodeURIComponent(bvid)}`);
  if (data.code !== 0 || !data.data) {
    throw new Error(`Bilibili view API error: ${data.message || data.code}`);
  }
  return data.data;
}

export async function fetchPagelistByBvid(bvid) {
  const data = await fetchJson(`${BILIBILI_PAGELIST_API}?bvid=${encodeURIComponent(bvid)}`);
  if (data.code !== 0 || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error(`Bilibili pagelist API error: ${data.message || data.code}`);
  }
  return data.data;
}

export async function fetchPlayUrl({ bvid, cid }) {
  const query = new URLSearchParams({
    bvid,
    cid: String(cid),
    qn: "64",
    fnver: "0",
    fnval: "16",
    fourk: "1",
    platform: "html5"
  });
  const data = await fetchJson(`${BILIBILI_PLAYURL_API}?${query.toString()}`);
  if (data.code !== 0 || !data.data) {
    return null;
  }

  const durl = data.data.durl?.[0]?.url || null;
  const dashVideo = data.data.dash?.video?.[0]?.baseUrl || data.data.dash?.video?.[0]?.base_url || null;
  return dashVideo || durl;
}

export function parseDanmakuXml(xmlText) {
  const entries = [];
  const regex = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
  let match = regex.exec(xmlText);

  while (match) {
    const pAttr = match[1];
    const contentRaw = match[2] || "";
    const parts = pAttr.split(",");
    const second = Number.parseFloat(parts[0]);

    if (Number.isFinite(second)) {
      entries.push({
        second,
        text: decodeHtmlEntities(contentRaw).trim()
      });
    }

    match = regex.exec(xmlText);
  }

  return entries;
}

export async function fetchDanmakuByCid(cid) {
  const response = await fetch(`${DANMAKU_XML_API}/${cid}.xml`, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Danmaku API failed: ${response.status} ${response.statusText}`);
  }

  const xmlText = await response.text();
  return parseDanmakuXml(xmlText);
}

function uniqueTexts(entries, limit = 6) {
  const result = [];
  const seen = new Set();

  for (const entry of entries) {
    const text = entry.text;
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function normalizeChapter(chapter, index, duration) {
  const startRaw = Number(chapter?.startSec);
  const endRaw = Number(chapter?.endSec);
  const startSec = Number.isFinite(startRaw) ? Math.max(0, Math.floor(startRaw)) : 0;
  const endSec = Number.isFinite(endRaw) ? Math.max(startSec + 1, Math.floor(endRaw)) : Math.min(duration, startSec + 60);
  return {
    id: `sec_${index + 1}`,
    title: typeof chapter?.title === "string" && chapter.title.trim() ? chapter.title.trim() : `章节 ${index + 1}`,
    startSec,
    endSec: Math.min(duration, endSec),
    summary: typeof chapter?.summary === "string" && chapter.summary.trim() ? chapter.summary.trim() : ""
  };
}

function fallbackChapters(duration, danmakuEntries) {
  const safeDuration = Math.max(1, Math.floor(duration || 0));
  const chapterCount = Math.max(3, Math.min(6, Math.round(safeDuration / 90)));
  const step = Math.ceil(safeDuration / chapterCount);
  const chapters = [];

  for (let i = 0; i < chapterCount; i += 1) {
    const startSec = i * step;
    const endSec = i === chapterCount - 1 ? safeDuration : Math.min(safeDuration, (i + 1) * step);
    const segmentEntries = danmakuEntries.filter((d) => d.second >= startSec && d.second < endSec);
    chapters.push({
      id: `sec_${i + 1}`,
      title: `章节 ${i + 1}`,
      startSec,
      endSec,
      summary: uniqueTexts(segmentEntries, 3).join("；") || "该章节暂无高置信摘要"
    });
  }

  return chapters;
}

export function buildSections(duration, danmakuEntries) {
  return fallbackChapters(duration, danmakuEntries);
}

function parseJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function llmSummarize({ videoUrl, title, description, duration, playUrl, danmakuEntries }) {
  const env = await readModelEnv();
  const sampleDanmaku = uniqueTexts(danmakuEntries, 30);
  const promptPayload = {
    videoUrl,
    directVideoUrl: playUrl,
    title,
    description,
    durationSec: duration,
    danmakuSamples: sampleDanmaku
  };

  const response = await fetch(`${env.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.apiKey}`
    },
    body: JSON.stringify({
      model: env.modelId,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "你是视频内容分析助手，特别擅长识别和解读潮汕文化（Teochew Culture）。\n\n请首先根据视频标题、简介和弹幕判断该视频是否与潮汕（Chaoshan/Teochew）相关（关键词：潮汕、潮州、汕头、揭阳、汕尾、胶己人、英歌、拜老爷、出花园、营老爷、牛肉丸、工夫茶等）。\n\n**如果是潮汕相关视频**：\n1. 在 context 字段中，除了总结视频大意，请重点提取和解释视频中的潮汕文化元素（如民俗、美食、建筑、方言梗）。\n2. 在 chapters 的 summary 中，除了概括情节，请标注出现的文化现象（例如：“英歌舞-时迁探路”、“拜老爷-祭祀仪式”）。\n3. 保持“胶己人”的亲切感，但解释要专业准确。\n\n**如果不是潮汕视频**，则按常规方式总结。\n\n仅输出 JSON，不要输出任何额外文字。JSON 结构必须是 {\"context\": string, \"chapters\": [{\"title\": string, \"startSec\": number, \"endSec\": number, \"summary\": string}]}。章节要按时间递增，覆盖视频主体。请在 summary 字段中包含对内容的判断，例如：【片头】、【片尾】、【硬广】、【软广(置信度:High/Medium/Low)】。特别注意【硬广】的识别：请仔细分析视频内容，重点识别那些“剧情式植入”的硬广。这类广告通常隐藏在正常剧情或对话中，但会突然转折，开始详细介绍或推广特定产品（如游戏、猫粮、二手交易平台等）。特征是：虽然有上下文衔接，但内容焦点突然集中在产品功能、品牌介绍或推广上。请务必将这部分内容标记为【硬广】，并准确标注其起止时间。"
        },
        {
          role: "user",
          content: `请基于以下信息总结视频并给出分章节：${JSON.stringify(promptPayload)}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonFromText(content);
  if (!parsed || typeof parsed.context !== "string" || !Array.isArray(parsed.chapters)) {
    throw new Error("LLM 返回格式不合法");
  }

  const chapters = parsed.chapters
    .map((chapter, idx) => normalizeChapter(chapter, idx, Math.max(1, Math.floor(duration))))
    .filter((c) => c.endSec > c.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  return {
    context: parsed.context.trim(),
    chapters
  };
}

export async function getVideoContextAndChapters(videoUrl) {
  const bvid = extractBvid(videoUrl);
  if (!bvid) {
    throw new Error("Invalid Bilibili URL or BV id not found.");
  }

  const view = await fetchVideoViewByBvid(bvid);
  const duration = Number(view.duration) || 0;
  const cid = view.cid || (await fetchPagelistByBvid(bvid))[0]?.cid;
  const title = view.title || "";
  const description = view.desc || "";

  let danmakuEntries = [];
  if (cid) {
    try {
      danmakuEntries = await fetchDanmakuByCid(cid);
    } catch {
      danmakuEntries = [];
    }
  }

  let playUrl = null;
  if (cid) {
    try {
      playUrl = await fetchPlayUrl({ bvid, cid });
    } catch {
      playUrl = null;
    }
  }

  let llmUsed = false;
  let context = "";
  let chapters = [];

  try {
    const llmResult = await llmSummarize({
      videoUrl,
      title,
      description,
      duration,
      playUrl,
      danmakuEntries
    });
    context = llmResult.context;
    chapters = llmResult.chapters;
    llmUsed = true;
  } catch (error) {
    console.error("LLM Summarize Error:", error);
    context = `${title}：基于视频元数据与弹幕样本的回退摘要。建议补充可用模型配置以获取更精准章节。`;
    chapters = fallbackChapters(duration, danmakuEntries);
  }

  return {
    source: {
      platform: "bilibili",
      bvid,
      cid: cid || null,
      duration,
      title,
      owner: view.owner?.name || "",
      videoUrl,
      playUrl,
      fetchedAt: new Date().toISOString(),
      llmUsed
    },
    context,
    chapters
  };
}

export async function analyzeVideoFrame(imageBase64, contextText = "") {
  const env = await readModelEnv();
  
  // Log configuration (excluding sensitive keys) to debug
  console.log("Analyzing frame with model:", env.modelId, "Base URL:", env.baseUrl);

  // Determine if we need to switch models for vision tasks
  // GLM-5 often doesn't support vision, but GLM-4v does. 
  // If the user configured GLM-5, let's try to fallback to a known vision model if available, 
  // or just use the configured one but maybe the endpoint expects a different format.
  // However, the error explicitely says "model GLM-5 do not support image params".
  
  // Let's try to use "GLM-4v" or "gpt-4o" if the current model fails, or just force a vision-capable model if we can guess it.
  // Since we can't easily guess valid models on a custom endpoint, let's try to use a "vision" model ID if the current one is GLM-5.
  let modelToUse = env.modelId;


  try {
    const requestBody = {
      model: modelToUse, 
      messages: [
        {
          role: "system",
          content: `你是一个基于多模态大模型的“赛博潮汕向导”（Teochew Insight）。

请识别提供的视频帧，并提取3-5个关键信息。

**核心识别策略（优先级从高到低）**：

1.  **潮汕文化元素（最高优先级 - 需兼具科普性与人文感）**：
    *   **识别对象**：英歌舞（区分角色）、建筑（下山虎/四点金/骑楼）、美食（牛肉丸/生腌/粿品）、民俗（营老爷/拜神）。
    *   **解释风格**：**高信息量科普 + 浓郁人文气息**。
        *   不要只描述画面（如“一条街道”），要挖掘背后的**文化肌理**与**生活张力**。
        *   *Bad Case*：“城镇街景：高机位俯拍一条居民区道路，两侧楼房密集。”（太干瘪）
        *   *Good Case*：“老市区肌理：错落的骑楼与密集的电线交织，这是潮汕老城的典型风貌。斑驳的墙面记录着岁月，狭窄的巷弄里藏着浓郁的市井烟火气，仿佛能闻到街角工夫茶的清香。”
        *   *Good Case*：“英歌舞-时迁：舞者手持蛇形道具，作为探路先锋。他不仅是梁山好汉的化身，更代表了潮汕人敢闯敢拼、驱邪祈福的刚劲精神。”

2.  **常规视觉元素（中等优先级 - 关联生活气息）**：
    *   如果画面中没有明显的专属文化符号，请尝试捕捉**生活氛围**。
    *   比如识别到“摩托车大军”，可以关联到“这是潮汕地区常见的出行方式，承载着忙碌与生机”。
    *   如果实在无法关联，再进行客观描述。

3.  **基础画面特征（保底优先级）**：
    *   如果画面极暗、极亮、模糊或纯色，请直接描述视觉现象（如“黑色背景”、“画面模糊”、“过曝画面”）。
    *   **绝对不要返回“无法识别”或空内容**。即使是纯黑画面，也要输出“黑色背景：画面暂无内容，可能是转场或黑屏”。

**输出格式要求（STRICT）**：
请务必用中文回答，严格遵守以下格式，每一行必须是一个独立的关键词和解释，不要把“关键词1”当作实际的词：
[具体物体名称]：[解释内容]
[具体场景名称]：[解释内容]
...

**示例**：
✅ 正确：
老市区肌理：错落的骑楼与密集的电线交织...
英歌舞-时迁：舞者手持蛇形道具...

❌ 错误：
关键词1：老市区肌理...
关键词2：英歌舞-时迁...`
        },
        {
          role: "user",
          content: [
            { type: "text", text: `视频标题：${contextText}\n请识别这张图片的内容。即使画面普通或模糊，也请给出描述。` },
            {
              type: "image_url",
              image_url: {
                url: imageBase64
              }
            }
          ]
        }
      ]
    };

    // SophNet API specific: use max_completion_tokens instead of max_tokens if needed, or omit it.
    // Based on the error log: "Use 'max_completion_tokens' instead."
    // Increased limit to avoid "finish_reason: length" with empty content
    requestBody.max_completion_tokens = 2048;

    const response = await fetch(`${env.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("LLM API Error:", response.status, response.statusText, errorText);
      
      // Retry with text-only prompt if vision is not supported
      if (response.status === 400 && errorText.includes("not support image params")) {
         console.warn("Model does not support vision, falling back to text analysis of metadata (simulated).");
         // Fall through to text fallback below
      } else {
        // Other errors
        return `识别服务繁忙 (${response.status})，正在重试...`;
      }
    } else {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) return content;
        console.warn("Vision API returned empty content. Response:", JSON.stringify(data));
    }

    // Fallback: Text-only analysis if vision failed or returned empty
    if (contextText && contextText.trim().length > 0) {
        console.log("Attempting fallback text analysis with context:", contextText);
        try {
            const textResponse = await fetch(`${env.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${env.apiKey}`
                },
                body: JSON.stringify({
                    model: env.modelId,
                    messages: [
                        {
                            role: "system",
                            content: "你是一个潮汕文化助手。用户尝试识别视频画面但失败了（可能是画面模糊或模型限制）。请根据视频标题/上下文，推测并介绍可能相关的潮汕文化知识。请务必用中文回答，格式为：\n关键词：解释\n关键词：解释\n(请在开头简短注明：因画面识别受限，以下内容基于视频标题推测)"
                        },
                        {
                            role: "user",
                            content: `视频标题：${contextText}`
                        }
                    ]
                })
            });
            
            if (textResponse.ok) {
                 const textData = await textResponse.json();
                 const textContent = textData?.choices?.[0]?.message?.content;
                 if (textContent) {
                     return textContent;
                 }
            }
        } catch (fallbackErr) {
            console.error("Fallback text analysis failed:", fallbackErr);
        }
    }

    return "当前画面信息不足，请尝试在光线充足或主体清晰的片段暂停";
  } catch (error) {
    console.error("Frame Analysis Exception:", error);
    return "服务连接不稳定，请稍后重试";
  }
}
