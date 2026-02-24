import http from "node:http";
import { getVideoContextAndChapters, analyzeVideoFrame } from "./videoContextService.js";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10_000_000) { // 10MB limit
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      resolve(data);
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, { ok: true, service: "video-context-api" });
    return;
  }

    if (req.method === "POST" && req.url === "/api/analyze-frame") {
    try {
      const raw = await readRequestBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const imageBase64 = payload.image;
      const contextText = payload.contextText || "";

      if (typeof imageBase64 !== "string" || !imageBase64.startsWith("data:image/")) {
        writeJson(res, 400, { ok: false, error: "Valid image base64 string is required" });
        return;
      }
      
      console.log(`[Server] Received frame analysis request. Image size: ${imageBase64.length} chars. Context: ${contextText.substring(0, 50)}...`);

      const result = await analyzeVideoFrame(imageBase64, contextText);
      writeJson(res, 200, { ok: true, data: result });
      return;
    } catch (error) {
      console.error("[Server] Frame analysis error:", error);
      writeJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "unknown error"
      });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/video-context") {
    try {
      const raw = await readRequestBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const videoUrl = payload.videoUrl;

      if (typeof videoUrl !== "string" || videoUrl.trim() === "") {
        writeJson(res, 400, { ok: false, error: "videoUrl is required" });
        return;
      }

      const result = await getVideoContextAndChapters(videoUrl);
      writeJson(res, 200, { ok: true, data: result });
      return;
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "unknown error"
      });
      return;
    }
  }

  writeJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, () => {
  process.stdout.write(`video-context-api listening on http://localhost:${PORT}\n`);
});
