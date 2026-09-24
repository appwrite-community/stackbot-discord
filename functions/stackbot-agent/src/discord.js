import { ButtonStyleTypes, MessageComponentTypes } from 'discord-interactions';

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Replaces the "Stackbot is thinking..." placeholder with the final reply.
 * The interaction token authorizes the call, so no bot token is needed. It
 * stays valid for 15 minutes after the user runs the command.
 */
export async function editReply(job, { content, components = [] }) {
  const url = `${DISCORD_API}/webhooks/${job.applicationId}/${job.interactionToken}/messages/@original`;
  const request = {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: truncate(content),
      components,
      allowed_mentions: { parse: [] },
    }),
  };

  let response = await fetch(url, request);
  if (response.status === 404) {
    // A fast execution can arrive before Discord has stored the deferred reply.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    response = await fetch(url, request);
  }

  if (!response.ok) {
    throw new Error(`Discord rejected the reply: ${response.status} ${await response.text()}`);
  }
}

/**
 * Builds a row with one link button, used to send the user to the Appwrite
 * device verification page.
 */
export function linkButton(label, url) {
  return {
    type: MessageComponentTypes.ACTION_ROW,
    components: [
      {
        type: MessageComponentTypes.BUTTON,
        style: ButtonStyleTypes.LINK,
        label,
        url,
      },
    ],
  };
}

/**
 * Discord rejects messages longer than 2,000 characters.
 */
function truncate(text) {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}
