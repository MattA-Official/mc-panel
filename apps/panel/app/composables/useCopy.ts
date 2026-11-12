/** Copies text and says so with a toast; menus use it for Copy link, path, name and so on. */
export function useCopy() {
  const toast = useToast()
  return async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({ title: `${what} copied`, icon: 'i-lucide-check', duration: 1500 })
    } catch {
      toast.add({ title: `Couldn't copy the ${what.toLowerCase()}`, color: 'error' })
    }
  }
}
