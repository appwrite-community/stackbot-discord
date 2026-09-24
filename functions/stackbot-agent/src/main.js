import { ask } from './commands/ask.js';
import { connect } from './commands/connect.js';
import { disconnect } from './commands/disconnect.js';
import { connectionsTable, NotConnectedError } from './connections.js';
import { editReply } from './discord.js';

const COMMANDS = { connect, ask, disconnect };

/**
 * Replaces the placeholder with a short error. If Discord rejects this edit
 * too, for example because the interaction token expired, the failure goes
 * to the function logs.
 */
async function reportError(job, content, error) {
  try {
    await editReply(job, { content });
  } catch (err) {
    error(err.stack ?? String(err));
  }
}

/**
 * Runs one command that the discord-interactions function queued. Discord
 * already shows "Stackbot is thinking...", so every path ends by editing that
 * reply, including the error paths.
 */
export default async ({ req, res, error }) => {
  const job = req.bodyJson;
  const command = COMMANDS[job.command];
  const context = { connections: connectionsTable(req) };

  try {
    if (!command) throw new Error(`Unknown command: ${job.command}`);
    await command(job, context);
  } catch (err) {
    if (err instanceof NotConnectedError) {
      await reportError(job, 'Connect your Appwrite account first with `/stackbot connect`.', error);
    } else {
      error(err.stack ?? String(err));
      await reportError(job, 'Something went wrong while answering. Check the function logs in Appwrite.', error);
    }
  }

  return res.empty();
};
