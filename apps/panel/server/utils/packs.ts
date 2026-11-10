import { modrinthPack } from '@flytower/providers'
import { PackStore } from '../status/packs'
import { readLock } from '../spec/lock'

let store: PackStore | undefined

/** Players' modpacks for public pages. */
export function usePacks(): PackStore {
  const config = useRuntimeConfig()
  store ??= new PackStore({
    dir: config.packsDir,
    modrinth: modrinthPack(fetch, config.modrinthApi),
    readLock: (name) => readLock(serverDir(name)),
  })
  return store
}
