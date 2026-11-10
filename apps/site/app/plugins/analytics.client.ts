export default defineNuxtPlugin(() => {
  const token = useRuntimeConfig().public.cfAnalyticsToken
  if (!token || globalPrivacyControl() || analyticsOptedOut()) return
  const script = document.createElement('script')
  script.defer = true
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js'
  script.dataset.cfBeacon = JSON.stringify({ token })
  document.head.appendChild(script)
})
