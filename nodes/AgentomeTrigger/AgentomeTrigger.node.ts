import {
  NodeConnectionTypes,
  type IDataObject,
  type ILoadOptionsFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type IPollFunctions,
} from 'n8n-workflow';
import { agentomeRequest, ENDED, listOf } from '../Agentome/transport';

/** How many ids of what was already emitted the trigger keeps, so nothing fires twice. */
const KEEP = 500;

type State = { watching?: string[]; seen?: string[] };

export class AgentomeTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Agentome Trigger',
    name: 'agentomeTrigger',
    icon: { light: 'file:agentome.svg', dark: 'file:agentome.dark.svg' },
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["event"]}}',
    description: 'Starts the workflow when an agent finishes a run, or waits for your decision',
    defaults: { name: 'Agentome Trigger' },
    polling: true,
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'agentomeApi', required: true }],
    properties: [
      {
        displayName: 'Event',
        name: 'event',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Run Ended',
            value: 'runEnded',
            description: 'A run of one of your agents ended: done, failed or cancelled',
          },
          {
            name: 'Approval Waiting',
            value: 'approvalWaiting',
            description: "A tool call of one of your agents waits for your decision, or an agent asks you something",
          },
        ],
        default: 'runEnded',
      },
      {
        displayName: 'Agent Name or ID',
        name: 'agentId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getAgents' },
        default: '',
        description:
          'Only the runs of this agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        displayOptions: { show: { event: ['runEnded'] } },
      },
      {
        displayName: 'Statuses',
        name: 'statuses',
        type: 'multiOptions',
        options: [
          { name: 'Done', value: 'done' },
          { name: 'Failed', value: 'failed' },
          { name: 'Cancelled', value: 'cancelled' },
        ],
        default: ['done', 'failed', 'cancelled'],
        description: 'Which endings start the workflow',
        displayOptions: { show: { event: ['runEnded'] } },
      },
    ],
  };

  methods = {
    loadOptions: {
      async getAgents(this: ILoadOptionsFunctions) {
        return [{ name: 'Any Agent', value: '' }, ...(await listOf.call(this, '/api/agents', 'agents'))];
      },
    },
  };

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const event = this.getNodeParameter('event') as string;
    const found = event === 'runEnded' ? await endedRuns.call(this) : await waitingApprovals.call(this);
    return found.length ? [this.helpers.returnJsonArray(found)] : null;
  }
}

/**
 * Runs that ended since the last poll. A short run is created and ends between two polls, so it is
 * among the newest runs; a long one was seen going on an earlier poll and is read again by its id.
 * The first poll only takes note of what is there, so turning the workflow on fires nothing old.
 */
async function endedRuns(this: IPollFunctions): Promise<IDataObject[]> {
  const agent = this.getNodeParameter('agentId') as string;
  const statuses = this.getNodeParameter('statuses') as string[];
  const filter = agent ? { agent } : {};
  const list = async (qs: IDataObject) =>
    ((await agentomeRequest.call(this, 'GET', '/api/runs', undefined, { ...filter, ...qs }))
      .runs as IDataObject[] | undefined) ?? [];
  const read = (id: string) =>
    agentomeRequest.call(this, 'GET', `/api/runs/${encodeURIComponent(id)}`);

  const recent = await list({ limit: 50 });
  const ended = recent.filter((run) => ENDED.includes(String(run.status)));

  if (this.getMode() === 'manual') {
    // Fetching a test event in the editor: the latest ending, without touching what the trigger keeps.
    const latest = ended.find((run) => statuses.includes(String(run.status)));
    return latest ? [await read(String(latest.id))] : [];
  }

  const live = await list({ status: 'live', limit: 100 });
  const state = this.getWorkflowStaticData('node') as State;
  const first = state.seen === undefined;
  const seen = new Set(state.seen ?? []);
  const liveIds = new Set(live.map((run) => String(run.id)));
  const candidates = new Map(ended.map((run) => [String(run.id), run]));
  for (const id of state.watching ?? []) {
    if (liveIds.has(id) || candidates.has(id)) continue;
    const run = await read(id);
    if (ENDED.includes(String(run.status))) candidates.set(id, run);
  }

  const fresh = first ? [] : [...candidates.keys()].filter((id) => !seen.has(id));
  for (const id of candidates.keys()) seen.add(id);
  state.seen = [...seen].slice(-KEEP);
  state.watching = [...liveIds];

  const out: IDataObject[] = [];
  // Oldest first, the order they ended in.
  for (const id of fresh.reverse()) {
    if (!statuses.includes(String(candidates.get(id)?.status))) continue;
    out.push(await read(id));
  }
  return out;
}

/** Tool calls and questions that began to wait since the last poll, oldest first. */
async function waitingApprovals(this: IPollFunctions): Promise<IDataObject[]> {
  const answer = await agentomeRequest.call(this, 'GET', '/api/approvals');
  const approvals = (answer.approvals as IDataObject[] | undefined) ?? [];
  if (this.getMode() === 'manual') return approvals.slice(-1);

  const state = this.getWorkflowStaticData('node') as State;
  const first = state.seen === undefined;
  const seen = new Set(state.seen ?? []);
  const fresh = first ? [] : approvals.filter((item) => !seen.has(String(item.id)));
  for (const item of approvals) seen.add(String(item.id));
  state.seen = [...seen].slice(-KEEP);
  return fresh;
}
