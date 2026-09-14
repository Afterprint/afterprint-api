import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonical,sha256,chain,validateClaims} from '../src/domain';

test('sha256(canonical(x)) is deterministic',()=>{
  const x={b:2,a:[1,{z:9,y:8}],c:'text'};
  assert.equal(sha256(canonical(x)),sha256(canonical(x)));
});

test('chain(prev,event) changes when event changes',()=>{
  const prev=chain('',{type:'IMPORTED'});
  assert.notEqual(chain(prev,{type:'TRANSFERRED'}),chain(prev,{type:'REVIEWED'}));
});

test('validateClaims throws when a grounded claim has no citations',()=>{
  assert.throws(()=>validateClaims([{category:'VERIFIED_FACT',citations:[]}],new Set(['v1'])));
});

test('validateClaims throws when CORROBORATED_CLAIM has only one distinct versionId',()=>{
  assert.throws(()=>validateClaims([{category:'CORROBORATED_CLAIM',citations:[{versionId:'v1',span:'p1'},{versionId:'v1',span:'p2'}]}],new Set(['v1'])));
});
