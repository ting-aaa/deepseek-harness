import { describe, expect, it } from 'vitest'
import { boundWasmMemory } from '../src/wasi-memory.ts'

describe('interpreter linear memory', () => {
  const module = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0])

  it('lets the WebAssembly engine enforce growth against the rewritten maximum', async () => {
    const { instance } = await WebAssembly.instantiate(boundWasmMemory(module, 2 * 65_536))
    const memory = instance.exports.memory
    expect(memory).toBeInstanceOf(WebAssembly.Memory)
    if (!(memory instanceof WebAssembly.Memory)) throw new Error('Missing fixture memory')
    expect(memory.grow(1)).toBe(1)
    expect(() => memory.grow(1)).toThrow(RangeError)
  })

  it('rejects unsupported layouts and limits smaller than initial memory', () => {
    expect(() => boundWasmMemory(module, 1)).toThrow(RangeError)
    expect(() => boundWasmMemory(new Uint8Array(8), 65_536)).toThrow(TypeError)
    const oversized = module.slice()
    oversized[12] = 3
    expect(() => boundWasmMemory(oversized, 65_536)).toThrow(RangeError)
  })
})
