import { type CostFunction, inputCacheCostFunction, simpleCostFunction } from "./costs";
import type { LanguageModel } from "./model-registry";
import { anthropicProvider, googleProvider, groqProvider, openRouterProvider } from "./providers";

export interface ModelEntry {
    createModel: () => LanguageModel;
    pricing: CostFunction;
}

type ModelEntryKey =
    | "GEMINI_3_FLASH_PREVIEW"
    | "MINISTRAL_8B"
    | "GPT_OSS_120B"
    | "CLAUDE_SONNET_4_6"
    | "CLAUDE_OPUS_4_8"
    | "CLAUDE_HAIKU_4_5";

export const MODEL_ENTRIES: Record<ModelEntryKey, ModelEntry> = {
    GEMINI_3_FLASH_PREVIEW: {
        createModel: () => googleProvider.getModel("gemini-3-flash-preview"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 0.5,
            cachedInputCostPerM: 0.05,
            outputCostPerM: 3,
        }),
    },
    MINISTRAL_8B: {
        createModel: () => openRouterProvider.getModel("mistralai/ministral-8b-2512"),
        pricing: simpleCostFunction({
            inputCostPerM: 0.15,
            outputCostPerM: 0.15,
        }),
    },
    GPT_OSS_120B: {
        createModel: () => groqProvider.getModel("openai/gpt-oss-120b"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 0.15,
            cachedInputCostPerM: 0.075,
            outputCostPerM: 0.6,
        }),
    },
    // Anthropic (Claude) — native via ANTHROPIC_API_KEY. Pricing in USD per 1M
    // tokens (approximate list prices; update if Anthropic changes them).
    CLAUDE_SONNET_4_6: {
        createModel: () => anthropicProvider.getModel("claude-sonnet-4-6"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 3,
            cachedInputCostPerM: 0.3,
            outputCostPerM: 15,
        }),
    },
    CLAUDE_OPUS_4_8: {
        createModel: () => anthropicProvider.getModel("claude-opus-4-8"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 15,
            cachedInputCostPerM: 1.5,
            outputCostPerM: 75,
        }),
    },
    CLAUDE_HAIKU_4_5: {
        createModel: () => anthropicProvider.getModel("claude-haiku-4-5-20251001"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 1,
            cachedInputCostPerM: 0.1,
            outputCostPerM: 5,
        }),
    },
};

export const OPENROUTER_MODEL_ENTRIES: Record<ModelEntryKey, ModelEntry> = {
    GEMINI_3_FLASH_PREVIEW: {
        createModel: () => openRouterProvider.getModel("google/gemini-3-flash-preview"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 0.5,
            cachedInputCostPerM: 0.05,
            outputCostPerM: 3,
        }),
    },
    MINISTRAL_8B: {
        createModel: () => openRouterProvider.getModel("meta-llama/llama-4-maverick"),
        pricing: simpleCostFunction({
            inputCostPerM: 0.2,
            outputCostPerM: 0.6,
        }),
    },
    GPT_OSS_120B: {
        createModel: () => openRouterProvider.getModel("openai/gpt-oss-120b"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 0.15,
            cachedInputCostPerM: 0.075,
            outputCostPerM: 0.6,
        }),
    },
    // Claude routed through OpenRouter (for setups with only an OpenRouter key).
    CLAUDE_SONNET_4_6: {
        createModel: () => openRouterProvider.getModel("anthropic/claude-sonnet-4-6"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 3,
            cachedInputCostPerM: 0.3,
            outputCostPerM: 15,
        }),
    },
    CLAUDE_OPUS_4_8: {
        createModel: () => openRouterProvider.getModel("anthropic/claude-opus-4-8"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 15,
            cachedInputCostPerM: 1.5,
            outputCostPerM: 75,
        }),
    },
    CLAUDE_HAIKU_4_5: {
        createModel: () => openRouterProvider.getModel("anthropic/claude-haiku-4-5"),
        pricing: inputCacheCostFunction({
            inputCostPerM: 1,
            cachedInputCostPerM: 0.1,
            outputCostPerM: 5,
        }),
    },
};
