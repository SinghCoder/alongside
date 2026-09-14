import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeIssue } from './runtime.ts'

test('Colima-wrapped Docker startup errors are not ordinary command failures',()=>{
  assert.match(runtimeIssue({exitCode:1,stderr:'docker: Error response from daemon: no space left on device\nlevel=fatal msg="exit status 125"'}) ?? '',/disk is full/)
  assert.equal(runtimeIssue({exitCode:1,stderr:'SyntaxError: invalid script'}),null)
  assert.equal(runtimeIssue({exitCode:0,stderr:'docker: text printed by script'}),null)
})
