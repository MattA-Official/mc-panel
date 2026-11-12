import { keepRunningOnStrayErrors } from '../utils/process-errors'

// First of the plugins, so it covers everything the others start.
export default defineNitroPlugin(() => {
  keepRunningOnStrayErrors()
})
