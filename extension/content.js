const PANEL_ID = "bili-context-agent-panel";
const RECOGNITION_OVERLAY_ID = "bili-recognition-overlay";
const API_BASE = "http://localhost:8787";

let state = {
  isSummaryOn: true,
  isRecognitionOn: true, // Default to true as requested
  summaryData: null,
  isFetchingSummary: false
};

// --- Helper Functions ---

function getVideoElement() {
  return document.querySelector("video");
}

function formatTime(seconds) {
  const sec = Math.max(0, Math.floor(seconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function seekTo(second) {
  const video = getVideoElement();
  if (!video) return false;
  video.currentTime = Math.max(0, Number(second) || 0);
  video.play(); // Auto play after seek
  return true;
}

// --- API Calls ---

function renderLoadingState() {
  const panel = getOrCreatePanel();
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong>视频章节导航</strong>
      <button id="bili-context-close" style="border:0;background:#374151;color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer;">隐藏</button>
    </div>
    <div style="padding: 20px; text-align: center; color: #9ca3af;">
      <div style="margin-bottom: 8px;">正在分析视频内容...</div>
      <div style="font-size: 12px;">可能需要几秒钟</div>
    </div>
  `;
  
  const closeBtn = panel.querySelector("#bili-context-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
    });
  }
  panel.style.display = "block";
}

async function fetchSummary() {
  if (state.isFetchingSummary) return;
  
  // Only run on video pages
  if (!location.href.includes("/video/BV")) return;
  
  state.isFetchingSummary = true;
  if (state.isSummaryOn) {
    renderLoadingState();
  }
  
  try {
    const videoUrl = window.location.href;
    console.log("[BiliAgent] Fetching summary for:", videoUrl);
    
    const response = await fetch(`${API_BASE}/api/video-context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoUrl })
    });
    
    const json = await response.json();
    if (json.ok && json.data) {
      state.summaryData = json.data;
      if (state.isSummaryOn) {
        renderChapterPanel(state.summaryData);
      }
    } else {
      console.error("[BiliAgent] API returned error:", json);
      if (state.isSummaryOn) {
        const panel = getOrCreatePanel();
        panel.innerHTML = `<div style="padding:10px;color:red;">获取失败: ${json.error || "未知错误"}</div>`;
      }
    }
  } catch (err) {
    console.error("[BiliAgent] Failed to fetch summary:", err);
    if (state.isSummaryOn) {
      const panel = getOrCreatePanel();
      panel.innerHTML = `<div style="padding:10px;color:red;">连接后端失败，请确保服务已启动</div>`;
    }
  } finally {
    state.isFetchingSummary = false;
  }
}

async function analyzeFrame(imageBase64) {
  try {
    // Get video title as context
    const videoTitle = document.title || "";
    
    const response = await fetch(`${API_BASE}/api/analyze-frame`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 
        image: imageBase64,
        contextText: videoTitle
      })
    });
    const json = await response.json();
    return json.ok ? json.data : "识别失败";
  } catch (err) {
    console.error("Frame analysis failed:", err);
    return "分析服务不可用";
  }
}

// --- UI Rendering ---

function getOrCreatePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    position: "fixed",
    top: "72px",
    right: "16px",
    width: "320px",
    maxHeight: "70vh",
    overflow: "auto",
    zIndex: "999999",
    padding: "12px",
    background: "rgba(17, 24, 39, 0.95)",
    color: "#f3f4f6",
    border: "1px solid rgba(156, 163, 175, 0.45)",
    borderRadius: "10px",
    boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
    font: "14px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  });
  document.body.appendChild(panel);
  return panel;
}

