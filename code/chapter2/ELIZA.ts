import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

type RandomSource = () => number;

interface Rule {
  pattern: RegExp;
  responses: string[];
}

const rules: Rule[] = [
  {
    pattern: /I need (.*)/i,
    responses: [
      "Why do you need {0}?",
      "Would it really help you to get {0}?",
      "Are you sure you need {0}?",
    ],
  },
  {
    pattern: /Why don't you (.*)\?/i,
    responses: [
      "Do you really think I don't {0}?",
      "Perhaps eventually I will {0}.",
      "Do you really want me to {0}?",
    ],
  },
  {
    pattern: /Why can't I (.*)\?/i,
    responses: [
      "Do you think you should be able to {0}?",
      "If you could {0}, what would you do?",
      "I don't know -- why can't you {0}?",
    ],
  },
  {
    pattern: /I am (.*)/i,
    responses: [
      "Did you come to me because you are {0}?",
      "How long have you been {0}?",
      "How do you feel about being {0}?",
    ],
  },
  {
    pattern: /.* mother .*/i,
    responses: [
      "Tell me more about your mother.",
      "What was your relationship with your mother like?",
      "How do you feel about your mother?",
    ],
  },
  {
    pattern: /.* father .*/i,
    responses: [
      "Tell me more about your father.",
      "How did your father make you feel?",
      "What has your father taught you?",
    ],
  },
  {
    pattern: /.*/i,
    responses: [
      "Please tell me more.",
      "Let's change focus a bit... Tell me about your family.",
      "Can you elaborate on that?",
    ],
  },
];

const pronounSwap: Record<string, string> = {
  i: "you",
  you: "i",
  me: "you",
  my: "your",
  am: "are",
  are: "am",
  was: "were",
  "i'd": "you would",
  "i've": "you have",
  "i'll": "you will",
  yours: "mine",
  mine: "yours",
};

export function swapPronouns(phrase: string): string {
  return phrase
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => pronounSwap[word] ?? word)
    .join(" ");
}

export function respond(userInput: string, randomSource: RandomSource = Math.random): string {
  for (const rule of rules) {
    const match = rule.pattern.exec(userInput);
    if (!match) {
      continue;
    }

    const capturedGroup = match[1] ?? "";
    const swappedGroup = swapPronouns(capturedGroup);
    const response = chooseResponse(rule.responses, randomSource);
    return response.replaceAll("{0}", swappedGroup);
  }

  return chooseResponse(rules.at(-1)?.responses ?? ["Please tell me more."], randomSource);
}

function chooseResponse(responses: string[], randomSource: RandomSource): string {
  const index = Math.min(Math.floor(randomSource() * responses.length), responses.length - 1);
  return responses[index] ?? responses[0] ?? "";
}

async function main(): Promise<void> {
  console.log("Therapist: Hello! How can I help you today?");

  const readline = createInterface({ input, output });
  try {
    while (true) {
      const userInput = await readline.question("You: ");
      if (["quit", "exit", "bye"].includes(userInput.toLowerCase())) {
        console.log("Therapist: Goodbye. It was nice talking to you.");
        break;
      }

      console.log(`Therapist: ${respond(userInput)}`);
    }
  } finally {
    readline.close();
  }
}

const currentFileUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === currentFileUrl) {
  await main();
}
