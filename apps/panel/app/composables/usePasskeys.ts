import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser'

/** Turns API and browser errors into one sentence for the user. */
export function errorMessage(e: unknown): string {
  if (
    e instanceof Error &&
    (e.name === 'InvalidStateError' ||
      (e as WebAuthnError).code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
  ) {
    return 'This device already has a passkey for this panel. Sign in with it instead.'
  }
  if (e instanceof WebAuthnError || (e instanceof Error && e.name === 'NotAllowedError')) {
    return 'The passkey prompt was closed or timed out. Try again.'
  }
  const data = (e as { data?: { statusMessage?: string; message?: string } })?.data
  return (
    data?.statusMessage ??
    data?.message ??
    (e instanceof Error ? e.message : 'Something went wrong.')
  )
}

/** Guesses a friendly name for the passkey from the browser, e.g. "Mac" or "iPhone". */
function deviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Linux/.test(ua)) return 'Linux PC'
  return 'Passkey'
}

export function usePasskeys() {
  async function register(name?: string, nickname = deviceName()) {
    const { options, attemptId } = await $fetch('/api/passkeys/register-options', {
      method: 'POST',
      body: { name },
    })
    const response = await startRegistration({ optionsJSON: options })
    return $fetch<{ recoveryCodes: string[] | null }>('/api/passkeys/register', {
      method: 'POST',
      body: { attemptId, response, nickname, name },
    })
  }

  async function authenticate(purpose: 'login' | 'elevate' = 'login') {
    const { options, attemptId } = await $fetch(`/api/auth/${purpose}-options`, { method: 'POST' })
    const response = await startAuthentication({ optionsJSON: options })
    await $fetch(`/api/auth/${purpose}`, { method: 'POST', body: { attemptId, response } })
  }

  return { register, authenticate }
}
