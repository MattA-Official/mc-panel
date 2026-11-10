declare module '#auth-utils' {
  interface User {
    id: number
    name: string
  }

  interface UserSession {
    /** The setup token was accepted in this browser; allows the first passkey to be created. */
    setupVerified?: boolean
    /** Signed in with a recovery code: must add a passkey before doing anything else. */
    mustEnrolPasskey?: boolean
    /** Epoch ms until which destructive actions are allowed without another passkey tap. */
    elevatedUntil?: number
    /** Opened a valid invite link: may create a passkey to join with it. */
    inviteId?: number
  }
}

export {}
