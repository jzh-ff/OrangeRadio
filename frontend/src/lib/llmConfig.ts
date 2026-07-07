/**
 * LLM 配置读取（推荐系统用）
 *
 * 从 localStorage 读取 AI provider 配置，组装成 recommend_next 命令的 llm_config 参数。
 * 支持两种 provider：
 *   - minimax：走 MinimaxProvider（anthropic 协议），用 orangeradio_minimax_* 键
 *   - openai：走 CloudLlmProvider（OpenAI 兼容），用 orangeradio_llm_* 键（覆盖 GLM/DeepSeek/通义）
 *
 * 未配置 API key 时返回 null（recommend_next 回退纯本地打分）。
 */

export interface LlmConfig {
  api_base: string;
  api_key: string;
  model: string;
}

export type LlmProvider = "minimax" | "openai";

/** 读取当前 provider 类型（默认 minimax，兼容旧配置） */
export function getLlmProvider(): LlmProvider {
  return (localStorage.getItem("orangeradio_llm_provider") as LlmProvider) || "minimax";
}

/** 读取 LLM 配置；api_key 为空时返回 null（推荐降级为纯本地） */
export function getLlmConfig(): LlmConfig | null {
  const provider = getLlmProvider();
  if (provider === "openai") {
    const apiKey = localStorage.getItem("orangeradio_llm_key") || "";
    if (!apiKey) return null;
    return {
      api_base: localStorage.getItem("orangeradio_llm_base") || "https://open.bigmodel.cn/api/paas/v4",
      api_key: apiKey,
      model: localStorage.getItem("orangeradio_llm_model") || "glm-4-flash",
    };
  }
  // minimax
  const apiKey = localStorage.getItem("orangeradio_minimax_key") || "";
  if (!apiKey) return null;
  return {
    api_base: localStorage.getItem("orangeradio_minimax_base") || "https://api.minimaxi.com/anthropic",
    api_key: apiKey,
    model: localStorage.getItem("orangeradio_minimax_model") || "MiniMax-M1",
  };
}
