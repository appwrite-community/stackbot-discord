/**
 * Registers Stackbot's commands with Discord. Run it once, and again after
 * changing a command:
 *
 *   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node scripts/register-commands.js
 */
const OPTION_SUBCOMMAND = 1;
const OPTION_STRING = 3;
const CHAT_INPUT = 1;
const MESSAGE = 3;

const commands = [
  {
    type: CHAT_INPUT,
    name: 'stackbot',
    description: 'Ask about your Appwrite projects',
    options: [
      {
        type: OPTION_SUBCOMMAND,
        name: 'connect',
        description: 'Link your Appwrite account',
      },
      {
        type: OPTION_SUBCOMMAND,
        name: 'ask',
        description: 'Ask a question about your projects',
        options: [
          {
            type: OPTION_STRING,
            name: 'question',
            description: 'For example: why did my last deployment fail?',
            required: true,
          },
        ],
      },
      {
        type: OPTION_SUBCOMMAND,
        name: 'disconnect',
        description: 'Remove Stackbot\'s access to your Appwrite account',
      },
    ],
  },
  {
    type: MESSAGE,
    name: 'Ask Stackbot',
  },
];

const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN) {
  console.error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN.');
  process.exit(1);
}

const response = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}
console.log(`Registered ${commands.length} commands.`);
