import { Client, Functions, Project, Query, Sites, Users } from 'node-appwrite';

const LOG_TAIL_LENGTH = 3000;

/**
 * The tools the model can call. Each tool reads one thing from a project the
 * user granted, using the user's own access token, so the model can only
 * see what the user approved on the consent screen.
 */
export const TOOL_DEFINITIONS = [
  tool('list_projects', 'List the Appwrite projects the user granted access to, with their names.', {}),
  tool('list_sites', 'List the sites in a project with the status of their latest deployment.', {
    projectId: { type: 'string' },
  }),
  tool('list_functions', 'List the functions in a project with their runtime and latest deployment status.', {
    projectId: { type: 'string' },
  }),
  tool('list_deployments', 'List the most recent deployments of a site or function, newest first.', {
    projectId: { type: 'string' },
    resourceType: { type: 'string', enum: ['site', 'function'] },
    resourceId: { type: 'string', description: 'The site ID or function ID' },
  }),
  tool('get_build_logs', 'Get the end of the build logs for one deployment of a site or function.', {
    projectId: { type: 'string' },
    resourceType: { type: 'string', enum: ['site', 'function'] },
    resourceId: { type: 'string', description: 'The site ID or function ID' },
    deploymentId: { type: 'string' },
  }),
  tool('list_executions', 'List the most recent executions of a function, newest first, with errors.', {
    projectId: { type: 'string' },
    functionId: { type: 'string' },
    onlyFailed: { type: 'boolean' },
  }, ['projectId', 'functionId']),
  tool('count_signups', 'Count the users who signed up to a project since a date.', {
    projectId: { type: 'string' },
    since: { type: 'string', description: 'ISO 8601 date, for example 2026-09-17' },
  }),
];

/**
 * Binds the tool implementations to one user's access token and granted
 * projects. The returned function runs a tool call by name. It returns errors
 * as JSON instead of throwing, so the model can read them and try again.
 */
export function createToolRunner(accessToken, grantedProjects) {
  const endpoints = new Map(grantedProjects.map((project) => [project.$id, project.endpoint]));

  function projectClient(projectId) {
    const endpoint = endpoints.get(projectId);
    if (!endpoint) throw new Error(`Project ${projectId} is not part of the user's grant.`);
    return new Client().setEndpoint(endpoint).setProject(projectId).setBearer(accessToken);
  }

  const tools = {
    async list_projects() {
      return Promise.all(
        grantedProjects.map(async (granted) => {
          const project = await new Project(projectClient(granted.$id)).get();
          return { projectId: project.$id, name: project.name, region: granted.region };
        }),
      );
    },

    async list_sites({ projectId }) {
      const { sites } = await new Sites(projectClient(projectId)).list();
      return sites.map((site) => ({
        siteId: site.$id,
        name: site.name,
        framework: site.framework,
        latestDeploymentId: site.latestDeploymentId,
        latestDeploymentStatus: site.latestDeploymentStatus,
      }));
    },

    async list_functions({ projectId }) {
      const { functions } = await new Functions(projectClient(projectId)).list();
      return functions.map((fn) => ({
        functionId: fn.$id,
        name: fn.name,
        runtime: fn.runtime,
        latestDeploymentId: fn.latestDeploymentId,
        latestDeploymentStatus: fn.latestDeploymentStatus,
      }));
    },

    async list_deployments({ projectId, resourceType, resourceId }) {
      const queries = [Query.orderDesc('$createdAt'), Query.limit(5)];
      const { deployments } =
        resourceType === 'site'
          ? await new Sites(projectClient(projectId)).listDeployments({ siteId: resourceId, queries })
          : await new Functions(projectClient(projectId)).listDeployments({ functionId: resourceId, queries });

      return deployments.map((deployment) => ({
        deploymentId: deployment.$id,
        createdAt: deployment.$createdAt,
        status: deployment.status,
        buildDurationSeconds: deployment.buildDuration,
        commitMessage: deployment.providerCommitMessage || undefined,
        branch: deployment.providerBranch || undefined,
      }));
    },

    async get_build_logs({ projectId, resourceType, resourceId, deploymentId }) {
      const deployment =
        resourceType === 'site'
          ? await new Sites(projectClient(projectId)).getDeployment({ siteId: resourceId, deploymentId })
          : await new Functions(projectClient(projectId)).getDeployment({ functionId: resourceId, deploymentId });

      return { status: deployment.status, buildLogs: tail(deployment.buildLogs) };
    },

    async list_executions({ projectId, functionId, onlyFailed = false }) {
      const queries = [Query.orderDesc('$createdAt'), Query.limit(10)];
      if (onlyFailed) queries.push(Query.equal('status', 'failed'));

      const { executions } = await new Functions(projectClient(projectId)).listExecutions({
        functionId,
        queries,
      });
      return executions.map((execution) => ({
        createdAt: execution.$createdAt,
        status: execution.status,
        trigger: execution.trigger,
        request: `${execution.requestMethod} ${execution.requestPath}`,
        responseStatusCode: execution.responseStatusCode,
        durationSeconds: execution.duration,
        errors: tail(execution.errors, 500),
      }));
    },

    async count_signups({ projectId, since }) {
      const { total } = await new Users(projectClient(projectId)).list({
        queries: [Query.greaterThanEqual('$createdAt', new Date(since).toISOString()), Query.limit(1)],
      });
      return { since, signups: total };
    },
  };

  return async function runTool(name, argumentsJson) {
    try {
      const args = JSON.parse(argumentsJson || '{}');
      return JSON.stringify(await tools[name](args));
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  };
}

/**
 * Builds a tool definition in the Chat Completions format. Every argument is
 * required unless the `required` list says otherwise.
 */
function tool(name, description, properties, required = Object.keys(properties)) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

/**
 * Keeps the end of a long log, where build errors usually are.
 */
function tail(text = '', length = LOG_TAIL_LENGTH) {
  return text.length > length ? text.slice(-length) : text;
}
