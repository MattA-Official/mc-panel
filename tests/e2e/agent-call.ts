/**
 * Calls the agent from inside the E2E container, for checks that need root's view:
 *   bun /src/tests/e2e/agent-call.ts ssh.set '{"open":true,"minutes":1}'
 */
import type { Verb } from '../../packages/protocol/src/index.ts'
import { callAgent } from '../../packages/protocol/src/client.ts'

const [verb, params = '{}'] = process.argv.slice(2)
const result = await callAgent(verb as Verb, JSON.parse(params), {
  socketPath: '/run/flytower/agent.sock',
})
console.log(JSON.stringify(result))
