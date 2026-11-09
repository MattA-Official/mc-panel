export { Rcon, RconError, MAX_COMMAND_BYTES, type RconOptions } from './client.ts'
export { encodePacket, PacketParser, PacketType, type Packet } from './packet.ts'

/** Strips Minecraft's § formatting codes from a reply or log line. */
export const stripFormatting = (text: string) => text.replace(/§[0-9a-fk-orx]/gi, '')
