import { Client, TablesDB } from 'node-appwrite';
import { oauthErrorCode, refreshTokens } from './sign-in-with-appwrite.js';

const TABLE_ID = 'connections';
const REFRESH_MARGIN_MS = 60 * 1000;

export class NotConnectedError extends Error {}

/**
 * The connections table stores one row per Discord user, keyed by the
 * Discord user ID. Both token columns are encrypted at rest.
 */
export function connectionsTable(req) {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key']);
  const tablesDB = new TablesDB(client);
  const table = { databaseId: process.env.DATABASE_ID, tableId: TABLE_ID };

  return {
    async get(discordUserId) {
      try {
        return await tablesDB.getRow({ ...table, rowId: discordUserId });
      } catch (err) {
        if (err.code === 404) return null;
        throw err;
      }
    },

    async save(discordUserId, tokens) {
      return tablesDB.upsertRow({
        ...table,
        rowId: discordUserId,
        data: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          refreshLock: 1,
        },
      });
    },

    async remove(discordUserId) {
      await tablesDB.deleteRow({ ...table, rowId: discordUserId });
    },

    /**
     * Takes the refresh lock of one user. Appwrite applies the decrement
     * atomically, so only one execution can take the lock from 1 to 0. For
     * every other execution the value would go below the minimum, and
     * Appwrite rejects the update with a 400 error.
     */
    async lockRefresh(discordUserId) {
      try {
        await tablesDB.decrementRowColumn({
          ...table,
          rowId: discordUserId,
          column: 'refreshLock',
          value: 1,
          min: 0,
        });
        return true;
      } catch (err) {
        if (err.code === 404) throw new NotConnectedError();
        if (err.code === 400) return false;
        throw err;
      }
    },

    async unlockRefresh(discordUserId) {
      try {
        await tablesDB.incrementRowColumn({
          ...table,
          rowId: discordUserId,
          column: 'refreshLock',
          value: 1,
          max: 1,
        });
      } catch (err) {
        // The row is gone or the lock is already free.
        if (err.code !== 404 && err.code !== 400) throw err;
      }
    },
  };
}

/**
 * Returns an access token that is valid for at least another minute,
 * refreshing it when needed.
 *
 * Each refresh token works once. If Appwrite sees the same refresh token
 * twice, it treats the second use as theft and revokes the whole grant. So
 * only the execution that holds the refresh lock refreshes. Every other
 * execution waits for the new tokens to appear in the row.
 */
export async function getAccessToken(connections, discordUserId) {
  const connection = await connections.get(discordUserId);
  if (!connection) throw new NotConnectedError();
  if (isFresh(connection)) return connection.accessToken;

  if (!(await connections.lockRefresh(discordUserId))) {
    return waitForRefresh(connections, discordUserId);
  }

  let locked = true;
  try {
    // Another execution can refresh between the first read and the lock.
    const latest = await connections.get(discordUserId);
    if (!latest) throw new NotConnectedError();
    if (isFresh(latest)) return latest.accessToken;

    const tokens = await refreshTokens(latest.refreshToken);
    // Saving the new tokens also sets refreshLock back to 1.
    await connections.save(discordUserId, tokens);
    locked = false;
    return tokens.access_token;
  } catch (err) {
    if (oauthErrorCode(err) !== 'invalid_grant') throw err;
    // Only this execution used the refresh token, so Appwrite rejected it
    // because the user revoked access.
    await connections.remove(discordUserId);
    locked = false;
    throw new NotConnectedError();
  } finally {
    if (locked) await connections.unlockRefresh(discordUserId);
  }
}

/**
 * Runs when another execution holds the refresh lock. The new tokens show
 * up in the row within a few seconds. If they do not, the other execution
 * stopped before it saved them, and the user connects again with
 * /stackbot connect, which also frees the lock.
 */
async function waitForRefresh(connections, discordUserId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const latest = await connections.get(discordUserId);
    if (!latest) throw new NotConnectedError();
    if (isFresh(latest)) return latest.accessToken;
  }

  throw new NotConnectedError();
}

/**
 * Treats an access token as expired one minute early, so it cannot expire
 * in the middle of a tool call.
 */
function isFresh(connection) {
  return new Date(connection.expiresAt).getTime() - REFRESH_MARGIN_MS > Date.now();
}