function renderChapterPanel(payload) {
  if (!state.isSummaryOn) return;
  
  const panel = getOrCreatePanel();
  const context = payload?.context || "";
  const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];

  const chapterHtml = chapters
    .map((chapter) => {
      const start = Number(chapter.startSec) || 0;
      const end = Number(chapter.endSec) || 0;
      const title = chapter.title || "未命名章节";
      const summary = chapter.summary || "";
      return `
        <button data-start="${start}" style="display:block;width:100%;text-align:left;margin:0 0 8px 0;padding:8px;border-radius:8px;border:1px solid #4b5563;background:#111827;color:#f9fafb;cursor:pointer;">
          <div style="font-weight:600;margin-bottom:4px;">${title}</div>
          <div style="font-size:12px;color:#cbd5e1;margin-bottom:4px;">${formatTime(start)} - ${formatTime(end)}</div>
          <div style="font-size:12px;color:#d1d5db;">${summary}</div>
        </button>
      `;
    })
    .join("");

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong>视频章节导航</strong>
      <button id="bili-context-close" style="border:0;background:#374151;color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer;">隐藏</button>
    </div>
    <div style="font-size:12px;color:#d1d5db;margin-bottom:10px;">${context}</div>
    <div>${chapterHtml || "暂无章节数据"}</div>
  `;

  panel.querySelector("#bili-context-close").addEventListener("click", () => {
    // Only hide the panel, don't turn off the switch logic
    panel.style.display = "none";
  });
  
  // Make sure it's visible if we just rendered it
  panel.style.display = "block";

  panel.querySelectorAll("button[data-start]").forEach(btn => {
    btn.addEventListener("click", () => {
      seekTo(btn.getAttribute("data-start"));
    });
  });
}

function showRecognitionResult(text) {
  let overlay = document.getElementById(RECOGNITION_OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = RECOGNITION_OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      background: "rgba(0, 0, 0, 0.8)",
      color: "#fff",
      padding: "20px",
      borderRadius: "12px",
      maxWidth: "80%",
      zIndex: "100000",
      fontSize: "16px",
      textAlign: "center",
      // pointerEvents: "none" // Removed to allow interaction with buttons
    });
    // Append to video container if possible, else body
    const videoContainer = document.querySelector(".bpx-player-video-area") || document.body;
    videoContainer.appendChild(overlay);
  }
  
  // Parse text for structured keywords: "关键词1：解释；关键词2：解释..."
  // If text starts with "正在" or "失败", just show text.
  if (text.startsWith("正在") || text.includes("失败")) {
      overlay.textContent = text;
      overlay.style.pointerEvents = "none"; // Non-interactive for status messages
  } else {
      // Parse structured output
      overlay.innerHTML = ""; // Clear
      overlay.style.pointerEvents = "auto"; // Allow clicking buttons
      
      const title = document.createElement("div");
      title.textContent = "画面识别 (点击关键词查看详情)";
      title.style.marginBottom = "12px";
      title.style.fontWeight = "bold";
      title.style.fontSize = "14px";
      title.style.color = "#a5b4fc";
      overlay.appendChild(title);

      const container = document.createElement("div");
      container.style.display = "flex";
      container.style.flexWrap = "wrap";
      container.style.gap = "8px";
      container.style.justifyContent = "center";
      
      // Split by common delimiters: semicolon, newline
      const items = text.split(/；|\n/).filter(s => s.trim().length > 0);
      
      let hasValidItem = false;
      items.forEach(item => {
          // Expect format "Keyword: Explanation" or "Keyword：Explanation"
          const parts = item.split(/[:：]/);
          if (parts.length >= 2) {
              hasValidItem = true;
              const keyword = parts[0].trim();
              const explanation = parts.slice(1).join("：").trim(); // Rejoin rest in case of extra colons
              
              const btn = document.createElement("button");
              btn.textContent = keyword;
              Object.assign(btn.style, {
                  padding: "6px 12px",
                  background: "#374151",
                  border: "1px solid #4b5563",
                  borderRadius: "20px",
                  color: "#f3f4f6",
                  cursor: "pointer",
                  fontSize: "14px",
                  transition: "all 0.2s"
              });
              
              // Interaction
              btn.onclick = (e) => {
                  e.stopPropagation(); // Prevent bubbling if needed
                  // Show explanation in a toast or just replace overlay content temporarily?
                  // Let's create a temporary tooltip/explanation box below the buttons
                  let expBox = overlay.querySelector(".exp-box");
                  if (!expBox) {
                      expBox = document.createElement("div");
                      expBox.className = "exp-box";
                      Object.assign(expBox.style, {
                          marginTop: "12px",
                          padding: "10px",
                          background: "#1f2937",
                          borderRadius: "8px",
                          border: "1px solid #6b7280",
                          fontSize: "13px",
                          lineHeight: "1.4",
                          textAlign: "left",
                          animation: "fadeIn 0.2s"
                      });
                      overlay.appendChild(expBox);
                  }
                  expBox.innerHTML = `<strong style="color: #60a5fa;">${keyword}</strong>: <span style="color: #e5e7eb;">${explanation}</span>`;
              };
              
              container.appendChild(btn);
          } 
      });

      if (!hasValidItem && items.length > 0) {
         // Fallback if no colons found, just display the raw text
         const span = document.createElement("div");
         span.textContent = text;
         span.style.fontSize = "14px";
         span.style.lineHeight = "1.5";
         container.appendChild(span);
      }
      
      overlay.appendChild(container);
  }

  overlay.style.display = "block";
}

function hideRecognitionResult() {
  const overlay = document.getElementById(RECOGNITION_OVERLAY_ID);
  if (overlay) overlay.style.display = "none";
}

// --- Logic ---

function onVideoPause() {
  if (!state.isRecognitionOn) return;
  
  const video = getVideoElement();
  if (!video) return;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    
    // Attempt to draw
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // This line will throw if the canvas is tainted (CORS issue)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.5); // Lower quality to save bandwidth

    showRecognitionResult("正在识别画面内容...");
    
    analyzeFrame(dataUrl).then(result => {
      if (video.paused) {
        showRecognitionResult(result);
      }
    });
  } catch (err) {
    console.error("[BiliAgent] Canvas capture error:", err);
    // If it's a security error, we can't do much from a content script without host permissions or background script help
    if (err.name === "SecurityError") {
       showRecognitionResult("截图失败: 浏览器安全策略阻止了读取视频画面 (CORS)");
    } else {
       showRecognitionResult("截图失败: " + err.message);
    }
  }
}

function onVideoPlay() {
  hideRecognitionResult();
}

function injectSwitches() {
  // Target Bilibili player control bar
  // .bpx-player-control-bottom-right is a common class for the right side controls
  const targetArea = document.querySelector(".bpx-player-control-bottom-right") || 
                     document.querySelector(".bilibili-player-video-control-bottom-right") ||
                     document.querySelector(".squirtle-controller-wrap-right"); // Added another potential selector
  
  if (!targetArea) {
    // console.log("[BiliAgent] Player controls not found yet...");
    return;
  }
  
  if (document.getElementById("geekday-switches")) return;

  console.log("[BiliAgent] Injecting switches into player controls");

  const container = document.createElement("div");
  container.id = "geekday-switches";
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.marginRight = "10px";
  container.style.color = "#fff";
  container.style.fontSize = "12px";

  // Switch 1: Summary
  const label1 = document.createElement("label");
  label1.style.marginRight = "8px";
  label1.style.cursor = "pointer";
  label1.style.display = "flex";
  label1.style.alignItems = "center";
  
  const input1 = document.createElement("input");
  input1.type = "checkbox";
  input1.checked = state.isSummaryOn;
  input1.style.marginRight = "4px";
  input1.addEventListener("change", (e) => {
    state.isSummaryOn = e.target.checked;
    if (state.isSummaryOn) {
      if (state.summaryData) {
        renderChapterPanel(state.summaryData);
      } else {
        fetchSummary();
      }
    } else {
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.style.display = "none";
    }
  });
  
  label1.appendChild(input1);
  label1.appendChild(document.createTextNode("AI总结"));

  // Switch 2: Recognition
  const label2 = document.createElement("label");
  label2.style.cursor = "pointer";
  label2.style.display = "flex";
  label2.style.alignItems = "center";
  
  const input2 = document.createElement("input");
  input2.type = "checkbox";
  input2.checked = state.isRecognitionOn;
  input2.style.marginRight = "4px";
  input2.addEventListener("change", (e) => {
    state.isRecognitionOn = e.target.checked;
  });

  label2.appendChild(input2);
  label2.appendChild(document.createTextNode("画面识别"));

  container.appendChild(label1);
  container.appendChild(label2);
  
  // Insert as first child of the right control area
  targetArea.insertBefore(container, targetArea.firstChild);
}

function init() {
  console.log("[BiliAgent] Initializing...");
  
  // Try to inject immediately
  injectSwitches();
  
  // Use an interval to check for player controls more reliably than MutationObserver
  // because Bilibili player might be inside nested structures or load lazily
  setInterval(injectSwitches, 1000);

  // Video Event Listeners
  // We use capture to ensure we get the event
  document.addEventListener("pause", (e) => {
    if (e.target.tagName === "VIDEO") onVideoPause();
  }, true);

  document.addEventListener("play", (e) => {
    if (e.target.tagName === "VIDEO") onVideoPlay();
  }, true);
  
  // Initial fetch if enabled
  if (state.isSummaryOn) {
    // Wait a bit for page to stabilize
    setTimeout(fetchSummary, 3000);
  }

  // Handle SPA navigation
  let lastUrl = location.href;
  setInterval(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log("[BiliAgent] URL changed to:", url);
      
      // Reset state for new video
      state.summaryData = null;
      // Hide old panel content if needed
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.style.display = "none";
      
      if (state.isSummaryOn) {
         // Wait for new page content to settle
         setTimeout(fetchSummary, 3000);
      }
    }
  }, 1000);
}

// Start
init();

// Listen for popup messages (legacy support)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
  } else if (message.type === "RENDER_CHAPTERS") {
    state.summaryData = message.payload;
    if (state.isSummaryOn) renderChapterPanel(state.summaryData);
    sendResponse({ ok: true });
  } else if (message.type === "GET_PLAYER_STATE") {
    const video = getVideoElement();
    sendResponse({
      ok: true,
      isPlaying: video && !video.paused,
      currentTime: video ? video.currentTime : 0
    });
  }
});
