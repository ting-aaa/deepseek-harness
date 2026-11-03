/** Pinned portable interpreter distribution shared by build and runtime validation. @module */

/** Immutable distribution identity; application execution never downloads interpreters. */
export const PYTHON_WASI_ASSET = {
  name: 'cpython-wasi-3.13.11.zip',
  url: 'https://github.com/brettcannon/cpython-wasi-build/releases/download/v3.13.11/python-3.13.11-wasi_sdk-24.zip',
  sha256: 'e99a617738ade87cd263aa46cace7173faa91b5de994499c83e49d132c40bb77',
  bytes: 13_706_729,
} as const
