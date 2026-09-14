import { newAsyncContext } from 'quickjs-emscripten'

const MEMORY_BYTES = 32 * 1024 * 1024
const EXECUTION_MS = 2000
const OUTPUT_BYTES = 24000
const MAX_BRIDGE_CALLS = 200
const BOOTSTRAP = `
const call = (method, value) => {
  const reply = JSON.parse(__call(method, JSON.stringify(value ?? null)));
  if (reply.error) { throw new Error(reply.error); }
  return reply.result;
};
const board = Object.freeze({
  snapshot: () => call('snapshot'),
  capture: () => call('capture'),
  get: id => call('get', id),
  put: item => call('put', item),
  patch: (id, changes) => call('patch', {id, changes}),
  remove: id => call('remove', id),
  inspect: () => call('inspect'),
  present: caption => call('present', caption),
  discard: () => call('discard'),
});
const document = Object.freeze({
  list: () => call('document', {action:'list'}),
  read: id => call('document', {action:'read',id}),
  open: id => call('document', {action:'open',id}),
  create: (id,title) => call('document', {action:'create',id,title}),
  copy: (id,title,from) => call('document', {action:'copy',id,title,from}),
  rename: (id,title) => call('document', {action:'rename',id,title}),
});
const page = Object.freeze({ snapshot: () => call('page.snapshot'), evaluate: code => call('page.evaluate', code) });
let assetIndex;
Object.defineProperty(globalThis, 'ALL_ASSETS', {
  get: () => assetIndex ??= call('assets.catalog'),
});
let packIndex;
Object.defineProperty(globalThis, 'ALL_PACKS', {
  get: () => packIndex ??= call('assets.packs'),
});
const assets = Object.freeze({
  get: id => call('assets.get', id),
  read: (id, options = {}) => call('assets.read', {id, ...options}),
  search: query => call('assets.search', query),
  inspect: id => call('assets.inspect', id),
});
const images = Object.freeze({
  search: options => call('images.search', options),
  use: id => call('images.use', id),
});
const help = path => call('help', path);
`

// QuickJS exposes only the JSON bridge, not Node, the filesystem, or fetch.
export async function interpret(code: string, bridge: (method: string, value: unknown) => Promise<unknown>, signal: AbortSignal) {
  const vm = await newAsyncContext()
  let deadline = Date.now() + EXECUTION_MS
  let calls = 0
  vm.runtime.setMemoryLimit(MEMORY_BYTES)
  vm.runtime.setInterruptHandler(() => signal.aborted || calls > MAX_BRIDGE_CALLS || Date.now() > deadline)
  const callback = vm.newAsyncifiedFunction('__call', async (method, value) => {
    let reply
    try {
      signal.throwIfAborted()
      if (++calls > MAX_BRIDGE_CALLS) { throw new Error('Operation budget reached') }
      reply = { result: await bridge(vm.getString(method), JSON.parse(vm.getString(value))) }
    } catch (error) { reply = { error: error instanceof Error ? error.message : 'Operation failed' } }
    // User pauses and network waits do not consume the CPU time allowance.
    deadline = Date.now() + EXECUTION_MS
    return vm.newString(JSON.stringify(reply))
  })
  vm.setProp(vm.global, '__call', callback)
  callback.dispose()
  try {
    const result = await vm.evalCodeAsync(`${BOOTSTRAP}\nJSON.stringify((function(){\n${code}\n})() ?? null)`)
    if (result.error) {
      const error = vm.dump(result.error)
      result.error.dispose()
      throw new Error(error.message ?? 'Interpreter failed')
    }
    const output = vm.getString(result.value)
    result.value.dispose()
    if (output.length > OUTPUT_BYTES) { return { truncated: true, message: 'Return a smaller selection from the board or assets.' } }
    return JSON.parse(output)
  } finally { vm.dispose() }
}
