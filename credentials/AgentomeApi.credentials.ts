import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class AgentomeApi implements ICredentialType {
  name = 'agentomeApi';

  displayName = 'Agentome API';

  documentationUrl = 'https://agentome.ai/docs/api/';

  icon = {
    light: 'file:../nodes/Agentome/agentome.svg',
    dark: 'file:../nodes/Agentome/agentome.dark.svg',
  } as const;

  properties: INodeProperties[] = [
    {
      displayName: 'Server Address',
      name: 'url',
      type: 'string',
      default: '',
      placeholder: 'https://agentome.example.com',
      description: 'The address you open Agentome at',
      required: true,
    },
    {
      displayName: 'API Token',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'A personal API token: in Agentome, open the menu under your name and choose API tokens. The nodes act as you, so a read-only token can only read.',
      required: true,
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: { Authorization: '=Bearer {{$credentials.token}}' },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.url.replace(/\\/+$/, "")}}',
      url: '/api/me',
    },
  };
}
