import OpenAI from 'openai';
import { TOOL_DEFINITIONS } from './project-tools.js';

const MAX_TOOL_ROUNDS = 8;
const NO_ANSWER = 'Stackbot could not find an answer to that. Try naming the project or the site.';

/**
 * Builds the system prompt on every question, so a warm runtime never gives
 * the model yesterday's date.
 */
function systemPrompt() {
  return `You are Stackbot, a Discord bot that answers questions about the user's Appwrite projects.
Use the tools to look up facts. Never guess project names, IDs, statuses, or numbers.
When the question does not name a project, call list_projects first and search the likely ones.
When a deployment failed, read its build logs and explain the cause and the fix in plain words.
Answer in Discord markdown in under 1500 characters. Quote at most five log lines.
Today is ${new Date().toISOString().slice(0, 10)}.`;
}

/**
 * OpenRouter speaks the OpenAI Chat Completions API, so the OpenAI SDK works
 * with a different base URL.
 */
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * Runs the tool loop: the model asks for tools, Stackbot runs them against
 * the user's projects, and the results go back to the model until it
 * answers in text.
 */
export async function answerQuestion(question, runTool) {
  const messages = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: question },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await openrouter.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-6-luna',
      messages,
      tools: TOOL_DEFINITIONS,
    });

    const message = completion.choices[0].message;
    if (!message.tool_calls?.length) return message.content?.trim() || NO_ANSWER;

    messages.push(message);
    for (const call of message.tool_calls) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await runTool(call.function.name, call.function.arguments),
      });
    }
  }

  return 'That question needed more lookups than Stackbot allows in one answer. Try asking about one project or one site.';
}
