import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as guard from '../hooks/strata-capture-guard.mjs'

test('module exports the pure helpers and does not run main on import', () => {
  assert.equal(typeof guard.failureSignal, 'function')
  assert.equal(typeof guard.resultText, 'function')
  assert.equal(typeof guard.redact, 'function')
  assert.equal(guard.failureSignal('npm ERR! boom', false), 'npm ERR!')
  assert.equal(guard.failureSignal('all good', false), null)
})
