import test from 'node:test';
import assert from 'node:assert/strict';
import {isAppOrigin,HOSTED_ORIGIN,LOCAL_ORIGIN} from './origins.js';
test('page context is sent only to the hosted app or local development',()=>{
  assert.equal(isAppOrigin(HOSTED_ORIGIN),true);
  assert.equal(isAppOrigin(LOCAL_ORIGIN),true);
  assert.equal(isAppOrigin('https://evil.example.com'),false);
  assert.equal(isAppOrigin(HOSTED_ORIGIN+'.evil.example.com'),false);
  assert.equal(isAppOrigin('http://localhost.attacker.test'),false);
});
