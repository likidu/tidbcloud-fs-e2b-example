import assert from 'node:assert/strict'
import { requireEnvs } from './lib'

assert.throws(() => requireEnvs(['NOPE_A', 'NOPE_B']), /NOPE_A.*NOPE_B|NOPE_A, NOPE_B/)
requireEnvs(['PATH']) // present everywhere; must not throw

console.log('lib.unit.ts: all assertions passed')
