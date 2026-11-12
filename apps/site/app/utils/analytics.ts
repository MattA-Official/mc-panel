// Cloudflare Web Analytics is cookieless. It loads only when a token is configured, the visitor
// hasn't switched it off on the privacy page, and their browser doesn't send Global Privacy Control.
export const ANALYTICS_OPT_OUT_KEY = 'flytower-analytics-opt-out'

export function globalPrivacyControl(): boolean {
  return !!(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
}

export function analyticsOptedOut(): boolean {
  try {
    return localStorage.getItem(ANALYTICS_OPT_OUT_KEY) === '1'
  } catch {
    return false
  }
}

export function setAnalyticsOptOut(optOut: boolean) {
  try {
    if (optOut) localStorage.setItem(ANALYTICS_OPT_OUT_KEY, '1')
    else localStorage.removeItem(ANALYTICS_OPT_OUT_KEY)
  } catch {
    // Storage blocked: nothing to remember, and the beacon is already off for this page view.
  }
}
