import { AgentView } from 'agentview';

const [address, contact, subject, body] = process.argv.slice(2);
if (!address || !contact || !subject || !body) {
  console.error('Usage: send-message <address> <contact> <subject> <body>');
  process.exit(1);
}

const av = new AgentView({
  apiKey: process.env.AGENTVIEW_API_KEY,
});

const result = await av.__internal.sendMockEmail({
  address,
  contact,
  subject,
  body,
});

console.log(result);