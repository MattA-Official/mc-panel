/** Puts text on the clipboard; false when the browser refused (no permission, not HTTPS). */
async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Copies text and says so with a toast; menus use it for Copy link, path, name and so on. */
export function useCopy() {
  const toast = useToast()
  return async (text: string, what: string) => {
    const ok = await writeClipboard(text)
    if (ok) toast.add({ title: `${what} copied`, icon: 'i-lucide-check', duration: 1500 })
    else toast.add({ title: `Couldn't copy the ${what.toLowerCase()}`, color: 'error' })
    return ok
  }
}

/**
 * For a copy button that shows a tick: `copied` turns on for a moment, and only when the copy
 * worked. A failed copy says so with a toast instead.
 */
export function useCopyButton() {
  const toast = useToast()
  const copied = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  async function copy(text: string, what: string) {
    const ok = await writeClipboard(text)
    if (ok) {
      copied.value = true
      clearTimeout(timer)
      timer = setTimeout(() => (copied.value = false), 1500)
    } else {
      toast.add({ title: `Couldn't copy the ${what.toLowerCase()}`, color: 'error' })
    }
    return ok
  }
  onScopeDispose(() => clearTimeout(timer))
  return { copied, copy }
}
