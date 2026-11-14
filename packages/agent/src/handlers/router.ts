import { AgentError } from '@flytower/protocol'

/**
 * The hostname router and firewall verbs it needs are only in the Rust agent: the Bun agent
 * is being retired (#233), so it refuses them and the panel greys the switch out.
 */
const rustOnly = async (): Promise<never> => {
  throw new AgentError('failed', 'the hostname router needs the Rust agent')
}

export const expose = rustOnly
export const enable = rustOnly
export const disable = rustOnly
