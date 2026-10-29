/** Impose a linear-memory maximum on the pinned interpreter modules. @module */

/**
 * Replace the single wasm32 memory declaration's maximum before compilation.
 * @param input - Trusted interpreter bytes, verified against their distribution digest.
 * @param bytes - Maximum guest linear-memory bytes, rounded down to complete WASM pages.
 * @returns A module whose memory cannot grow beyond the supplied maximum.
 * @throws If the interpreter requires more initial memory or changes its memory layout.
 */
export function boundWasmMemory(input: Uint8Array, bytes: number): Uint8Array<ArrayBuffer> {
  const pages = Math.floor(bytes / 65_536)
  if (!Number.isSafeInteger(bytes) || pages < 1 || pages > 65_536) throw new RangeError('Invalid WASM memory ceiling')
  if (input.length < 8 || Buffer.from(input.subarray(0, 8)).toString('hex') !== '0061736d01000000') {
    throw new TypeError('Interpreter is not a supported WebAssembly module')
  }
  let cursor = 8
  const read = (): number => {
    let value = 0
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = input[cursor++]
      if (byte === undefined || (shift === 28 && byte > 15)) throw new TypeError('Invalid WASM section length')
      value += (byte & 127) * 2 ** shift
      if (!(byte & 128)) return value
    }
    throw new TypeError('Invalid WASM integer')
  }
  while (cursor < input.length) {
    const start = cursor
    const id = input[cursor++]
    const length = read()
    const end = cursor + length
    if (end > input.length) throw new TypeError('Incomplete WASM section')
    if (id !== 5) { cursor = end; continue }
    if (read() !== 1) throw new TypeError('Interpreter must declare one private memory')
    const flags = read()
    if (flags !== 0 && flags !== 1) throw new TypeError('Shared or memory64 interpreters are unsupported')
    const initial = read()
    const originalMaximum = flags === 1 ? read() : 65_536
    if (cursor !== end || initial > pages) throw new RangeError('Interpreter initial memory exceeds its configured ceiling')
    const encode = (value: number): number[] => {
      const result: number[] = []
      do {
        const byte = value & 127
        value = Math.floor(value / 128)
        result.push(byte | (value ? 128 : 0))
      } while (value)
      return result
    }
    const section = [1, 1, ...encode(initial), ...encode(Math.min(pages, originalMaximum))]
    const replacement = new Uint8Array([5, ...encode(section.length), ...section])
    const output = new Uint8Array(input.length - (end - start) + replacement.length)
    output.set(input.subarray(0, start))
    output.set(replacement, start)
    output.set(input.subarray(end), start + replacement.length)
    return output
  }
  throw new TypeError('Interpreter has no private memory declaration')
}
