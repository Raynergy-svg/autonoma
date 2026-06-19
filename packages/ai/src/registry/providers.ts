import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "../env";
import type { LanguageModel } from "./model-registry";

export type ProviderV3 = Exclude<typeof AI_SDK_DEFAULT_PROVIDER, undefined>;

/** Singleton class to create an LLM provider instance. */
export class LLMProvider<TProvider extends ProviderV3> {
    private instance: TProvider | null = null;

    constructor(private readonly createProvider: () => TProvider) {}

    private getInstance(): TProvider {
        if (this.instance == null) this.instance = this.createProvider();

        // biome-ignore lint/style/noNonNullAssertion: This is never null
        return this.instance!;
    }

    public getModel(modelId: Parameters<TProvider["languageModel"]>[0]): LanguageModel {
        return this.getInstance().languageModel(modelId);
    }
}

export const groqProvider = new LLMProvider(() => createGroq({ apiKey: env.GROQ_KEY }));

export const googleProvider = new LLMProvider(() => createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY }));

export const openRouterProvider = new LLMProvider(() => createOpenRouter({ apiKey: env.OPENROUTER_API_KEY }));

// Anthropic (Claude). Lazily instantiated — the API key is only read on first use
// of a Claude model entry, so ANTHROPIC_API_KEY can stay unset otherwise.
export const anthropicProvider = new LLMProvider(() => createAnthropic({ apiKey: env.ANTHROPIC_API_KEY }));
