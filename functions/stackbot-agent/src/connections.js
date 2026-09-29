import { AppwriteException, Client, TablesDB } from 'node-appwrite';
import { oauthErrorCode, refreshTokens } from './sign-in-with-appwrite.js';

const TABLE_ID = 'connections';
const REFRESH_MARGIN_MS = 60 * 1000;
// A claim on a refresh lasts 30 seconds, and the refresh request is aborted
// after 10. An aborted refresh never saves tokens, so when a claim is older
// than 30 seconds, its refresh is over and another execution can claim it.
const REFRESH_LEASE_MS = 30 * 1000;
const REFRESH_TIMEOUT_MS = 10 * 1000;

export class NotConnectedError extends Error {}

/**
 * The connections table stores one row per Discord user, keyed by the
 * Discord user ID. Both token columns are encrypted at rest.
 */
export function connectionsTable(req) {
  const createTablesDB = (headers = {}) => {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(req.headers['x-appwrite-key']);
    for (const [name, value] of Object.entries(headers)) client.addHeader(name, value);
    return new TablesDB(client);
  };
  const tablesDB = createTablesDB();
  const table = { databaseId: process.env.DATABASE_ID, tableId: TABLE_ID };

  /**
   * Runs a write that only applies if the row did not change after it was
   * read. Otherwise Appwrite rejects the write with a 409 error, and the
   * function returns false.
   */
  const ifUnchanged = async (row, write) => {
    try {
      return await write(createTablesDB({ 'X-Appwrite-Timestamp': row.$updatedAt }));
    } catch (err) {
      if (err.code === 409 || err.code === 404) return false;
      throw err;
    }
  };

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
        data: { ...tokenColumns(tokens), refreshStartedAt: null },
      });
    },

    async remove(discordUserId) {
      await tablesDB.deleteRow({ ...table, rowId: discordUserId });
    },

    /** Marks the row as refreshing. Returns the updated row, or false. */
    claimRefresh(row) {
      return ifUnchanged(row, (db) =>
        db.updateRow({ ...table, rowId: row.$id, data: { refreshStartedAt: new Date().toISOString() } }),
      );
    },

    releaseRefresh(row) {
      return ifUnchanged(row, (db) =>
        db.updateRow({ ...table, rowId: row.$id, data: { refreshStartedAt: null } }),
      );
    },

    saveRefreshed(row, tokens) {
      return ifUnchanged(row, (db) =>
        db.updateRow({ ...table, rowId: row.$id, data: { ...tokenColumns(tokens), refreshStartedAt: null } }),
      );
    },

    async removeIfUnchanged(row) {
      return (await ifUnchanged(row, (db) => db.deleteRow({ ...table, rowId: row.$id }))) !== false;
    },
  };
}

function tokenColumns(tokens) {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
}

/**
 * Returns an access token that is valid for at least another minute,
 * refreshing it when needed.
 *
 * Each refresh token works once. If Appwrite sees the same refresh token
 * twice, it treats the second use as theft and revokes the whole grant. So
 * an execution first claims the refresh by setting refreshStartedAt with a
 * conditional write, which only one execution can win. The others wait for
 * the new tokens. If the claim is older than the lease, the execution that
 * made it stopped, and the next execution claims the refresh again.
 */
export async function getAccessToken(connections, discordUserId) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const connection = await connections.get(discordUserId);
    if (!connection) throw new NotConnectedError();
    if (isFresh(connection)) return connection.accessToken;

    if (isRefreshing(connection)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const claimed = await connections.claimRefresh(connection);
    if (!claimed) continue;

    let tokens;
    try {
      tokens = await refreshTokens(connection.refreshToken, { timeoutMs: REFRESH_TIMEOUT_MS });
    } catch (err) {
      if (oauthErrorCode(err) !== 'invalid_grant') {
        // A 4xx answer means Appwrite did not use the refresh token, so the
        // claim can go. After a timeout or a network error, the claim stays
        // until the lease runs out.
        if (err instanceof AppwriteException && err.code < 500) {
          await connections.releaseRefresh(claimed);
        }
        throw err;
      }
      // Only this execution used the refresh token, so the user revoked
      // access. If the user connected again in the meantime, the row
      // changed, the delete does not apply, and the loop reads the new row.
      if (await connections.removeIfUnchanged(claimed)) throw new NotConnectedError();
      continue;
    }

    if (await connections.saveRefreshed(claimed, tokens)) return tokens.access_token;
    // The user connected again during the refresh. The new tokens belong
    // to the old grant, so the loop reads the new row instead.
  }

  throw new Error('Timed out while waiting for a token refresh');
}

function isRefreshing(connection) {
  if (!connection.refreshStartedAt) return false;
  return Date.now() - new Date(connection.refreshStartedAt).getTime() < REFRESH_LEASE_MS;
}

/**
 * Treats an access token as expired one minute early, so it cannot expire
 * in the middle of a tool call.
 */
function isFresh(connection) {
  return new Date(connection.expiresAt).getTime() - REFRESH_MARGIN_MS > Date.now();
}
