import { z } from 'zod'
import { OffsiteError } from './offsite'

export const TargetBody = z.object({
  name: z.string().trim().min(1).max(40),
  endpoint: z.url({
    protocol: /^https?$/,
    error: 'The endpoint is a web address, like https://s3.eu-central-003.backblazeb2.com.',
  }),
  region: z.string().trim().max(40).default('auto'),
  bucket: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
      'Bucket names are 3 to 63 lower-case letters, digits, dots and dashes.',
    ),
  prefix: z
    .string()
    .trim()
    .max(100)
    .regex(/^[\w./-]*$/, 'Letters, digits, dots, dashes and slashes only.')
    .transform((p) => p.replace(/^\/+|\/+$/g, ''))
    .default('flytower'),
  accessKeyId: z.string().trim().min(1).max(200),
  secretAccessKey: z.string().min(1).max(400),
})

/** Runs `fn`, turning an OffsiteError into a 400 the browser can show. */
export async function offsiteHttp<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof OffsiteError) {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
}
