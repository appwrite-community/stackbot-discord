import { AppwriteException, Client, Oauth2 } from 'node-appwrite';

const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * Read-only access to the parts of a project Stackbot answers questions
 * about. The user picks which projects the grant covers on the consent screen.
 */
export const SCOPES = [
  'project:project.read',
  'project:sites.read',
  'project:functions.read',
  'project:executions.read',
  'project:users.read',
].join(' ');

/**
 * The Oauth2 service of the Appwrite SDK. Sign in with Appwrite runs on the
 * console project. With an access token, calls act as the user.
 */
function oauth2(accessToken) {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_CONSOLE_ENDPOINT)
    .setProject('console');
  if (accessToken) client.setBearer(accessToken);
  return new Oauth2(client);
}

/**
 * The Stackbot app's credentials, sent with every token request.
 */
const clientCredentials = () => ({
  clientId: process.env.APPWRITE_CLIENT_ID,
  clientSecret: process.env.APPWRITE_CLIENT_SECRET,
});

/**
 * Starts the device flow. The response holds the short code the user
 * confirms in the browser and the device code Stackbot polls with.
 */
export async function requestDeviceCode() {
  return oauth2().createDeviceAuthorization({
    clientId: process.env.APPWRITE_CLIENT_ID,
    scope: SCOPES,
  });
}

/**
 * Polls the token endpoint until the user approves or declines, or the code
 * expires. Returns the tokens on approval and null otherwise.
 */
export async function waitForApproval(deviceAuthorization) {
  const deadline = Date.now() + deviceAuthorization.expires_in * 1000;
  let intervalMs = Math.max(deviceAuthorization.interval, 2) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    try {
      return await oauth2().createToken({
        grantType: DEVICE_CODE_GRANT,
        deviceCode: deviceAuthorization.device_code,
        ...clientCredentials(),
      });
    } catch (err) {
      const reason = oauthErrorCode(err);
      if (reason === 'authorization_pending') continue;
      if (reason === 'slow_down') {
        intervalMs += 5000;
        continue;
      }
      if (reason === 'access_denied' || reason === 'expired_token') return null;
      throw err;
    }
  }
  return null;
}

/**
 * Trades a refresh token for a new pair. Appwrite rotates refresh tokens,
 * so the old one stops working as soon as this call succeeds.
 *
 * This request uses fetch instead of the SDK, because fetch can abort it.
 * After the abort, Appwrite either already has the whole request and
 * answers it within milliseconds, or it never receives it. So the refresh
 * is over well before the claim on the row expires.
 */
export async function refreshTokens(refreshToken, { timeoutMs }) {
  const response = await fetch(`${process.env.APPWRITE_CONSOLE_ENDPOINT}/oauth2/console/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-appwrite-project': 'console' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.APPWRITE_CLIENT_ID,
      client_secret: process.env.APPWRITE_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new AppwriteException('Token refresh failed', response.status, '', body);
  }
  return JSON.parse(body);
}

/**
 * Revokes a refresh token, which ends the grant for every token issued
 * from it.
 */
export async function revokeRefreshToken(refreshToken) {
  await oauth2().revoke({
    token: refreshToken,
    tokenTypeHint: 'refresh_token',
    ...clientCredentials(),
  });
}

/**
 * Lists the projects the user granted, each with the API endpoint of its
 * region.
 */
export async function listGrantedProjects(accessToken) {
  const { projects } = await oauth2(accessToken).listProjects({ limit: 100 });
  return projects;
}

/**
 * OAuth2 errors come back as a JSON body with an `error` code, for example
 * `authorization_pending` while the user has not decided yet.
 */
export function oauthErrorCode(err) {
  try {
    return JSON.parse(err.response).error;
  } catch {
    return undefined;
  }
}

/**
 * Waits between device flow polls.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
