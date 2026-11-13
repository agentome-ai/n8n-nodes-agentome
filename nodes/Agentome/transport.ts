import {
  NodeApiError,
  type IDataObject,
  type IExecuteFunctions,
  type IHttpRequestMethods,
  type ILoadOptionsFunctions,
  type INodePropertyOptions,
  type IPollFunctions,
  type JsonObject,
} from 'n8n-workflow';

type Context = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

/** A run that has ended: its status no longer changes. */
export const ENDED = ['done', 'failed', 'cancelled'];

/**
 * One call to the Agentome API, signed with the person's token. A refusal carries Agentome's own
 * message (`{ error: { code, message } }`), which says what to do in words, so it is what n8n shows.
 */
export async function agentomeRequest(
  this: Context,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
  qs?: IDataObject,
): Promise<IDataObject> {
  const { url } = await this.getCredentials<{ url: string }>('agentomeApi');
  try {
    return (await this.helpers.httpRequestWithAuthentication.call(this, 'agentomeApi', {
      method,
      url: `${url.replace(/\/+$/, '')}${path}`,
      body,
      qs,
      json: true,
    })) as IDataObject;
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as JsonObject, {
      message: refusalOf(error),
    });
  }
}

/** Agentome's message in a refused call, wherever the HTTP client put the answer's body. */
export function refusalOf(error: unknown): string | undefined {
  const holder = error as {
    response?: { data?: unknown; body?: unknown };
    cause?: { response?: { data?: unknown; body?: unknown } };
  };
  for (const body of [
    holder.response?.data,
    holder.response?.body,
    holder.cause?.response?.data,
    holder.cause?.response?.body,
  ]) {
    const parsed = typeof body === 'string' ? safeJson(body) : body;
    const message = (parsed as { error?: { message?: unknown } } | undefined)?.error?.message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not Agentome's answer (a proxy's page): n8n shows the status instead.
    return undefined;
  }
}

/** The projects and agents the person sees, for the node's lists. */
export async function listOf(
  this: ILoadOptionsFunctions,
  path: '/api/projects' | '/api/agents',
  key: 'projects' | 'agents',
): Promise<INodePropertyOptions[]> {
  const answer = await agentomeRequest.call(this, 'GET', path);
  return ((answer[key] as IDataObject[] | undefined) ?? []).map((item) => ({
    name: String(item.name),
    value: String(item.id),
    description: typeof item.roleTitle === 'string' ? item.roleTitle : undefined,
  }));
}
