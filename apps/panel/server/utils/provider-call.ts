import { ProviderError } from '@flytower/providers'

/** Turns an upstream failure into a 502 with the provider's readable message. */
export async function providerCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ProviderError) {
      throw createError({ statusCode: 502, statusMessage: err.message })
    }
    throw err
  }
}
