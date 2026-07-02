import "dotenv/config";
import { pathToFileURL } from "node:url";

type ToolFunction = (input: string) => string | Promise<string>;

interface ToolInfo {
  description: string;
  func: ToolFunction;
}

interface SerpApiOrganicResult {
  title?: string;
  snippet?: string;
}

interface SerpApiResponse {
  answer_box_list?: string[];
  answer_box?: {
    answer?: string;
  };
  knowledge_graph?: {
    description?: string;
  };
  organic_results?: SerpApiOrganicResult[];
}

export async function search(query: string): Promise<string> {
  console.log(`🔍 正在执行 [SerpApi] 网页搜索: ${query}`);

  try {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      return "错误：SERPAPI_API_KEY 未在 .env 文件中配置。";
    }

    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: apiKey,
      gl: "cn",
      hl: "zh-cn",
    });

    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const results = (await response.json()) as SerpApiResponse;

    if (results.answer_box_list?.length) {
      return results.answer_box_list.join("\n");
    }
    if (results.answer_box?.answer) {
      return results.answer_box.answer;
    }
    if (results.knowledge_graph?.description) {
      return results.knowledge_graph.description;
    }
    if (results.organic_results?.length) {
      const snippets = results.organic_results.slice(0, 3).map((result, index) => {
        return `[${index + 1}] ${result.title ?? ""}\n${result.snippet ?? ""}`;
      });
      return snippets.join("\n\n");
    }

    return `对不起，没有找到关于 '${query}' 的信息。`;
  } catch (error) {
    return `搜索时发生错误: ${formatError(error)}`;
  }
}

export class ToolExecutor {
  private readonly tools: Record<string, ToolInfo> = {};

  registerTool(name: string, description: string, func: ToolFunction): void {
    if (name in this.tools) {
      console.log(`警告：工具 '${name}' 已存在，将被覆盖。`);
    }

    this.tools[name] = { description, func };
    console.log(`工具 '${name}' 已注册。`);
  }

  getTool(name: string): ToolFunction | undefined {
    return this.tools[name]?.func;
  }

  getAvailableTools(): string {
    return Object.entries(this.tools)
      .map(([toolName, toolInfo]) => `- ${toolName}: ${toolInfo.description}`)
      .join("\n");
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const toolExecutor = new ToolExecutor();

  const searchDescription =
    "一个网页搜索引擎。当你需要回答关于时事、事实以及在你的知识库中找不到的信息时，应使用此工具。";
  toolExecutor.registerTool("Search", searchDescription, search);

  console.log("\n--- 可用的工具 ---");
  console.log(toolExecutor.getAvailableTools());

  console.log("\n--- 执行 Action: Search['英伟达最新的GPU型号是什么'] ---");
  const toolName = "Search";
  const toolInput = "英伟达最新的GPU型号是什么";

  const toolFunction = toolExecutor.getTool(toolName);
  if (toolFunction) {
    const observation = await toolFunction(toolInput);
    console.log("--- 观察 (Observation) ---");
    console.log(observation);
  } else {
    console.log(`错误：未找到名为 '${toolName}' 的工具。`);
  }
}

const currentFileUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === currentFileUrl) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
