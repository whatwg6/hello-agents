import "dotenv/config";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { pathToFileURL } from "node:url";

export type ChatMessage = ChatCompletionMessageParam;

interface HelloAgentsLLMOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}

export class HelloAgentsLLM {
  private readonly model: string;
  private readonly client: OpenAI;

  constructor(options: HelloAgentsLLMOptions = {}) {
    this.model = options.model ?? process.env.LLM_MODEL_ID ?? "";
    const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
    const baseURL = options.baseUrl ?? process.env.LLM_BASE_URL;
    const timeout = (options.timeout ?? Number(process.env.LLM_TIMEOUT ?? 60)) * 1000;

    if (!this.model || !apiKey || !baseURL) {
      throw new Error("模型ID、API密钥和服务地址必须被提供或在.env文件中定义。");
    }

    this.client = new OpenAI({ apiKey, baseURL, timeout });
  }

  async think(messages: ChatMessage[], temperature = 0): Promise<string | null> {
    console.log(`🧠 正在调用 ${this.model} 模型...`);

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature,
        stream: true,
      });

      console.log("✅ 大语言模型响应成功:");
      const collectedContent: string[] = [];

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? "";
        process.stdout.write(content);
        collectedContent.push(content);
      }

      console.log();
      return collectedContent.join("");
    } catch (error) {
      console.log(`❌ 调用LLM API时发生错误: ${formatError(error)}`);
      return null;
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const llmClient = new HelloAgentsLLM();
  const exampleMessages: ChatMessage[] = [
    { role: "system", content: "You are a helpful assistant that writes Python code." },
    { role: "user", content: "写一个快速排序算法" },
  ];

  console.log("--- 调用LLM ---");
  const responseText = await llmClient.think(exampleMessages);
  if (responseText) {
    console.log("\n\n--- 完整模型响应 ---");
    console.log(responseText);
  }
}

const currentFileUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === currentFileUrl) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
