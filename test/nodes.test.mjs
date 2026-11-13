// The nodes against a fake Agentome: each test says what the server answers and checks what the
// node asks for and what it gives the workflow. Runs on the built package (npm test builds it).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { Agentome } = require('../dist/nodes/Agentome/Agentome.node.js');
const { AgentomeTrigger } = require('../dist/nodes/AgentomeTrigger/AgentomeTrigger.node.js');

/** An n8n context with these parameters, whose requests `answer(method, path, options)` serves. */
function context(parameters, answer, { mode = 'trigger', state = {} } = {}) {
  const calls = [];
  return {
    calls,
    state,
    getNodeParameter: (name) => {
      if (!(name in parameters)) throw new Error(`No parameter ${name}`);
      return parameters[name];
    },
    getCredentials: async () => ({ url: 'https://agentome.example.com/' }),
    getNode: () => ({ name: 'Agentome', type: 'n8n-nodes-agentome.agentome', typeVersion: 1 }),
    getInputData: () => [{ json: {} }],
    continueOnFail: () => false,
    getExecutionCancelSignal: () => undefined,
    getMode: () => mode,
    getWorkflowStaticData: () => state,
    helpers: {
      returnJsonArray: (items) => items.map((json) => ({ json })),
      async httpRequestWithAuthentication(credential, options) {
        assert.equal(credential, 'agentomeApi');
        const path = options.url.replace('https://agentome.example.com', '');
        calls.push({ method: options.method, path, body: options.body, qs: options.qs });
        return answer(options.method, path, options);
      },
    },
  };
}

const run = (id, status, extra = {}) => ({ id, status, endedAt: null, ...extra });

describe('Agentome node', () => {
  it('files a task with the fields given and waits for its run to end', async () => {
    const ctx = context(
      {
        resource: 'task',
        operation: 'create',
        projectId: 'p1',
        agentId: '',
        title: 'Add a dark theme',
        body: 'Match the rest of the app.',
        start: true,
        additionalFields: {},
        wait: true,
        timeout: 5,
      },
      (method, path) => {
        if (method === 'POST' && path === '/api/tasks') {
          return { task: { id: 't1' }, run: { id: 'r1', status: 'queued' } };
        }
        if (path === '/api/runs/r1') return run('r1', 'done', { summary: 'Added it.' });
        throw new Error(`Unexpected ${method} ${path}`);
      },
    );
    const [[item]] = await new Agentome().execute.call(ctx);
    // Without an agent, the task goes to the project's team lead: agentId is left out.
    assert.deepEqual(ctx.calls[0].body, {
      projectId: 'p1',
      title: 'Add a dark theme',
      body: 'Match the rest of the app.',
      run: true,
    });
    assert.deepEqual(item.json, {
      task: { id: 't1' },
      run: { id: 'r1', status: 'done', endedAt: null, summary: 'Added it.' },
    });
  });

  it("shows Agentome's own words when a call is refused", async () => {
    const ctx = context({ resource: 'task', operation: 'get', taskId: 'nope' }, () => {
      const error = new Error('Request failed with status code 404');
      error.response = { data: { error: { code: 'not_found', message: 'Task not found' } } };
      throw error;
    });
    await assert.rejects(() => new Agentome().execute.call(ctx), /Task not found/);
  });

  it('decides approvals: a denial without a reason, an answer, waiting ones as items', async () => {
    const answered = context(
      { resource: 'approval', operation: 'deny', approvalId: 'c1', reason: '' },
      () => ({ decision: 'denied' }),
    );
    await new Agentome().execute.call(answered);
    assert.deepEqual(answered.calls[0], {
      method: 'POST',
      path: '/api/tool-calls/c1/deny',
      body: {},
      qs: undefined,
    });

    const listed = context({ resource: 'approval', operation: 'getAll' }, () => ({
      approvals: [{ id: 'c1' }, { id: 'c2' }],
    }));
    const [items] = await new Agentome().execute.call(listed);
    assert.deepEqual(
      items.map((item) => item.json.id),
      ['c1', 'c2'],
    );
  });
});

describe('Agentome Trigger', () => {
  const parameters = { event: 'runEnded', agentId: '', statuses: ['done', 'failed'] };

  it('fires once for each run that ends, short or long, and nothing on turning on', async () => {
    let recent = [run('old', 'done')];
    let live = [run('long', 'running')];
    const state = {};
    const serve = (method, path, options) => {
      if (path === '/api/runs') return { runs: options.qs.status === 'live' ? live : recent };
      const id = path.split('/').pop();
      if (id === 'long') return run('long', live.length ? 'running' : 'done', { summary: 'Long' });
      return { ...recent.find((r) => r.id === id), summary: id };
    };
    const poll = () => new AgentomeTrigger().poll.call(context(parameters, serve, { state }));

    assert.equal(await poll(), null, 'the first poll only takes note');

    // A short run came and went, one was cancelled (not asked for), and the long one ended: it has
    // dropped out of the newest runs but was being watched.
    recent = [run('short', 'done'), run('stopped', 'cancelled'), ...recent];
    live = [];
    const [items] = await poll();
    assert.deepEqual(items.map((item) => item.json.id).sort(), ['long', 'short']);

    assert.equal(await poll(), null, 'nothing fires twice');
  });

  it('gives the latest ending when fetching a test event, and keeps nothing', async () => {
    const state = {};
    const ctx = context(parameters, (method, path) =>
      path === '/api/runs'
        ? { runs: [run('a', 'cancelled'), run('b', 'failed')] }
        : run('b', 'failed', { summary: 'b' }),
    { mode: 'manual', state });
    const [items] = await new AgentomeTrigger().poll.call(ctx);
    assert.equal(items[0].json.id, 'b');
    assert.deepEqual(state, {});
  });

  it('fires for approvals that began to wait since the last poll', async () => {
    let approvals = [{ id: 'c1' }];
    const state = {};
    const poll = () =>
      new AgentomeTrigger().poll.call(
        context({ event: 'approvalWaiting' }, () => ({ approvals }), { state }),
      );
    assert.equal(await poll(), null);
    approvals = [{ id: 'c1' }, { id: 'c2' }];
    const [items] = await poll();
    assert.deepEqual(
      items.map((item) => item.json.id),
      ['c2'],
    );
  });
});
