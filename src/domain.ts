import {createHash,scryptSync,randomBytes,timingSafeEqual} from 'node:crypto';
export const roles=['CASE_ADMIN','INVESTIGATOR','FORENSIC_ANALYST','LEGAL_REVIEWER','EXTERNAL_REVIEWER','READ_ONLY'] as const;
export type Role=typeof roles[number];
const basic=['CASE_VIEW','EVIDENCE_VIEW'];
export const capabilities:Record<Role,string[]>={CASE_ADMIN:[...basic,'EVIDENCE_UPLOAD','EVIDENCE_EXPORT','CUSTODY_TRANSFER','AI_QUERY','RECONSTRUCTION_CREATE','RECONSTRUCTION_FINALIZE','ATTEST','CASE_ADMIN'],INVESTIGATOR:[...basic,'EVIDENCE_UPLOAD','CUSTODY_TRANSFER','AI_QUERY','RECONSTRUCTION_CREATE'],FORENSIC_ANALYST:[...basic,'EVIDENCE_UPLOAD','AI_QUERY','RECONSTRUCTION_CREATE'],LEGAL_REVIEWER:[...basic,'AI_QUERY','EVIDENCE_EXPORT','RECONSTRUCTION_FINALIZE','ATTEST'],EXTERNAL_REVIEWER:[...basic],READ_ONLY:basic};
export function permitted(role:string,capability:string){return (capabilities[role as Role]||[]).includes(capability)}
export function canonical(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`}
export function sha256(data:string|Buffer){return createHash('sha256').update(data).digest('hex')}
export function chain(previous:string,event:unknown){return sha256(previous+canonical(event))}
export function passwordHash(password:string){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`}
export function verifyPassword(password:string,encoded:string){const [salt,hash]=encoded.split(':');if(!salt||!hash)return false;const expected=Buffer.from(hash,'hex');const actual=scryptSync(password,salt,64);return expected.length===actual.length&&timingSafeEqual(expected,actual)}
export function mediaType(mime:string){return mime.startsWith('video/')?'VIDEO':mime.startsWith('audio/')?'AUDIO':mime.startsWith('image/')?'IMAGE':'DOCUMENT'}
export const categories=['VERIFIED_FACT','CORROBORATED_CLAIM','INFERENCE','CONFLICT','UNKNOWN'] as const;
export function validateClaims(claims:any[],versions:Set<string>){for(const c of claims){if(!categories.includes(c.category))throw new Error('Invalid claim category');if(['VERIFIED_FACT','CORROBORATED_CLAIM','CONFLICT'].includes(c.category)&&!c.citations?.length)throw new Error('Grounded claim missing citation');for(const ref of c.citations||[])if(!versions.has(ref.versionId)||!ref.span)throw new Error('Invalid citation');if(c.category==='CORROBORATED_CLAIM'&&new Set(c.citations.map((r:any)=>r.versionId)).size<2)throw new Error('Corroboration requires distinct sources');}return claims}
