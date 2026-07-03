import { pathToFileURL } from "node:url";

import { type ChatMessage, HelloAgentsLLM } from "./llm_client.js";

const PLANNER_PROMPT_TEMPLATE = `
你是一个顶级的AI规划专家。你的任务是将用户提出的复杂问题分解成一个由多个简单步骤组成的行动计划。
请确保计划中的每个步骤都是一个独立的、可执行的子任务，并且严格按照逻辑顺序排列。
你的输出必须是一个JSON数组，其中每个元素都是一个描述子任务的字符串。

问题: {question}

请严格按照以下格式输出你的计划，\`\`\`json与\`\`\`作为前后缀是必要的:
\`\`\`json
["步骤1", "步骤2", "步骤3"]
\`\`\`
`;

const EXECUTOR_PROMPT_TEMPLATE = `
你是一位顶级的AI执行专家。你的任务是严格按照给定的计划，一步步地解决问题。
你将收到原始问题、完整的计划、以及到目前为止已经完成的步骤和结果。
请你专注于解决“当前步骤”，并仅输出该步骤的最终答案，不要输出任何额外的解释或对话。

# 原始问题:
{question}

# 完整计划:
{plan}

# 历史步骤与结果:
{history}

# 当前步骤:
{currentStep}

请仅输出针对“当前步骤”的回答:
`;

export class Planner {
  constructor(private readonly llmClient: HelloAgentsLLM) {}

  async plan(question: string): Promise<string[]> {
    const prompt = formatTemplate(PLANNER_PROMPT_TEMPLATE, { question });
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];

    console.log("--- 正在生成计划 ---");
    const responseText = (await this.llmClient.think(messages)) ?? "";
    console.log(`✅ 计划已生成:\n${responseText}`);

    try {
      return parsePlan(responseText);
    } catch (error) {
      console.log(`❌ 解析计划时出错: ${formatError(error)}`);
      console.log(`原始响应: ${responseText}`);
      return [];
    }
  }
}

export class Executor {
  constructor(private readonly llmClient: HelloAgentsLLM) {}

  async execute(question: string, plan: string[]): Promise<string> {
    let history = "";
    let finalAnswer = "";

    console.log("\n--- 正在执行计划 ---");
    for (const [index, step] of plan.entries()) {
      const stepNumber = index + 1;
      console.log(`\n-> 正在执行步骤 ${stepNumber}/${plan.length}: ${step}`);

      const prompt = formatTemplate(EXECUTOR_PROMPT_TEMPLATE, {
        question,
        plan: JSON.stringify(plan, null, 2),
        history: history || "无",
        currentStep: step,
      });
      const messages: ChatMessage[] = [{ role: "user", content: prompt }];
      const responseText = (await this.llmClient.think(messages)) ?? "";

      history += `步骤 ${stepNumber}: ${step}\n结果: ${responseText}\n\n`;
      finalAnswer = responseText;
      console.log(`✅ 步骤 ${stepNumber} 已完成，结果: ${finalAnswer}`);
    }

    return finalAnswer;
  }
}

export class PlanAndSolveAgent {
  private readonly planner: Planner;
  private readonly executor: Executor;

  constructor(private readonly llmClient: HelloAgentsLLM) {
    this.planner = new Planner(this.llmClient);
    this.executor = new Executor(this.llmClient);
  }

  async run(question: string): Promise<string | null> {
    console.log(`\n--- 开始处理问题 ---\n问题: ${question}`);
    const plan = await this.planner.plan(question);
    if (plan.length === 0) {
      console.log("\n--- 任务终止 --- \n无法生成有效的行动计划。");
      return null;
    }

    const finalAnswer = await this.executor.execute(question, plan);
    console.log(`\n--- 任务完成 ---\n最终答案: ${finalAnswer}`);
    return finalAnswer;
  }
}

function parsePlan(responseText: string): string[] {
  const fencedJson = responseText.match(/```(?:json|python)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const planText = fencedJson ?? responseText.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(planText);
  } catch {
    parsed = parsePythonStyleStringList(planText);
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("计划不是字符串数组。");
  }

  return parsed;
}

function parsePythonStyleStringList(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error("未找到列表格式的计划。");
  }

  const results: string[] = [];
  const stringLiteralPattern = /(["'])((?:\\.|(?!\1)[\s\S])*)\1/g;
  for (const match of trimmed.matchAll(stringLiteralPattern)) {
    results.push(unescapeStringLiteral(match[2] ?? ""));
  }

  if (results.length === 0) {
    throw new Error("计划列表为空或无法解析字符串元素。");
  }

  return results;
}

function unescapeStringLiteral(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\(["'\\])/g, "$1");
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
  const llmClient = new HelloAgentsLLM();
  const agent = new PlanAndSolveAgent(llmClient);
  const question =
    "一个水果店周一卖出了15个苹果。周二卖出的苹果数量是周一的两倍。周三卖出的数量比周二少了5个。请问这三天总共卖出了多少个苹果？";

  await agent.run(question);
}

const currentFileUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === currentFileUrl) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
