# Geekday - Bilibili Low-Efficiency Content Detection Plugin

## 1. 环境准备 (Prerequisites)

- **Node.js**: 需 v18 或更高版本 (用于原生 `fetch` 支持)
- **Chrome 浏览器**: 用于加载插件

## 2. 配置 (Configuration)

在项目根目录下创建一个 `.env` 文件，并填入以下配置：

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-5.2
```

## 3. 启动后端 (Run Backend)

在项目根目录下打开终端，运行：

```bash
npm start
```

服务将启动在 `http://localhost:8787`。

## 4. 加载插件 (Load Extension)

1. 在 Chrome 浏览器中打开 `chrome://extensions`。
2. 打开右上角的 **开发者模式 (Developer mode)**。
3. 点击 **加载已解压的扩展程序 (Load unpacked)**。
4. 选择本项目中的 `extension` 文件夹。

## 5. 使用说明 (Usage)

1. 打开任意 Bilibili 视频页面。
2. 点击浏览器插件栏的 Geekday 图标打开侧边栏。
3. 插件将读取当前视频链接并请求后端进行分析。

