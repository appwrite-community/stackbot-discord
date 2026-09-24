import { answerQuestion } from '../agent.js';
import { getAccessToken } from '../connections.js';
import { editReply } from '../discord.js';
import { createToolRunner } from '../project-tools.js';
import { listGrantedProjects } from '../sign-in-with-appwrite.js';

/**
 * /stackbot ask and the "Ask Stackbot" message command
 *
 * Answers a question with the model, which calls tools that read the user's
 * granted projects with the user's own access token.
 */
export async function ask(job, { connections }) {
  const accessToken = await getAccessToken(connections, job.discordUserId);
  const projects = await listGrantedProjects(accessToken);

  const answer = await answerQuestion(job.question, createToolRunner(accessToken, projects));

  await editReply(job, { content: answer });
}
