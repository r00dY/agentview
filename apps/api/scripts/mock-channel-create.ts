import { AgentView } from 'agentview';

const av = new AgentView({
  apiKey: process.env.AGENTVIEW_API_KEY,
});

const channel = await av.__internal.createMockEmailChannel({
  address: 'test@example.com',
});

console.log(channel);