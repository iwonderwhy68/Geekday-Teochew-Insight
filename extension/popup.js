const API_BASE = "http://localhost:8787";

const videoUrlInput = document.getElementById("videoUrl");
const statusEl = document.getElementById("status");
const playerStateEl = document.getElementById("playerState");

const syncTabBtn = document.getElementById("syncTabBtn");
const checkPlayerBtn = document.getElementById("checkPlayerBtn");
const analyzeBtn = document.getElementById("analyzeBtn");

function setStatus(message) {
  statusEl.textContent = `状态：${message}`;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  }
}

async function fillUrlFromActiveTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    setStatus("无法获取当前标签页链接");
    return;
  }
  videoUrlInput.value = tab.url;
  setStatus("已同步当前标签页链接");
}

async function readPlayerStateBool() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    playerStateEl.textContent = "播放器状态：未知";
    return;
  }

  try {
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PLAYER_STATE" });
    const isPlaying = Boolean(response?.isPlaying);
    playerStateEl.textContent = `播放器状态：${isPlaying}`;
  } catch {
    playerStateEl.textContent = "播放器状态：false（未在 B 站视频页或内容脚本未加载）";
  }
}

async function requestVideoContext(videoUrl) {
  let response;
  try {
    response = await fetch(`${API_BASE}/api/video-context`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ videoUrl })
    });
  } catch {
    throw new Error("后端不可达，请确保后端服务已启动");
  }

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload.data;
}

async function pushChaptersToPage(payload) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("找不到可用标签页");
  }

  await ensureContentScript(tab.id);

  await chrome.tabs.sendMessage(tab.id, {
    type: "RENDER_CHAPTERS",
    payload
  });
}

syncTabBtn.addEventListener("click", fillUrlFromActiveTab);

checkPlayerBtn.addEventListener("click", async () => {
  await readPlayerStateBool();
});

analyzeBtn.addEventListener("click", async () => {
  const videoUrl = videoUrlInput.value.trim();
  if (!videoUrl) {
    setStatus("请先输入或同步视频链接");
    return;
  }

  setStatus("请求后端分析中...");

  try {
    const data = await requestVideoContext(videoUrl);
    await pushChaptersToPage({ context: data.context, chapters: data.chapters });
    setStatus("已输出章节到页面，点击章节可跳转");
  } catch (error) {
    setStatus(`失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
});

fillUrlFromActiveTab().catch(() => {
  setStatus("初始化失败");
});
