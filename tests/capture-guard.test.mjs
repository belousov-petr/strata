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

import { Buffer } from 'node:buffer'

test('scanChunk computes the next offset from raw bytes, not the decoded string', () => {
  // "xé\nabc\n" is 8 bytes (é = 2 bytes); the old code overshot to 10.
  const buf = Buffer.from('xé\nabc\n', 'utf8')
  const r = guard.scanChunk(buf, 0)
  assert.equal(r.text, 'xé\nabc\n')
  assert.equal(r.newOffset, 8)
})

test('scanChunk resumes from a mid-file line boundary', () => {
  const full = Buffer.from('xé\nabc\ndef\n', 'utf8') // 12 bytes
  const r = guard.scanChunk(full.subarray(8), 8)
  assert.equal(r.text, 'def\n')
  assert.equal(r.newOffset, 12)
})

test('scanChunk never emits U+FFFD when the window ends mid-multibyte-char', () => {
  // "ab\n" + first byte of "é": the partial trailing char is after the last \n
  const buf = Buffer.concat([Buffer.from('ab\n', 'utf8'), Buffer.from([0xc3])])
  const r = guard.scanChunk(buf, 0)
  assert.equal(r.text, 'ab\n')
  assert.equal(r.newOffset, 3)
  assert.ok(!r.text.includes('�'))
})

test('scanChunk holds the offset when there is no complete line yet', () => {
  const r = guard.scanChunk(Buffer.from('no newline', 'utf8'), 5)
  assert.equal(r.text, '')
  assert.equal(r.newOffset, 5) // no bytes consumed → nothing skipped
})
