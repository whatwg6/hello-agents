import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGENT_SYSTEM_PROMPT = `
你是一个智能旅行助手。你的任务是分析用户的请求，并使用可用工具一步步地解决问题。

# 可用工具:
- \`get_weather(city: str)\`: 查询指定城市的实时天气。
- \`get_attraction(city: str, weather: str)\`: 根据城市和天气搜索推荐的旅游景点。

# 输出格式要求:
你的每次回复必须严格遵循以下格式，包含一对Thought和Action：

Thought: [你的思考过程和下一步计划]
Action: [你要执行的具体行动]

Action的格式必须是以下之一：
1. 调用工具：function_name(arg_name="arg_value")
2. 结束任务：Finish[最终答案]

# 重要提示:
- 每次只输出一对Thought-Action
- Action必须在同一行，不要换行
- 当收集到足够信息可以回答用户问题时，必须使用 Action: Finish[最终答案] 格式结束

请开始吧！
`;

type ToolArgs = Record<string, string>;
type ToolFunction = (args: ToolArgs) => Promise<string>;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

interface WttrResponse {
  current_condition?: Array<{
    weatherDesc?: Array<{ value?: string }>;
    temp_C?: string;
  }>;
}

interface TavilyResponse {
  answer?: string;
  results?: Array<{
    title?: string;
    content?: string;
  }>;
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

async function getWeather({ city }: ToolArgs): Promise<string> {
  if (!city) {
    return "错误：缺少城市参数 city。";
  }

  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as WttrResponse;
    const currentCondition = data.current_condition?.[0];
    const weatherDesc = currentCondition?.weatherDesc?.[0]?.value;
    const tempC = currentCondition?.temp_C;

    if (!currentCondition || !weatherDesc || tempC === undefined) {
      return "错误：解析天气数据失败，可能是城市名称无效。";
    }

    return `${city}当前天气：${weatherDesc}，气温${tempC}摄氏度`;
  } catch (error) {
    return `错误：查询天气时遇到网络问题 - ${formatError(error)}`;
  }
}

async function getAttraction({ city, weather }: ToolArgs): Promise<string> {
  if (!city || !weather) {
    return "错误：缺少参数 city 或 weather。";
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return "错误：未配置TAVILY_API_KEY。";
  }

  const query = `'${city}' 在'${weather}'天气下最值得去的旅游景点推荐及理由`;

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        include_answer: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as TavilyResponse;
    if (data.answer) {
      return data.answer;
    }

    const formattedResults = (data.results ?? [])
      .filter((result) => result.title || result.content)
      .map((result) => `- ${result.title ?? "无标题"}: ${result.content ?? ""}`);

    if (formattedResults.length === 0) {
      return "抱歉，没有找到相关的旅游景点推荐。";
    }

    return `根据搜索，为您找到以下信息：\n${formattedResults.join("\n")}`;
  } catch (error) {
    return `错误：执行Tavily搜索时出现问题 - ${formatError(error)}`;
  }
}

const availableTools: Record<string, ToolFunction> = {
  get_weather: getWeather,
  get_attraction: getAttraction,
};

class OpenAICompatibleClient {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async generate(prompt: string, systemPrompt: string): Promise<string> {
    console.log("正在调用大语言模型...");

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const answer = data.choices?.[0]?.message?.content;
      if (!answer) {
        throw new Error("响应中没有 choices[0].message.content");
      }

      console.log("大语言模型响应成功。");
      return answer;
    } catch (error) {
      console.log(`调用LLM API时发生错误: ${formatError(error)}`);
      return "错误：调用语言模型服务时出错。";
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请在 .env 或系统环境变量中配置。`);
  }
  return value;
}

function truncateThoughtAction(llmOutput: string): string {
  const match = llmOutput.match(
    /(Thought:.*?Action:.*?)(?=\n\s*(?:Thought:|Action:|Observation:)|\s*$)/s,
  );
  return match ? match[1].trim() : llmOutput;
}

function parseAction(llmOutput: string): string | null {
  const match = llmOutput.match(/Action: (.*)/s);
  return match?.[1]?.trim() ?? null;
}

function parseToolCall(action: string): { toolName: string; kwargs: ToolArgs } | null {
  const toolName = action.match(/(\w+)\(/)?.[1];
  const argsString = action.match(/\((.*)\)/s)?.[1];

  if (!toolName || argsString === undefined) {
    return null;
  }

  const kwargs: ToolArgs = {};
  for (const match of argsString.matchAll(/(\w+)="([^"]*)"/g)) {
    kwargs[match[1]] = match[2];
  }

  return { toolName, kwargs };
}

async function main(): Promise<void> {
  loadDotenv();

  const llm = new OpenAICompatibleClient(
    requireEnv("MODEL_ID"),
    requireEnv("API_KEY"),
    requireEnv("BASE_URL"),
  );

  const userPrompt = "你好，请帮我查询一下今天北京的天气，然后根据天气推荐一个合适的旅游景点。";
  const promptHistory = [`用户请求: ${userPrompt}`];

  console.log(`用户输入: ${userPrompt}\n${"=".repeat(40)}`);

  for (let i = 0; i < 5; i += 1) {
    console.log(`--- 循环 ${i + 1} ---\n`);

    const fullPrompt = promptHistory.join("\n");
    let llmOutput = await llm.generate(fullPrompt, AGENT_SYSTEM_PROMPT);

    const truncated = truncateThoughtAction(llmOutput);
    if (truncated !== llmOutput.trim()) {
      llmOutput = truncated;
      console.log("已截断多余的 Thought-Action 对");
    }

    console.log(`模型输出:\n${llmOutput}\n`);
    promptHistory.push(llmOutput);

    const action = parseAction(llmOutput);
    if (!action) {
      const observation =
        "错误: 未能解析到 Action 字段。请确保你的回复严格遵循 'Thought: ... Action: ...' 的格式。";
      const observationString = `Observation: ${observation}`;
      console.log(`${observationString}\n${"=".repeat(40)}`);
      promptHistory.push(observationString);
      continue;
    }

    if (action.startsWith("Finish")) {
      const finalAnswer = action.match(/Finish\[(.*)\]/s)?.[1] ?? "";
      console.log(`任务完成，最终答案: ${finalAnswer}`);
      break;
    }

    const toolCall = parseToolCall(action);
    let observation: string;

    if (!toolCall) {
      observation = `错误：无法解析工具调用 '${action}'`;
    } else if (toolCall.toolName in availableTools) {
      observation = await availableTools[toolCall.toolName](toolCall.kwargs);
    } else {
      observation = `错误：未定义的工具 '${toolCall.toolName}'`;
    }

    const observationString = `Observation: ${observation}`;
    console.log(`${observationString}\n${"=".repeat(40)}`);
    promptHistory.push(observationString);
  }
}

main().catch((error) => {
  console.error(`程序异常退出: ${formatError(error)}`);
  process.exitCode = 1;
});
