import { pathToFileURL } from "node:url";

import { type ChatMessage, HelloAgentsLLM } from "./llm_client.js";
import { search, ToolExecutor } from "./tools.js";

const REACT_PROMPT_TEMPLATE = `
请注意，你是一个有能力调用外部工具的智能助手。

可用工具如下：
{tools}

请严格按照以下格式进行回应：

Thought: 你的思考过程，用于分析问题、拆解任务和规划下一步行动。
Action: 你决定采取的行动，必须是以下格式之一：
- \`{{tool_name}}[{{tool_input}}]\`：调用一个可用工具。
- \`Finish[最终答案]\`：当你认为已经获得最终答案时。
- 当你收集到足够的信息，能够回答用户的最终问题时，你必须在\`Action:\`字段后使用 \`Finish[最终答案]\` 来输出最终答案。


现在，请开始解决以下问题：
Question: {question}
History: {history}
`;

type ParsedOutput = {
  thought: string | null;
  action: string | null;
};

type ParsedAction = {
  toolName: string | null;
  toolInput: string | null;
};

export class ReActAgent {
  private history: string[] = [];

  constructor(
    private readonly llmClient: HelloAgentsLLM,
    private readonly toolExecutor: ToolExecutor,
    private readonly maxSteps = 5,
  ) {}

  async run(question: string): Promise<string | null> {
    this.history = [];

    for (let currentStep = 1; currentStep <= this.maxSteps; currentStep += 1) {
      console.log(`\n--- 第 ${currentStep} 步 ---`);

      const toolsDescription = this.toolExecutor.getAvailableTools();
      const historyText = this.history.join("\n");
      const prompt = formatTemplate(REACT_PROMPT_TEMPLATE, {
        tools: toolsDescription,
        question,
        history: historyText,
      });

      const messages: ChatMessage[] = [{ role: "user", content: prompt }];
      const responseText = await this.llmClient.think(messages);
      if (!responseText) {
        console.log("错误：LLM未能返回有效响应。");
        break;
      }

      const { thought, action } = this.parseOutput(responseText);
      if (thought) {
        console.log(`🤔 思考: ${thought}`);
      }
      if (!action) {
        console.log("警告：未能解析出有效的Action，流程终止。");
        break;
      }

      if (action.startsWith("Finish")) {
        const finalAnswer = this.parseActionInput(action);
        console.log(`🎉 最终答案: ${finalAnswer}`);
        return finalAnswer;
      }

      const { toolName, toolInput } = this.parseAction(action);
      if (!toolName || !toolInput) {
        this.history.push("Observation: 无效的Action格式，请检查。");
        continue;
      }

      console.log(`🎬 行动: ${toolName}[${toolInput}]`);
      const toolFunction = this.toolExecutor.getTool(toolName);
      const observation = toolFunction
        ? await toolFunction(toolInput)
        : `错误：未找到名为 '${toolName}' 的工具。`;

      console.log(`👀 观察: ${observation}`);
      this.history.push(`Action: ${action}`);
      this.history.push(`Observation: ${observation}`);
    }

    console.log("已达到最大步数，流程终止。");
    return null;
  }

  private parseOutput(text: string): ParsedOutput {
    const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?=\nAction:|$)/);
    const actionMatch = text.match(/Action:\s*([\s\S]*?)$/);

    return {
      thought: thoughtMatch?.[1]?.trim() ?? null,
      action: actionMatch?.[1]?.trim() ?? null,
    };
  }

  private parseAction(actionText: string): ParsedAction {
    const match = actionText.match(/^(\w+)\[([\s\S]*)\]$/);
    return {
      toolName: match?.[1] ?? null,
      toolInput: match?.[2] ?? null,
    };
  }

  private parseActionInput(actionText: string): string {
    const match = actionText.match(/^\w+\[([\s\S]*)\]$/);
    return match?.[1] ?? "";
  }
}

function formatTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    return Object.hasOwn(values, key) ? values[key] : placeholder;
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const llm = new HelloAgentsLLM();
  const toolExecutor = new ToolExecutor();
  const searchDescription =
    "一个网页搜索引擎。当你需要回答关于时事、事实以及在你的知识库中找不到的信息时，应使用此工具。";

  toolExecutor.registerTool("Search", searchDescription, search);

  const agent = new ReActAgent(llm, toolExecutor);
  const question = "华为最新的手机是哪一款？它的主要卖点是什么？";
  await agent.run(question);
}

const currentFileUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === currentFileUrl) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
