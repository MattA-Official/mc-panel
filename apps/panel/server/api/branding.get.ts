/**
 * The install's name, colours, font and logo. Open to everyone: the sign-in page needs it
 * before anyone has signed in, and so will the public status page.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-cache')
  return useBranding().public()
})
