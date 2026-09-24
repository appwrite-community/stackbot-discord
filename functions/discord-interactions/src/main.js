import { Client, Functions } from 'node-appwrite';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';

/**
 * Checks that Discord signed the request. Discord sends an Ed25519 signature
 * over the timestamp and the raw body, and removes the endpoint URL if it
 * accepts a request with an invalid signature.
 */
async function isSignedByDiscord(req) {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  if (!signature || !timestamp) return false;

  return verifyKey(req.bodyBinary, signature, timestamp, process.env.DISCORD_PUBLIC_KEY);
}

/**
 * Reads the text of the message a user right-clicked for "Ask Stackbot".
 * Messages without text content fall back to their embed text.
 */
function messageText(message) {
  const embedText = message.embeds.flatMap((embed) => [embed.title, embed.description]);
  return [message.content, ...embedText].filter(Boolean).join('\n');
}

/**
 * Reduces an interaction to the fields the agent function needs. Slash
 * commands carry a subcommand and options. The "Ask Stackbot" message
 * command carries the message that the user right-clicked.
 */
function toJob(interaction) {
  const job = {
    applicationId: interaction.application_id,
    interactionToken: interaction.token,
    discordUserId: interaction.member?.user.id ?? interaction.user.id,
  };

  const { data } = interaction;
  if (data.name === 'Ask Stackbot') {
    const message = data.resolved.messages[data.target_id];
    return { ...job, command: 'ask', question: messageText(message) };
  }

  const subcommand = data.options[0];
  const question = subcommand.options?.find((option) => option.name === 'question')?.value;
  return { ...job, command: subcommand.name, question };
}

/**
 * Queues the agent function. The call returns as soon as Appwrite accepts
 * the execution, so it does not wait for the model.
 */
async function startAgent(req, job) {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key']);

  await new Functions(client).createExecution({
    functionId: process.env.AGENT_FUNCTION_ID,
    body: JSON.stringify(job),
    async: true,
  });
}

/**
 * An ephemeral reply that only the user who ran the command can see.
 */
function ephemeralReply(type, content) {
  return { type, data: { content, flags: InteractionResponseFlags.EPHEMERAL } };
}

/**
 * Answers Discord within three seconds: PONG for the endpoint check, and a
 * deferred reply for every command while the agent function works.
 */
export default async ({ req, res, error }) => {
  if (!(await isSignedByDiscord(req))) {
    return res.text('Invalid request signature', 401);
  }

  const interaction = req.bodyJson;

  if (interaction.type === InteractionType.PING) {
    return res.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
    return res.text('Unsupported interaction type', 400);
  }

  const job = toJob(interaction);
  if (job.command === 'ask' && !job.question) {
    return res.json(
      ephemeralReply(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, 'That message has no text Stackbot can read.'),
    );
  }

  try {
    await startAgent(req, job);
  } catch (err) {
    error(err.stack ?? String(err));
    return res.json(
      ephemeralReply(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, 'Stackbot could not start. Try again in a moment.'),
    );
  }

  return res.json(ephemeralReply(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE));
};
