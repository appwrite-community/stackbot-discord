import { editReply, linkButton } from '../discord.js';
import { listGrantedProjects, requestDeviceCode, waitForApproval } from '../sign-in-with-appwrite.js';

/**
 * /stackbot connect
 *
 * Links the Discord user to their Appwrite account with the device flow.
 * Stackbot shows a code and a button, the user approves in the browser, and
 * this execution keeps polling until the tokens arrive. The device code
 * expires after ten minutes, which fits inside one execution and inside the
 * 15 minutes that the interaction token can edit the reply.
 */
export async function connect(job, { connections }) {
  const deviceAuthorization = await requestDeviceCode();

  await editReply(job, {
    content: [
      'Link Stackbot to your Appwrite account.',
      `1. Select **Open Appwrite** and confirm the code \`${deviceAuthorization.user_code}\`.`,
      '2. Choose the projects Stackbot can read, then select **Authorize**.',
      'This message updates once you approve. The code expires in 10 minutes.',
    ].join('\n'),
    components: [linkButton('Open Appwrite', deviceAuthorization.verification_uri_complete)],
  });

  const tokens = await waitForApproval(deviceAuthorization);
  if (!tokens) {
    await editReply(job, { content: 'The code expired or the request was declined. Run `/stackbot connect` to try again.' });
    return;
  }

  await connections.save(job.discordUserId, tokens);
  const projects = await listGrantedProjects(tokens.access_token);

  await editReply(job, {
    content: `Connected. Stackbot can read ${projects.length} of your projects. Ask something with \`/stackbot ask\`.`,
  });
}
