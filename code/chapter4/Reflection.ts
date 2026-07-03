import { pathToFileURL } from "node:url";

import { type ChatMessage, HelloAgentsLLM } from "./llm_client.js";

type MemoryRecordType = "execution" | "reflection";

type MemoryRecord = {
  type: MemoryRecordType;
  content: string;
};

export class Memory {
  private readonly records: MemoryRecord[] = [];

  addRecord(recordType: MemoryRecordType, content: string): void {
    this.records.push({ type: recordType, content });
    console.log(`📝 记忆已更新，新增一条 '${recordType}' 记录。`);
  }

  getTrajectory(): string {
    const trajectory = this.records.map((record) => {
      if (record.type === "execution") {
        return `--- 上一轮尝试 (代码) ---\n${record.content}\n`;
      }

      return `--- 评审员反馈 ---\n${record.content}\n`;
    });

    return trajectory.join("\n").trim();
  }

  getLastExecution(): string | null {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index];
      if (record?.type === "execution") {
        return record.content;
      }
    }

    return null;
  }
}

const INITIAL_PROMPT_TEMPLATE = `
你是一位资深的Python程序员。请根据以下要求，编写一个Python函数。
你的代码必须包含完整的函数签名、文档字符串，并遵循PEP 8编码规范。

要求: {task}

请直接输出代码，不要包含任何额外的解释。
`;

const REFLECT_PROMPT_TEMPLATE = `
你是一位极其严格的代码评审专家和资深算法工程师，对代码的性能有极致的要求。
你的任务是审查以下Python代码，并专注于找出其在**算法效率**上的主要瓶颈。

# 原始任务:
{task}

# 待审查的代码:
\`\`\`python
{code}
\`\`\`

请分析该代码的时间复杂度，并思考是否存在一种**算法上更优**的解决方案来显著提升性能。
如果存在，请清晰地指出当前算法的不足，并提出具体的、可行的改进算法建议（例如，使用筛法替代试除法）。
如果代码在算法层面已经达到最优，才能回答“无需改进”。

请直接输出你的反馈，不要包含任何额外的解释。
`;

const REFINE_PROMPT_TEMPLATE = `
你是一位资深的Python程序员。你正在根据一位代码评审专家的反馈来优化你的代码。

# 原始任务:
{task}

# 你上一轮尝试的代码:
{lastCodeAttempt}

# 评审员的反馈:
{feedback}

请根据评审员的反馈，生成一个优化后的新版本代码。
你的代码必须包含完整的函数签名、文档字符串，并遵循PEP 8编码规范。
请直接输出优化后的代码，不要包含任何额外的解释。
`;

export class ReflectionAgent {
  private readonly memory = new Memory();

  constructor(
    private readonly llmClient: HelloAgentsLLM,
    private readonly maxIterations = 3,
  ) {}

  async run(task: string): Promise<string | null> {
    console.log(`\n--- 开始处理任务 ---\n任务: ${task}`);

    console.log("\n--- 正在进行初始尝试 ---");
    const initialPrompt = formatTemplate(INITIAL_PROMPT_TEMPLATE, { task });
    const initialCode = await this.getLLMResponse(initialPrompt);
    this.memory.addRecord("execution", initialCode);

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      console.log(`\n--- 第 ${iteration}/${this.maxIterations} 轮迭代 ---`);

      console.log("\n-> 正在进行反思...");
      const lastCode = this.memory.getLastExecution() ?? "";
      const reflectPrompt = formatTemplate(REFLECT_PROMPT_TEMPLATE, {
        task,
        code: lastCode,
      });
      const feedback = await this.getLLMResponse(reflectPrompt);
      this.memory.addRecord("reflection", feedback);

      if (isNoImprovementNeeded(feedback)) {
        console.log("\n✅ 反思认为代码已无需改进，任务完成。");
        break;
      }

      console.log("\n-> 正在进行优化...");
      const refinePrompt = formatTemplate(REFINE_PROMPT_TEMPLATE, {
        task,
        lastCodeAttempt: lastCode,
        feedback,
      });
      const refinedCode = await this.getLLMResponse(refinePrompt);
      this.memory.addRecord("execution", refinedCode);
    }

    const finalCode = this.memory.getLastExecution();
    console.log(`\n--- 任务完成 ---\n最终生成的代码:\n${finalCode ?? ""}`);
    return finalCode;
  }

  private async getLLMResponse(prompt: string): Promise<string> {
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    return (await this.llmClient.think(messages)) ?? "";
  }
}

function isNoImprovementNeeded(feedback: string): boolean {
  const normalizedFeedback = feedback.toLowerCase();
  return feedback.includes("无需改进") || normalizedFeedback.includes("no need for improvement");
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
  const agent = new ReflectionAgent(llmClient, 2);
  const task = "编写一个Python函数，找出1到n之间所有的素数 (prime numbers)。";

  await agent.run(task);
}

const currentFileUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === currentFileUrl) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
