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
        },
      });
    },

    async remove(discordUserId) {
      await tablesDB.deleteRow({ ...table, rowId: discordUserId });
    },
  };
}

/**
 * Returns an access token that is valid for at least another minute,
 * refreshing it when needed.
 *
 * Refresh tokens rotate, so when two commands run at once, both can try to
 * refresh and only the first one succeeds. The second one sees that the
 * stored refresh token changed and uses the tokens the first one saved.
 */
export async function getAccessToken(connections, discordUserId) {
  const connection = await connections.get(discordUserId);
  if (!connection) throw new NotConnectedError();
  if (isFresh(connection)) return connection.accessToken;

  try {
    const tokens = await refreshTokens(connection.refreshToken);
    await connections.save(discordUserId, tokens);
    return tokens.access_token;
  } catch (err) {
    if (oauthErrorCode(err) !== 'invalid_grant') throw err;
    return recoverFromRejectedRefresh(connections, discordUserId, connection.refreshToken);
  }
}

/**
 * Runs when Appwrite rejects a refresh token. If another execution rotated
 * the token, its new tokens show up in the row within a few seconds. If the
 * token never changes, the user revoked the grant, so the row is deleted.
 */
async function recoverFromRejectedRefresh(connections, discordUserId, rejectedRefreshToken) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await connections.get(discordUserId);
    if (!latest) throw new NotConnectedError();
    if (latest.refreshToken !== rejectedRefreshToken) return latest.accessToken;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await connections.remove(discordUserId);
  throw new NotConnectedError();
}

/**
 * Treats an access token as expired one minute early, so it cannot expire
 * in the middle of a tool call.
 */
function isFresh(connection) {
  return new Date(connection.expiresAt).getTime() - REFRESH_MARGIN_MS > Date.now();
}
