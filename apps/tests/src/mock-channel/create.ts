import { AgentView } from 'agentview';


const address = process.argv[2];
if (!address) {
  console.error('Usage: create <address>');
  process.exit(1);
}

const av = new AgentView({
  apiKey: process.env.AGENTVIEW_API_KEY,
});

const channel = await av.__internal.createMockEmailChannel({ address });

console.log(channel);