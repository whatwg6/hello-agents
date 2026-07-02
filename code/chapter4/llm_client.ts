import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type MessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
}

interface HelloAgentsLLMOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}

loadDotenv();

export class HelloAgentsLLM {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: HelloAgentsLLMOptions = {}) {
    this.model = options.model ?? process.env.LLM_MODEL_ID ?? "";
    this.apiKey = options.apiKey ?? process.env.LLM_API_KEY ?? "";
    this.baseUrl = options.baseUrl ?? process.env.LLM_BASE_URL ?? "";
    this.timeout = options.timeout ?? Number(process.env.LLM_TIMEOUT ?? 60);

    if (!this.model || !this.apiKey || !this.baseUrl) {
      throw new Error("模型ID、API密钥和服务地址必须被提供或在.env文件中定义。");
    }
  }

  async think(messages: ChatMessage[], temperature = 0): Promise<string | null> {
    console.log(`🧠 正在调用 ${this.model} 模型...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1000);

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      if (!response.body) {
        throw new Error("响应中没有可读取的流式 body。");
      }

      console.log("✅ 大语言模型响应成功:");
      const collectedContent: string[] = [];

      for await (const chunk of streamChatCompletionChunks(response.body)) {
        const content = chunk.choices?.[0]?.delta?.content ?? "";
        process.stdout.write(content);
        collectedContent.push(content);
      }

      console.log();
      return collectedContent.join("");
    } catch (error) {
      console.log(`❌ 调用LLM API时发生错误: ${formatError(error)}`);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

async function* streamChatCompletionChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatCompletionChunk> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const chunk = parseServerSentEventLine(line);
        if (chunk) {
          yield chunk;
        }
      }
    }

    buffer += decoder.decode();
    const chunk = parseServerSentEventLine(buffer);
    if (chunk) {
      yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseServerSentEventLine(line: string): ChatCompletionChunk | null {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("data:")) {
    return null;
  }

  const payload = trimmedLine.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") {
    return null;
  }

  return JSON.parse(payload) as ChatCompletionChunk;
}

function loadDotenv(filePath = resolve(process.cwd(), ".env")): void {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "请求超时";
  }
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
