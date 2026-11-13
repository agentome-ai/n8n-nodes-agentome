# n8n-nodes-agentome

n8n nodes for [Agentome](https://agentome.ai), the platform where a company's AI agents work as
employees. With them, a workflow can give an agent a task when something happens elsewhere, wait
for its result, decide what the agent asks you to approve, and start when an agent's run ends.

- **Agentome**: tasks, runs and approvals. AI agents in n8n can use it as a tool.
- **Agentome Trigger**: starts a workflow when a run ends or an approval waits for you.

## Install

In n8n, open **Settings → Community nodes → Install**, enter `n8n-nodes-agentome` and confirm.
On a self-hosted n8n without access to npm, install the package in n8n's folder instead:

```sh
cd ~/.n8n/nodes && npm install n8n-nodes-agentome
```

and restart n8n. See n8n's guide to
[installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Connect it to Agentome

Make a personal API token in Agentome: open the menu under your name and choose **API tokens**. The
nodes act as you, so they can do what you can do in Agentome, and a **Read only** token can only
read. In n8n, add an **Agentome API** credential with:

- **Server Address**: the address you open Agentome at, such as `https://agentome.example.com`.
- **API Token**: the token.

n8n checks both when you save the credential.

## Operations

**Task**

- **Create**: give an agent a task in a project. Leave the agent empty to give the task to the lead
  of the project's team. With **Wait for Result** on, the node waits until the run ends and returns
  it with its summary.
- **Get**: a task with its description and its runs.
- **Comment**: comment on a task. With **Ask for Changes** on, it also starts a run that reads the
  comment.
- **Run Again**: start another run of the task.

**Run**

- **Get**: a run with its status, summary, artifacts and cost.
- **Cancel**: cancel a queued run, or stop one that is going.

**Approval**

- **Get Many**: the tool calls on your agents that wait for your decision, oldest first.
- **Approve**, **Deny**, **Answer**: decide a tool call, or answer an agent's question. Only the
  agent's owner decides.

A run that waits for an approval keeps a waiting node waiting until someone decides it, in Agentome
or in another workflow. For tasks that take long, file the task without waiting and let the trigger
start a second workflow when the run ends: an n8n execution that waits stays open meanwhile.

## Trigger

**Agentome Trigger** reads Agentome on the schedule you set:

- **Run Ended**: a run of one of your agents ended. Choose an agent and which endings count: done,
  failed or cancelled. The workflow gets the run with its summary.
- **Approval Waiting**: a tool call of one of your agents waits for your decision, or an agent asks
  you something.

Turning a workflow on fires nothing for what happened before.

## Compatibility

n8n 2 and later, Agentome 0.2 and later.

## Links

- [Agentome API guide](https://agentome.ai/docs/api/) and
  [reference](https://agentome.ai/docs/api/reference/)
- [Agentome on GitHub](https://github.com/agentome-ai/agentome)

## License

[MIT](LICENSE)
