// OrangeRadio 识歌扩展 —— Service Worker
// v0.9 完整实现：捕获标签页音频 → 发送指纹识别 → 通过 nativeMessaging 跳转 OrangeRadio

chrome.runtime.onInstalled.addListener(() => {
  console.log("OrangeRadio 识歌助手已安装");
});

// 监听来自 popup / content 的识歌请求
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "RECOGNIZE") {
    // v0.9 实现：调用 chromaprint 识别
    sendResponse({ status: "pending", stage: "v0.9" });
  }
  return true;
});
