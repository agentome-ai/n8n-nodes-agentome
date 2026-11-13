import {
  NodeConnectionTypes,
  NodeOperationError,
  sleepWithAbort,
  type IDataObject,
  type IExecuteFunctions,
  type ILoadOptionsFunctions,
  type INodeExecutionData,
  type INodeProperties,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import { agentomeRequest, ENDED, listOf } from './transport';

/** How often a node that waits for a run reads it again. */
const POLL_MS = 5_000;

const show = (resource: string, operation: string[]) => ({
  show: { resource: [resource], operation },
});

/** Waiting for the run, offered wherever an operation starts one. */
const waiting = (operation: string, extra: IDataObject = {}): INodeProperties[] => [
  {
    displayName: 'Wait for Result',
    name: 'wait',
    type: 'boolean',
    default: false,
    description:
      'Whether to wait until the run ends and return it with its summary, instead of returning at once with the run queued',
    displayOptions: { show: { resource: ['task'], operation: [operation], ...extra } },
  },
  {
    displayName: 'Timeout (Minutes)',
    name: 'timeout',
    type: 'number',
    typeOptions: { minValue: 1 },
    default: 60,
    description:
      'How long to wait. A run still going after it is returned as it is: check its status.',
    displayOptions: {
      show: { resource: ['task'], operation: [operation], wait: [true], ...extra },
    },
  },
];

const properties: INodeProperties[] = [
  {
    displayName: 'Resource',
    name: 'resource',
    type: 'options',
    noDataExpression: true,
    options: [
      { name: 'Task', value: 'task' },
      { name: 'Run', value: 'run' },
      { name: 'Approval', value: 'approval' },
    ],
    default: 'task',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['task'] } },
    options: [
      {
        name: 'Create',
        value: 'create',
        description: 'Give an agent a task in a project, and start its run',
        action: 'Create a task',
      },
      {
        name: 'Get',
        value: 'get',
        description: 'Get a task with its description and runs',
        action: 'Get a task',
      },
      {
        name: 'Comment',
        value: 'comment',
        description: 'Comment on a task, and ask the agent for changes',
        action: 'Comment on a task',
      },
      {
        name: 'Run Again',
        value: 'run',
        description: 'Start another run of a task',
        action: 'Run a task again',
      },
    ],
    default: 'create',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['run'] } },
    options: [
      {
        name: 'Get',
        value: 'get',
        description: 'Get a run with its status, summary, artifacts and cost',
        action: 'Get a run',
      },
      {
        name: 'Cancel',
        value: 'cancel',
        description: 'Cancel a queued run, or stop one that is going',
        action: 'Cancel a run',
      },
    ],
    default: 'get',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['approval'] } },
    options: [
      {
        name: 'Get Many',
        value: 'getAll',
        description: "Get the tool calls waiting for your decision on your agents, oldest first",
        action: 'Get waiting approvals',
      },
      {
        name: 'Approve',
        value: 'approve',
        description: 'Let a waiting tool call run',
        action: 'Approve a tool call',
      },
      {
        name: 'Deny',
        value: 'deny',
        description: 'Refuse a waiting tool call; the agent reads the reason',
        action: 'Deny a tool call',
      },
      {
        name: 'Answer',
        value: 'answer',
        description: "Answer an agent's question; the agent reads the answer",
        action: 'Answer an agent',
      },
    ],
    default: 'getAll',
  },

  // Task: create
  {
    displayName: 'Project Name or ID',
    name: 'projectId',
    type: 'options',
    typeOptions: { loadOptionsMethod: 'getProjects' },
    required: true,
    default: '',
    description:
      'The project the task is filed in. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    displayOptions: show('task', ['create']),
  },
  {
    displayName: 'Agent Name or ID',
    name: 'agentId',
    type: 'options',
    typeOptions: { loadOptionsMethod: 'getAgents' },
    default: '',
    description:
      'The agent that does the task. Leave it empty to give it to the lead of the project\'s team. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
    displayOptions: show('task', ['create']),
  },
  {
    displayName: 'Title',
    name: 'title',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'Add a dark theme to the settings page',
    displayOptions: show('task', ['create']),
  },
  {
    displayName: 'Description',
    name: 'body',
    type: 'string',
    typeOptions: { rows: 5 },
    default: '',
    description: 'What to do and why, in markdown. The agent reads it as the task.',
    displayOptions: show('task', ['create']),
  },
  {
    displayName: 'Start Run',
    name: 'start',
    type: 'boolean',
    default: true,
    description: 'Whether to start the run now. Off, the task waits until someone starts it.',
    displayOptions: show('task', ['create']),
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show('task', ['create']),
    options: [
      {
        displayName: 'Repository',
        name: 'repository',
        type: 'string',
        default: '',
        description:
          "One of the project's repositories, as the project lists it. Empty, the task works in the project's main repository.",
      },
    ],
  },
  ...waiting('create', { start: [true] }),

  // Task: get, comment, run again
  {
    displayName: 'Task ID',
    name: 'taskId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show('task', ['get', 'comment', 'run']),
  },
  {
    displayName: 'Comment',
    name: 'comment',
    type: 'string',
    typeOptions: { rows: 4 },
    required: true,
    default: '',
    description: "In markdown. The task's agent reads the thread in its next run.",
    displayOptions: show('task', ['comment']),
  },
  {
    displayName: 'Ask for Changes',
    name: 'askChanges',
    type: 'boolean',
    default: true,
    description:
      'Whether to also start a run that reads the comment. Refused while a run of the task is going.',
    displayOptions: show('task', ['comment']),
  },
  ...waiting('comment', { askChanges: [true] }),
  ...waiting('run'),

  // Run
  {
    displayName: 'Run ID',
    name: 'runId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show('run', ['get', 'cancel']),
  },

  // Approval
  {
    displayName: 'Approval ID',
    name: 'approvalId',
    type: 'string',
    required: true,
    default: '',
    description: 'The ID of the waiting tool call, as Get Many or the trigger gives it',
    displayOptions: show('approval', ['approve', 'deny', 'answer']),
  },
  {
    displayName: 'Always Allow This Tool',
    name: 'always',
    type: 'boolean',
    default: false,
    description: 'Whether to stop asking about this tool for this agent',
    displayOptions: show('approval', ['approve']),
  },
  {
    displayName: 'Reason',
    name: 'reason',
    type: 'string',
    default: '',
    description: 'Why the call is refused; the agent reads it and can try another way',
    displayOptions: show('approval', ['deny']),
  },
  {
    displayName: 'Answer',
    name: 'answer',
    type: 'string',
    typeOptions: { rows: 3 },
    required: true,
    default: '',
    displayOptions: show('approval', ['answer']),
  },
];

