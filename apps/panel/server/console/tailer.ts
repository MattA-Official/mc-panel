import { open, stat } from 'node:fs/promises'

export interface TailerOptions {
  /** How often to check the file; 0 never does, and the caller calls tick() when it changes. */
  pollMs?: number
  /** How much of the end of the file to replay on start. */
  seedBytes?: number
}

/**
 * Follows a log file by polling its size and inode. Survives Minecraft rotating
 * `latest.log` (new inode) and truncation (size goes down), and never emits half a line.
 */
export class LogTailer {
  private offset = 0
  private ino: number | null = null
  private partial = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private reading: Promise<void> | null = null
  /** Asked to read while a read was running, so read once more after it. */
  private again = false
  private decoder = new TextDecoder()

  constructor(
    private path: string,
    private onLines: (lines: string[]) => void,
    private opts: TailerOptions = {},
  ) {}

  async start() {
    await this.seed()
    if (this.opts.pollMs === 0) return
    this.timer = setInterval(() => void this.tick(), this.opts.pollMs ?? 500)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Reads anything new. A call made while a read is running doesn't start a second one, but
   * it does make that read look again once it's done: the file may have grown after the
   * running read checked its size. Minecraft writes "logged in" and "joined the game" a
   * moment apart, so without this the join could sit unread until the next line.
   */
  tick(): Promise<void> {
    if (this.reading) {
      this.again = true
      return this.reading
    }
    this.reading = (async () => {
      do {
        this.again = false
        await this.read()
      } while (this.again)
    })().finally(() => (this.reading = null))
    return this.reading
  }

  private async seed() {
    const st = await stat(this.path).catch(() => null)
    if (!st) return
    this.ino = st.ino
    const from = Math.max(0, st.size - (this.opts.seedBytes ?? 64 * 1024))
    const text = await this.readRange(from, st.size)
    this.offset = st.size
    // Starting mid-file means the first line is probably cut; drop it.
    this.emit(from > 0 ? text.slice(text.indexOf('\n') + 1) : text)
  }

  private async read() {
    const st = await stat(this.path).catch(() => null)
    if (!st) return
    if (this.ino !== st.ino || st.size < this.offset) {
      // Rotated or truncated: what's there now is all new.
      this.ino = st.ino
      this.offset = 0
      this.partial = ''
      this.decoder = new TextDecoder()
    }
    if (st.size === this.offset) return
    const text = await this.readRange(this.offset, st.size)
    this.offset = st.size
    this.emit(text)
  }

  private async readRange(from: number, to: number): Promise<string> {
    const fh = await open(this.path, 'r')
    try {
      const buf = new Uint8Array(to - from)
      const { bytesRead } = await fh.read(buf, 0, buf.length, from)
      return this.decoder.decode(buf.subarray(0, bytesRead), { stream: true })
    } finally {
      await fh.close()
    }
  }

  private emit(text: string) {
    const parts = (this.partial + text).split('\n')
    this.partial = parts.pop() ?? ''
    const lines = parts.map((l) => l.replace(/\r$/, ''))
    if (lines.length) this.onLines(lines)
  }
}
