import { editReply } from '../discord.js';
import { revokeRefreshToken } from '../sign-in-with-appwrite.js';

/**
 * /stackbot disconnect
 *
 * Revokes the grant in Appwrite and deletes the stored tokens. The row is
 * deleted even when the revocation fails.
 */
export async function disconnect(job, { connections }) {
  const connection = await connections.get(job.discordUserId);
  if (connection) {
    try {
      await revokeRefreshToken(connection.refreshToken);
    } finally {
      await connections.remove(job.discordUserId);
    }
  }

  await editReply(job, { content: 'Disconnected. Stackbot no longer has access to your Appwrite projects.' });
}
