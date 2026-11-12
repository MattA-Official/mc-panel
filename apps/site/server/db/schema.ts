import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// The mailing list. One row per address and nothing more: no name, no IP address, no browser
// details. `consentVersion` names the exact wording the person agreed to (see
// server/utils/newsletter.ts), which is our record of consent.
export const subscribers = sqliteTable('subscribers', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  status: text('status', { enum: ['pending', 'confirmed'] }).notNull(),
  consentVersion: text('consent_version').notNull(),
  source: text('source').notNull(),
  createdAt: text('created_at').notNull(),
  confirmedAt: text('confirmed_at'),
  /** SHA-256 of the confirm/unsubscribe token. The token itself is never stored. */
  tokenHash: text('token_hash').notNull().unique(),
})
