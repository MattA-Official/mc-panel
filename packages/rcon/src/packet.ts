export const PacketType = {
  /** Replies from the server. */
  Response: 0,
  /** A command from us; also the server's answer to a login. */
  Command: 2,
  Auth: 3,
} as const

export interface Packet {
  id: number
  type: number
  body: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** length (excludes itself) · id · type · body · NUL · NUL, all little-endian. */
export function encodePacket(id: number, type: number, body: string): Uint8Array {
  const bytes = encoder.encode(body)
  const out = new Uint8Array(14 + bytes.length)
  const view = new DataView(out.buffer)
  view.setInt32(0, 10 + bytes.length, true)
  view.setInt32(4, id, true)
  view.setInt32(8, type, true)
  out.set(bytes, 12)
  return out
}

/** Largest packet we accept: Minecraft's 4096-byte bodies plus headroom. */
const MAX_LENGTH = 16 * 1024

/** Reassembles packets from a TCP stream, whatever the read boundaries. */
export class PacketParser {
  private buffer = new Uint8Array(0)

  push(chunk: Uint8Array): Packet[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length)
    merged.set(this.buffer)
    merged.set(chunk, this.buffer.length)
    this.buffer = merged

    const packets: Packet[] = []
    for (;;) {
      if (this.buffer.length < 4) break
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset)
      const length = view.getInt32(0, true)
      if (length < 10 || length > MAX_LENGTH) throw new Error(`bad RCON packet length ${length}`)
      if (this.buffer.length < 4 + length) break
      packets.push({
        id: view.getInt32(4, true),
        type: view.getInt32(8, true),
        body: decoder.decode(this.buffer.subarray(12, 4 + length - 2)),
      })
      this.buffer = this.buffer.slice(4 + length)
    }
    return packets
  }
}
