import { openDb, type Db } from '../db'

let db: Db | undefined

/** The panel's database, opened (and migrated) once per process. */
export function useDb(): Db {
  db ??= openDb(useRuntimeConfig().dbPath)
  return db
}
