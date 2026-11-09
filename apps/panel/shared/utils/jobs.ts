/** The create-server steps, in order. The progress view lists them; the runner reports them. */
export const CREATE_SERVER_STEPS = [
  'Checking the details',
  'Finding the download',
  'Installing Java',
  'Creating the server',
  'Downloading Minecraft',
  'Writing the config',
  'Starting the server',
] as const

export interface JobEvent {
  id: number
  state: 'queued' | 'running' | 'succeeded' | 'failed'
  step: string | null
  progress: number
  message: string | null
}
