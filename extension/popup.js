document.getElementById("recognize").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RECOGNIZE" }, (res) => {
    console.log("识别请求已发送:", res);
  });
});
