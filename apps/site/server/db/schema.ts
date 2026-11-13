import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// The mailing list. One row per address and nothing more: no name, no IP address, no browser
// details. `consentVersion` names the exact wording the person agreed to (see
// server/utils/newsletter.ts), which is our record of consent.
// `list` lets one table hold more than one list (the newsletter now, a waitlist later); an
// address appears once per list.
export const subscribers = sqliteTable(
  'subscribers',
  {
    id: text('id').primaryKey(),
    list: text('list').notNull().default('newsletter'),
    email: text('email').notNull(),
    status: text('status', { enum: ['pending', 'confirmed'] }).notNull(),
    consentVersion: text('consent_version').notNull(),
    source: text('source').notNull(),
    createdAt: text('created_at').notNull(),
    confirmedAt: text('confirmed_at'),
    /** SHA-256 of the confirm/unsubscribe token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
  },
  (t) => [uniqueIndex('subscribers_list_email_unique').on(t.list, t.email)],
)
