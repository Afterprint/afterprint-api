import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonical,sha256,chain,permitted,validateClaims} from '../src/domain';
test('canonical hashes do not depend on property insertion order',()=>{assert.equal(sha256(canonical({b:2,a:{d:4,c:3}})),sha256(canonical({a:{c:3,d:4},b:2})));assert.notEqual(sha256(canonical([1,2])),sha256(canonical([2,1])))});
test('byte modification changes integrity hash',()=>assert.notEqual(sha256(Buffer.from('original')),sha256(Buffer.from('origina1'))));
test('custody chain commits to previous event and current event',()=>{const first=chain('',{type:'IMPORTED'});const second=chain(first,{type:'TRANSFERRED'});assert.notEqual(second,chain('',{type:'TRANSFERRED'}));assert.notEqual(second,chain(first,{type:'EXPORTED'}))});
test('read only role cannot export, query or finalize',()=>{assert.equal(permitted('READ_ONLY','CASE_VIEW'),true);for(const c of ['EVIDENCE_EXPORT','AI_QUERY','RECONSTRUCTION_FINALIZE','CASE_ADMIN'])assert.equal(permitted('READ_ONLY',c),false);assert.equal(permitted('made-up-role','CASE_VIEW'),false)});
test('legal reviewer can finalize but cannot upload',()=>{assert.equal(permitted('LEGAL_REVIEWER','RECONSTRUCTION_FINALIZE'),true);assert.equal(permitted('LEGAL_REVIEWER','EVIDENCE_UPLOAD'),false)});
test('claims fail closed on missing or cross-case citations',()=>{assert.throws(()=>validateClaims([{category:'VERIFIED_FACT',citations:[]}],new Set()));assert.throws(()=>validateClaims([{category:'INFERENCE',citations:[{versionId:'secret-case',span:'p1'}]}],new Set(['v1'])));assert.throws(()=>validateClaims([{category:'CORROBORATED_CLAIM',citations:[{versionId:'v1',span:'p1'},{versionId:'v1',span:'p2'}]}],new Set(['v1'])))});
