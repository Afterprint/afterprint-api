import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Module,Controller,All,Req,Res,HttpException} from '@nestjs/common';
import {FastifyAdapter,NestFastifyApplication} from '@nestjs/platform-fastify';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import {z} from 'zod';
import {randomUUID,randomBytes} from 'node:crypto';
import {db} from './database';
import {roles,permitted,sha256,chain,mediaType,canonical,validateClaims,generateNonce,verifyStellarSignature} from './domain';
import {uploadUrl,inspect,readUrl} from './storage';
const max=Number(process.env.MAX_UPLOAD_BYTES||104857600);
const CHALLENGE_PREFIX='Afterprint authentication challenge: ';
const CHALLENGE_TTL_MS=5*60*1000;
const schemas={
  case:z.object({title:z.string().min(1).max(160),ref:z.string().min(1).max(60),classification:z.enum(['INTERNAL','CONFIDENTIAL','RESTRICTED'])}).strict(),
  upload:z.object({title:z.string().min(1).max(200),source:z.string().min(1).max(2000),mimeType:z.enum(['video/mp4','video/webm','audio/wav','audio/mpeg','audio/mp4','image/jpeg','image/png','application/pdf','text/plain','text/csv','application/json']),size:z.number().int().positive().max(max)}).strict(),
  member:z.object({userId:z.string().uuid(),role:z.enum(roles)}).strict(),
};
function fail(status:number,message:string):never{throw new HttpException(message,status)}
async function auth(req:any){
  const token=req.cookies?.afterprint_session;
  if(!token)fail(401,'Sign in required');
  const session=await db.session.findUnique({where:{id:sha256(token)},include:{user:true}});
  if(!session||session.expiresAt<new Date()||!session.user.active)fail(401,'Session expired');
  return session.user;
}
async function access(req:any,caseId:string,capability:string){
  const user=await auth(req);
  const member=await db.caseMember.findUnique({where:{caseId_userId:{caseId,userId:user.id}},include:{case:true}});
  if(!member?.active||member.case.organizationId!==user.organizationId||!permitted(member.role,capability))fail(403,'Case permission denied');
  await db.accessEvent.create({data:{caseId,userId:user.id,action:`${req.method} ${req.routeOptions?.url||req.url.split('?')[0]}`,resourceType:'CASE',resourceId:caseId,requestId:req.id}});
  return {user,member};
}
async function item(caseId:string,id:string){
  const e=await db.evidenceItem.findFirst({where:{id,caseId},include:{versions:true}});
  if(!e)fail(404,'Evidence not found');
  return e;
}
async function record(caseId:string,id:string,kind:string){
  const r=await db.record.findFirst({where:{caseId,id,kind}});
  if(!r)fail(404,'Record not found');
  return r;
}
async function evidenceList(caseId:string){
  const items=await db.evidenceItem.findMany({where:{caseId},include:{versions:{orderBy:{version:'desc'},take:1}},orderBy:{ref:'asc'}});
  return items.map(e=>{
    const v=e.versions[0];
    return {id:e.id,ref:e.ref,title:e.title,type:e.type,source:e.source,status:e.status,versionId:v?.id||'',sha256:v?.sha256||'',size:v?.size||0,mimeType:v?.mimeType||'',importedAt:v?.importedAt||null};
  });
}
async function ai(caseId:string,operation:string,extra:object={}){
  const artifacts=await db.derivedArtifact.findMany({where:{version:{evidence:{caseId}}}});
  const sources=[];
  for(const artifact of artifacts.filter(a=>a.type==='AI_JSON')){
    const r=await db.record.findFirst({where:{caseId,kind:`analysis:${artifact.versionId}`}});
    if(r)sources.push(r.data);
  }
  const response=await fetch(`${process.env.AI_URL}/internal/v1/${operation}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.AI_SERVICE_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({caseId,sources,...extra}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)fail(502,'Evidence analysis service unavailable');
  return response.json() as Promise<any>;
}
async function appendCustody(tx:any,versionId:string,actor:string,type:string,reason:string,key:string,toUserId?:string){
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',versionId);
  const old=await tx.custodyEvent.findUnique({where:{idempotencyKey:key}});
  if(old)return old;
  const previous=await tx.custodyEvent.findFirst({where:{versionId},orderBy:[{occurredAt:'desc'},{id:'desc'}]});
  const event={id:randomUUID(),versionId,actor,type,reason,toUserId:toUserId||null,occurredAt:new Date().toISOString()};
  return tx.custodyEvent.create({data:{...event,previousHash:previous?.eventHash||'',eventHash:chain(previous?.eventHash||'',event),idempotencyKey:key}});
}
@Controller('v1')
class ApiController {
  @All('*') async handle(@Req() req:any,@Res() reply:any){
    try{
      if(!['GET','HEAD'].includes(req.method)&&req.headers['x-afterprint-request']!=='1')fail(403,'Missing request origin protection');
      const origin=req.headers.origin;
      if(origin&&origin!==process.env.WEB_ORIGIN)fail(403,'Origin denied');
      const path=req.url.split('?')[0].replace(/^\/v1\/?/,'').split('/');
      const method=req.method;
      const body=req.body||{};
      const [root,caseId,section,id,op]=path;

      // Health
      if(root==='health')return reply.send({status:'ok',schemaVersion:'1.0'});

      // Auth — Freighter wallet challenge-response
      if(root==='auth'){
        if(caseId==='challenge'&&method==='POST'){
          const {publicKey}=z.object({publicKey:z.string().min(40).max(60)}).strict().parse(body);
          // Clean up expired challenges for this key
          await db.authChallenge.deleteMany({where:{publicKey,expiresAt:{lt:new Date()}}});
          const nonce=randomBytes(32).toString('hex');
          await db.authChallenge.create({data:{publicKey,nonce,expiresAt:new Date(Date.now()+CHALLENGE_TTL_MS)}});
          return reply.send({challenge:`${CHALLENGE_PREFIX}${nonce}`});
        }
        if(caseId==='verify'&&method==='POST'){
          const {publicKey,signature}=z.object({publicKey:z.string().min(40).max(60),signature:z.string().min(1).max(512)}).strict().parse(body);
          const challenge=await db.authChallenge.findFirst({where:{publicKey,expiresAt:{gt:new Date()}},orderBy:{expiresAt:'desc'}});
          if(!challenge)fail(401,'No valid challenge found — request a new one');
          const challengeText=`${CHALLENGE_PREFIX}${challenge.nonce}`;
          if(!verifyStellarSignature(publicKey,challengeText,signature))fail(401,'Signature verification failed');
          // Delete used challenge
          await db.authChallenge.delete({where:{id:challenge.id}});
          // Upsert user — first wallet connection auto-provisions a personal org + user
          let user=await db.user.findUnique({where:{stellarPublicKey:publicKey}});
          if(!user){
            const org=await db.organization.create({data:{name:`Personal — ${publicKey.slice(0,8)}`}});
            user=await db.user.create({data:{stellarPublicKey:publicKey,organizationId:org.id,name:publicKey.slice(0,8)}});
          }
          if(!user.active)fail(403,'Account is deactivated');
          const token=randomBytes(32).toString('hex');
          await db.session.create({data:{id:sha256(token),userId:user.id,expiresAt:new Date(Date.now()+8*3600000)}});
          reply.setCookie('afterprint_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:28800});
          return reply.send({id:user.id,name:user.name,publicKey:user.stellarPublicKey});
        }
        if(caseId==='logout'&&method==='POST'){
          const token=req.cookies?.afterprint_session;
          if(token)await db.session.deleteMany({where:{id:sha256(token)}});
          reply.clearCookie('afterprint_session',{path:'/'});
          return reply.code(204).send();
        }
        if(caseId==='me'&&method==='GET'){
          const user=await auth(req);
          return reply.send({id:user.id,name:user.name,publicKey:user.stellarPublicKey,organizationId:user.organizationId});
        }
      }

      if(root!=='cases')fail(404,'Route not found');

      // Cases list / create
      if(!caseId){
        const user=await auth(req);
        if(method==='GET')return reply.send(await db.case.findMany({where:{organizationId:user.organizationId,members:{some:{userId:user.id,active:true}}},orderBy:{openedAt:'desc'}}));
        if(method==='POST'){
          const data=schemas.case.parse(body);
          return reply.code(201).send(await db.case.create({data:{...data,organizationId:user.organizationId,members:{create:{userId:user.id,role:'CASE_ADMIN'}}}}));
        }
        fail(405,'Method not allowed');
      }

      const permission=section==='members'?'CASE_ADMIN':section==='exports'?'EVIDENCE_EXPORT':section==='conversations'?'AI_QUERY':section==='attestations'?'ATTEST':section==='reconstructions'?(op==='finalize'||op==='review'?'RECONSTRUCTION_FINALIZE':method==='GET'?'CASE_VIEW':'RECONSTRUCTION_CREATE'):section==='conflicts'&&method==='PATCH'?'RECONSTRUCTION_CREATE':section==='evidence'?(id==='upload-url'||id==='finalize'?'EVIDENCE_UPLOAD':op==='custody'&&path[5]==='transfer'?'CUSTODY_TRANSFER':'EVIDENCE_VIEW'):method==='PATCH'&&!section?'CASE_ADMIN':'CASE_VIEW';
      const {user,member}=await access(req,caseId,permission);

      // Case detail
      if(!section){
        if(method==='GET')return reply.send(member.case);
        if(method==='PATCH'){
          const data=z.object({title:z.string().min(1).max(160).optional(),status:z.enum(['OPEN','CLOSED','ARCHIVED']).optional()}).strict().parse(body);
          return reply.send(await db.case.update({where:{id:caseId},data}));
        }
      }

      // Members
      if(section==='members'){
        if(method==='GET'){
          const members=await db.caseMember.findMany({where:{caseId,active:true},include:{user:true}});
          return reply.send(members.map(m=>({id:m.id,userId:m.userId,name:m.user.name,role:m.role})));
        }
        if(method==='POST'){
          const data=schemas.member.parse(body);
          const target=await db.user.findFirst({where:{id:data.userId,organizationId:user.organizationId,active:true}});
          if(!target)fail(400,'User must be an active organization member');
          return reply.code(201).send(await db.caseMember.upsert({where:{caseId_userId:{caseId,userId:data.userId}},create:{...data,caseId},update:{role:data.role,active:true}}));
        }
        if(id&&['PATCH','DELETE'].includes(method)){
          const target=await db.caseMember.findFirst({where:{id,caseId}});
          if(!target)fail(404,'Member not found');
          if(target.userId===user.id)fail(400,'Ask another case administrator to change your own membership');
          const data=method==='DELETE'?{active:false}:z.object({role:z.enum(roles)}).strict().parse(body);
          return reply.send(await db.caseMember.update({where:{id},data}));
        }
      }

      // Evidence
      if(section==='evidence'){
        if(!id&&method==='GET')return reply.send(await evidenceList(caseId));
        if(id==='upload-url'&&method==='POST'){
          const data=schemas.upload.parse(body);
          const sessionId=randomUUID(),evidenceId=randomUUID(),key=`originals/${caseId}/${evidenceId}/${randomUUID()}`;
          await db.evidenceItem.create({data:{id:evidenceId,caseId,ref:`E-${evidenceId.slice(0,8)}`,title:data.title,source:data.source,type:mediaType(data.mimeType),custodianId:user.id,uploads:{create:{id:sessionId,objectKey:key,expectedSize:data.size,mimeType:data.mimeType,expiresAt:new Date(Date.now()+300000)}}}});
          return reply.send({sessionId,...await uploadUrl(key,data.mimeType)});
        }
        if(id==='finalize'&&method==='POST'){
          const {sessionId}=z.object({sessionId:z.string().uuid()}).strict().parse(body);
          const session=await db.uploadSession.findUnique({where:{id:sessionId},include:{evidence:{include:{versions:true}}}});
          if(!session||session.evidence.caseId!==caseId)fail(404,'Upload session not found');
          if(session.status==='FINALIZED')return reply.send({id:session.evidence.id,versionId:session.evidence.versions[0]?.id});
          if(session.expiresAt<new Date())fail(410,'Upload session expired');
          const object=await inspect(session.objectKey);
          if(object.size!==session.expectedSize||object.mimeType!==session.mimeType)fail(400,'Stored object does not match upload metadata');
          const version=await db.$transaction(async tx=>{
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',sessionId);
            const previous=await tx.evidenceVersion.findUnique({where:{objectKey:session.objectKey}});
            if(previous)return previous;
            const v=await tx.evidenceVersion.create({data:{evidenceId:session.evidenceId,objectKey:session.objectKey,...object}});
            await appendCustody(tx,v.id,user.id,'IMPORTED','Immutable original imported',`ingest-${sessionId}`);
            await tx.uploadSession.update({where:{id:sessionId},data:{status:'FINALIZED'}});
            await tx.evidenceItem.update({where:{id:session.evidenceId},data:{status:'QUARANTINED'}});
            await tx.outbox.create({data:{id:`process-${v.id}`,queue:'evidence-process',data:{caseId,versionId:v.id,actorId:user.id}}});
            return v;
          });
          return reply.send({id:session.evidenceId,versionId:version.id});
        }
        const e=await item(caseId,id);
        const v=e.versions[0];
        if(!op&&method==='GET')return reply.send((await evidenceList(caseId)).find(x=>x.id===id));
        if(!v)fail(409,'Evidence upload is incomplete');
        if(op==='content'&&method==='GET'){
          if(e.status==='QUARANTINED'||e.status==='REJECTED')fail(423,'Evidence awaits a successful malware scan');
          return reply.send({url:await readUrl(v.objectKey,v.objectVersionId)});
        }
        if(op==='integrity-check'&&method==='POST'){
          const object=await inspect(v.objectKey,v.objectVersionId);
          const valid=object.sha256===v.sha256&&object.objectVersionId===v.objectVersionId&&object.size===v.size;
          await db.$transaction(tx=>appendCustody(tx,v.id,user.id,'INTEGRITY_CHECKED',valid?'Bytes match recorded hash':'INTEGRITY FAILURE',`check-${randomUUID()}`));
          return reply.send({valid,sha256:object.sha256});
        }
        if(op==='custody'&&method==='GET')return reply.send(await db.custodyEvent.findMany({where:{versionId:v.id},orderBy:{occurredAt:'asc'}}));
        if(op==='custody'&&path[5]==='transfer'&&method==='POST'){
          const data=z.object({toUserId:z.string().uuid(),reason:z.string().min(5).max(2000)}).strict().parse(body);
          const key=z.string().uuid().parse(req.headers['idempotency-key']);
          const target=await db.caseMember.findUnique({where:{caseId_userId:{caseId,userId:data.toUserId}}});
          if(!target?.active)fail(400,'Recipient is not an active case member');
          const result=await db.$transaction(async tx=>{
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',v.id);
            const prior=await tx.custodyEvent.findUnique({where:{idempotencyKey:key}});
            if(prior){
              if(prior.versionId!==v.id||prior.actor!==user.id||prior.toUserId!==data.toUserId||prior.reason!==data.reason)fail(409,'Idempotency key reused with different operation');
              return prior;
            }
            const fresh=await tx.evidenceItem.findUnique({where:{id:e.id}});
            if(fresh?.custodianId!==user.id&&member.role!=='CASE_ADMIN')fail(403,'Only current custodian or case administrator can transfer');
            const event=await appendCustody(tx,v.id,user.id,'TRANSFERRED',data.reason,key,data.toUserId);
            await tx.evidenceItem.update({where:{id:e.id},data:{custodianId:data.toUserId}});
            return event;
          });
          return reply.send(result);
        }
      }

      // Case-level custody history
      if(section==='custody'&&method==='GET'){
        const entries=await db.custodyEvent.findMany({where:{version:{evidence:{caseId}}},include:{version:true},orderBy:{occurredAt:'asc'}});
        return reply.send(entries.map(e=>({...e,evidenceId:e.version.evidenceId})));
      }

      // Timeline / graph / conflicts
      if(['timeline','graph','conflicts'].includes(section)&&method==='GET'){
        const r=await db.record.findMany({where:{caseId,kind:section},orderBy:{createdAt:'asc'}});
        if(section==='graph')return reply.send(r.at(-1)?.data||{nodes:[],edges:[]});
        return reply.send(r.flatMap(x=>Array.isArray(x.data)?x.data:[{...(x.data as object),id:x.id}]));
      }
      if(section==='conflicts'&&id&&method==='PATCH'){
        const data=z.object({status:z.enum(['OPEN','REVIEWED','RESOLVED','EXPECTED'])}).strict().parse(body);
        const r=await record(caseId,id,'conflicts');
        await db.record.create({data:{caseId,kind:'conflict-review',data:{conflictId:id,prior:r.data,status:data.status,reviewer:user.id}}});
        return reply.send(await db.record.update({where:{id},data:{data:{...(r.data as object),...data},revision:{increment:1}}}));
      }

      // Conversations / Ask
      if(section==='conversations'){
        if(!id&&method==='POST')return reply.code(201).send(await db.record.create({data:{caseId,kind:'conversation',data:{owner:user.id}}}));
        if(id&&op==='messages'&&method==='POST'){
          const c=await record(caseId,id,'conversation');
          if((c.data as any).owner!==user.id)fail(403,'Conversation is private');
          const {message}=z.object({message:z.string().min(1).max(4000)}).strict().parse(body);
          const answer=await ai(caseId,'query',{query:message});
          const versions=new Set((await evidenceList(caseId)).map(e=>e.versionId));
          validateClaims(answer.claims,versions);
          await db.record.create({data:{caseId,kind:'message',data:{conversationId:id,query:message,answer}}});
          return reply.send(answer);
        }
      }

      // Reconstructions
      if(section==='reconstructions'){
        if(!id&&method==='POST'){
          const answer=await ai(caseId,'reconstruct');
          const versions=await evidenceList(caseId);
          validateClaims(answer.claims,new Set(versions.map(e=>e.versionId)));
          const r=await db.record.create({data:{caseId,kind:'reconstruction',data:{status:'DRAFT',claims:answer.claims,reviewedIds:[],sourceManifest:versions.map(e=>({evidenceId:e.id,versionId:e.versionId,sha256:e.sha256}))}}});
          return reply.code(201).send({id:r.id,...r.data as object});
        }
        if(id){
          const r=await record(caseId,id,'reconstruction');
          if(!op&&method==='GET')return reply.send({id,...r.data as object});
          if(method==='POST'&&(op==='review'||op==='finalize')){
            const updated=await db.$transaction(async tx=>{
              await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',id);
              const fresh=await tx.record.findUniqueOrThrow({where:{id}});
              const data=fresh.data as any;
              if(data.status==='FINALIZED')return fresh;
              if(op==='review'){
                const input=z.object({reviewedIds:z.array(z.string()).max(10000)}).strict().parse(body);
                if(input.reviewedIds.some(x=>!data.claims.some((c:any)=>c.id===x)))fail(400,'Unknown reviewed claim');
                data.reviewedIds=[...new Set(input.reviewedIds)];
                data.reviewer=user.id;
              }else{
                if(!data.sourceManifest?.length||!data.claims.length||data.reviewer!==user.id||data.claims.some((c:any)=>!data.reviewedIds.includes(c.id)))fail(409,'Review every claim before finalization');
                data.reportHash=sha256(canonical(data));
                data.status='FINALIZED';
                data.finalizedAt=new Date().toISOString();
              }
              return tx.record.update({where:{id},data:{data,revision:{increment:1}}});
            });
            return reply.send({id,...updated.data as object});
          }
        }
      }

      // Exports
      if(section==='exports'){
        if(!id&&method==='POST'){
          const r=await db.$transaction(async tx=>{
            const r=await tx.record.create({data:{caseId,kind:'export',data:{status:'QUEUED',actorId:user.id}}});
            await tx.outbox.create({data:{id:`export-${r.id}`,queue:'export-build',data:{caseId,exportId:r.id,actorId:user.id}}});
            return r;
          });
          return reply.code(202).send({id:r.id,status:'QUEUED'});
        }
        if(id&&method==='GET'){
          const r=await record(caseId,id,'export');
          const data=r.data as any;
          return reply.send({id,...data,...(data.objectKey?{url:await readUrl(data.objectKey,data.objectVersionId)}:{})});
        }
      }

      // Attestations
      if(section==='attestations'&&method==='POST'){
        const input=z.object({subjectRef:z.string().uuid(),statementHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(body);
        const subject=await record(caseId,input.subjectRef,'reconstruction');
        if((subject.data as any).status!=='FINALIZED'||(subject.data as any).reportHash!==input.statementHash)fail(409,'Attestation must reference the exact finalized report hash');
        return reply.code(201).send(await db.record.create({data:{caseId,kind:'attestation',data:{...input,issuer:user.id,status:'PENDING_CHAIN'}}}));
      }

      fail(404,'Route not found');
    }catch(error){
      if(error instanceof (await import('zod')).ZodError)return reply.code(400).send({message:'Invalid request',issues:(error as any).issues.map((i:any)=>({path:i.path,message:i.message}))});
      if(error instanceof HttpException)return reply.code(error.getStatus()).send({message:error.message});
      req.log.error({errType:(error as Error).name,requestId:req.id},'Request failed');
      return reply.code(500).send({message:'Operation failed; contact the administrator with request ID '+req.id});
    }
  }
}
@Module({controllers:[ApiController]}) class AppModule{}
async function bootstrap(){
  for(const key of ['DATABASE_URL','WEB_ORIGIN','AI_URL','AI_SERVICE_TOKEN'])if(!process.env[key])throw new Error(`Missing ${key}`);
  const app=await NestFactory.create<NestFastifyApplication>(AppModule,new FastifyAdapter({logger:{redact:['req.headers.cookie','req.headers.authorization','req.body','res.headers.set-cookie']},bodyLimit:1024*1024}));
  await app.register(cookie as any);
  await app.register(rateLimit as any,{max:120,timeWindow:'1 minute'});
  app.enableCors({origin:process.env.WEB_ORIGIN,credentials:true,allowedHeaders:['Content-Type','X-Afterprint-Request','Idempotency-Key']});
  // OpenAPI
  const config=new DocumentBuilder().setTitle('Afterprint API').setDescription('Evidence intelligence platform API v1').setVersion('1.0').addCookieAuth('afterprint_session').build();
  const document=SwaggerModule.createDocument(app,config);
  SwaggerModule.setup('docs',app,document);
  await app.listen(Number(process.env.PORT||4000),process.env.HOST||'0.0.0.0');
  console.log(JSON.stringify({event:'api_started',port:process.env.PORT||4000,docs:`http://localhost:${process.env.PORT||4000}/docs`}));
}
if(require.main===module)bootstrap();
export {ApiController,AppModule,appendCustody};
