/**
 * Opens something (a confirm, a form) when the page is reached with `?<key>=…`, then drops
 * the key so a reload or Back doesn't open it again. Menus elsewhere link to actions this
 * way, so each action keeps its one confirm (#106).
 */
export function useOpenFromQuery(key: string, open: () => void) {
  const route = useRoute()
  const router = useRouter()
  onMounted(() => {
    watch(
      () => route.query[key],
      (value) => {
        if (value === undefined) return
        const rest = { ...route.query }
        delete rest[key]
        void router.replace({ query: rest })
        open()
      },
      { immediate: true },
    )
  })
}
