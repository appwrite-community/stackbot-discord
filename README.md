# Stackbot: a Discord bot for your Appwrite projects

A Discord bot that answers questions about your Appwrite projects, such as why a deployment
failed or how many users signed up this week. It runs on two Appwrite Functions, so there is
no server to keep online. Each Discord user links their own Appwrite account with
Sign in with Appwrite, and the bot reads only the projects that user approved.

The model is GPT-6 Luna through OpenRouter.

## How it works

1. Discord sends every command to the `discord-interactions` function over HTTP.
2. That function checks Discord's signature, queues the `stackbot-agent` function, and
   answers Discord with "Stackbot is thinking..." inside the three-second limit.
3. `stackbot-agent` runs the command and edits the reply when it is done.

## Commands

- `/stackbot connect`: links your Appwrite account with the device flow.
- `/stackbot ask question:<text>`: answers a question with the model and read-only project tools.
- `/stackbot disconnect`: revokes the grant and deletes the stored tokens.
- Ask Stackbot (message menu): asks about the message you right-clicked, for example a pasted error.

Replies are ephemeral, so only the person who asked can see project data.

## Layout

- `functions/discord-interactions`: checks signatures, answers PING, queues the agent, defers the reply.
- `functions/stackbot-agent/src/main.js`: runs one queued command and edits the Discord reply.
- `functions/stackbot-agent/src/commands/`: one file per command (`connect`, `ask`, `disconnect`).
- `functions/stackbot-agent/src/sign-in-with-appwrite.js`: device flow, token refresh, revocation, granted project list.
- `functions/stackbot-agent/src/connections.js`: encrypted token storage in TablesDB and safe token refresh.
- `functions/stackbot-agent/src/project-tools.js`: the read-only tools the model can call.
- `functions/stackbot-agent/src/agent.js`: the OpenRouter tool loop.
- `functions/stackbot-agent/src/discord.js`: edits the deferred Discord reply.
- `scripts/register-commands.js`: registers the commands with Discord.
- `appwrite.config.json`: both functions for `appwrite push functions`.

## Setup

1. Create a Discord application in the [Discord Developer Portal](https://discord.com/developers/applications).
   Copy the application ID and public key, and reset the bot token on the **Bot** page.
2. In the Appwrite Console, open your organization's **Marketplace** tab, select **Create app**,
   turn on **Device flow** on the **OAuth client** page, and create a secret on **OAuth secrets**.
3. Create a TablesDB database with a `connections` table. Add three required columns:
   `accessToken` (text, encrypted), `refreshToken` (text, encrypted), and `expiresAt` (datetime).
   Add a fourth, optional column `refreshStartedAt` (datetime).
4. Set `projectId` and `endpoint` in `appwrite.config.json`, then run `appwrite push functions`.
5. Set these variables and redeploy both functions:

| Function | Variable | Value |
| --- | --- | --- |
| discord-interactions | `DISCORD_PUBLIC_KEY` | The public key from the Discord application |
| discord-interactions | `AGENT_FUNCTION_ID` | `stackbot-agent` |
| stackbot-agent | `DATABASE_ID` | The database ID |
| stackbot-agent | `APPWRITE_CONSOLE_ENDPOINT` | `https://cloud.appwrite.io/v1` |
| stackbot-agent | `APPWRITE_CLIENT_ID` | The client ID of the Appwrite app |
| stackbot-agent | `APPWRITE_CLIENT_SECRET` | The OAuth secret of the Appwrite app |
| stackbot-agent | `OPENROUTER_API_KEY` | Your OpenRouter API key |
| stackbot-agent | `OPENROUTER_MODEL` | Optional, default `openai/gpt-6-luna` |

6. Paste the `discord-interactions` function domain into **Interactions Endpoint URL** on the
   Discord application's **General Information** page. Discord checks the URL before it saves it,
   so redeploy after setting `DISCORD_PUBLIC_KEY`.
7. Register the commands:

   ```bash
   DISCORD_APPLICATION_ID=<id> DISCORD_BOT_TOKEN=<token> node scripts/register-commands.js
   ```

8. On the **Installation** page, add the `bot` scope next to `applications.commands`, invite the bot
   with the install link, then run `/stackbot connect`.