export class Agentome implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Agentome',
    name: 'agentome',
    icon: { light: 'file:agentome.svg', dark: 'file:agentome.dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Give AI agents tasks, wait for their results and decide their approvals',
    defaults: { name: 'Agentome' },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'agentomeApi', required: true }],
    properties,
  };

  methods = {
    loadOptions: {
      async getProjects(this: ILoadOptionsFunctions) {
        return listOf.call(this, '/api/projects', 'projects');
      },
      async getAgents(this: ILoadOptionsFunctions) {
        return [
          { name: "The project's team lead", value: '' },
          ...(await listOf.call(this, '/api/agents', 'agents')),
        ];
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const json = await operate.call(this, i);
        const list = Array.isArray(json) ? json : [json];
        out.push(...list.map((entry) => ({ json: entry, pairedItem: { item: i } })));
      } catch (error) {
        if (!this.continueOnFail()) throw error;
        out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
      }
    }
    return [out];
  }
}

async function operate(this: IExecuteFunctions, i: number): Promise<IDataObject | IDataObject[]> {
  const resource = this.getNodeParameter('resource', i) as string;
  const operation = this.getNodeParameter('operation', i) as string;
  const param = (name: string) => this.getNodeParameter(name, i) as string;
  const id = (name: string) => encodeURIComponent(param(name).trim());

  if (resource === 'task') {
    if (operation === 'create') {
      const extra = this.getNodeParameter('additionalFields', i) as { repository?: string };
      const start = this.getNodeParameter('start', i) as boolean;
      const answer = await agentomeRequest.call(this, 'POST', '/api/tasks', {
        projectId: param('projectId'),
        ...(param('agentId') ? { agentId: param('agentId') } : {}),
        title: param('title'),
        body: param('body'),
        ...(extra.repository ? { repository: extra.repository } : {}),
        run: start,
      });
      const run = answer.run as IDataObject | null;
      if (start && run) return { ...answer, run: await maybeWait.call(this, i, run) };
      return answer;
    }
    if (operation === 'get') return agentomeRequest.call(this, 'GET', `/api/tasks/${id('taskId')}`);
    if (operation === 'comment') {
      const askChanges = this.getNodeParameter('askChanges', i) as boolean;
      const answer = await agentomeRequest.call(this, 'POST', `/api/tasks/${id('taskId')}/comments`, {
        body: param('comment'),
        run: askChanges,
      });
      const run = answer.run as IDataObject | null;
      if (askChanges && run) return { ...answer, run: await maybeWait.call(this, i, run) };
      return answer;
    }
    if (operation === 'run') {
      const run = await agentomeRequest.call(this, 'POST', `/api/tasks/${id('taskId')}/run`);
      return maybeWait.call(this, i, run);
    }
  }

  if (resource === 'run') {
    if (operation === 'get') return agentomeRequest.call(this, 'GET', `/api/runs/${id('runId')}`);
    if (operation === 'cancel') {
      return agentomeRequest.call(this, 'POST', `/api/runs/${id('runId')}/cancel`);
    }
  }

  if (resource === 'approval') {
    if (operation === 'getAll') {
      const answer = await agentomeRequest.call(this, 'GET', '/api/approvals');
      return (answer.approvals as IDataObject[] | undefined) ?? [];
    }
    const path = `/api/tool-calls/${id('approvalId')}/${operation}`;
    if (operation === 'approve') {
      return agentomeRequest.call(this, 'POST', path, {
        always: this.getNodeParameter('always', i) as boolean,
      });
    }
    if (operation === 'deny') {
      const reason = param('reason');
      return agentomeRequest.call(this, 'POST', path, reason ? { reason } : {});
    }
    if (operation === 'answer') return agentomeRequest.call(this, 'POST', path, { answer: param('answer') });
  }

  throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not known`, {
    itemIndex: i,
  });
}

/**
 * The run as it ends, when the node waits for it; otherwise the run as it was queued. A run that
 * waits for an approval keeps the node waiting: someone decides it in Agentome or in another
 * workflow, and the run goes on.
 */
async function maybeWait(this: IExecuteFunctions, i: number, run: IDataObject): Promise<IDataObject> {
  if (!(this.getNodeParameter('wait', i) as boolean)) return run;
  const deadline = Date.now() + (this.getNodeParameter('timeout', i) as number) * 60_000;
  const path = `/api/runs/${encodeURIComponent(String(run.id))}`;
  const signal = this.getExecutionCancelSignal();
  for (;;) {
    const now = await agentomeRequest.call(this, 'GET', path);
    if (ENDED.includes(String(now.status)) || Date.now() >= deadline || signal?.aborted) return now;
    await sleepWithAbort(Math.min(POLL_MS, Math.max(0, deadline - Date.now())), signal);
  }
}
