import { z } from 'zod'

/** A server's short name. Used in unit names, Linux user names and paths, so kept strict. */
export const ServerName = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{1,30}$/,
    'lowercase letters, digits and hyphens, 2 to 31 characters, starting with a letter',
  )
  .refine((n) => !n.endsWith('-'), 'must not end with a hyphen')

export type ServerName = z.infer<typeof ServerName>

/** The systemd instance for a server. */
export const unitName = (name: ServerName) => `kiln-mc@${name}.service`

/** The Linux user that owns and runs a server. */
export const userName = (name: ServerName) => `mc-${name}`
