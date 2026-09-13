/**
 * Seed — synthetic development data.
 * Run: pnpm tsx scripts/seed.ts
 * All data is fabricated. Never use real case evidence.
 */
import {PrismaClient} from '@prisma/client';
import {createHash,randomBytes} from 'node:crypto';
const db=new PrismaClient();
function sha256(s:string){return createHash('sha256').update(s).digest('hex')}

// Synthetic Stellar public keys (G... format, 56 chars, valid base32)
const SYNTH_KEYS={
  admin: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
  investigator: 'GBOVKZBEM2YYLOCDCUXJ4IMRKHN4LCJAE7WEAEA2KF562XFAGDBOB64T',
  analyst:      'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZAK7VQO8N7ZTO5KYI4AF',
  reviewer:     'GDFOHLMRJMAPFLY83ZJKJR3CGJMPKNG7JIFUVDNUJVVV4HQ7QW3BRNZD',
};

async function main(){
  console.log('Seeding synthetic development data…');

  // ── Organization ──────────────────────────────────────────────────────────
  const org=await db.organization.upsert({
    where:{id:'org-synthetic-001'},
    update:{},
    create:{id:'org-synthetic-001',name:'Synthetic Investigations Ltd'},
  });

  // ── Users (wallet addresses) ───────────────────────────────────────────────
  const admin=await db.user.upsert({
    where:{stellarPublicKey:SYNTH_KEYS.admin},
    update:{},
    create:{id:'user-admin-001',organizationId:org.id,stellarPublicKey:SYNTH_KEYS.admin,name:'Lead Investigator'},
  });
  const investigator=await db.user.upsert({
    where:{stellarPublicKey:SYNTH_KEYS.investigator},
    update:{},
    create:{id:'user-inv-001',organizationId:org.id,stellarPublicKey:SYNTH_KEYS.investigator,name:'Field Investigator'},
  });
  const analyst=await db.user.upsert({
    where:{stellarPublicKey:SYNTH_KEYS.analyst},
    update:{},
    create:{id:'user-ana-001',organizationId:org.id,stellarPublicKey:SYNTH_KEYS.analyst,name:'Forensic Analyst'},
  });
  const reviewer=await db.user.upsert({
    where:{stellarPublicKey:SYNTH_KEYS.reviewer},
    update:{},
    create:{id:'user-rev-001',organizationId:org.id,stellarPublicKey:SYNTH_KEYS.reviewer,name:'Legal Reviewer'},
  });

  // ── Case ──────────────────────────────────────────────────────────────────
  const existingCase=await db.case.findFirst({where:{id:'case-synthetic-001'}});
  const syntheticCase=existingCase||await db.case.create({
    data:{
      id:'case-synthetic-001',
      organizationId:org.id,
      ref:'AP-2026-001',
      title:'North Depot Delivery Incident — Synthetic',
      classification:'CONFIDENTIAL',
      status:'OPEN',
      members:{
        create:[
          {userId:admin.id,role:'CASE_ADMIN'},
          {userId:investigator.id,role:'INVESTIGATOR'},
          {userId:analyst.id,role:'FORENSIC_ANALYST'},
          {userId:reviewer.id,role:'LEGAL_REVIEWER'},
        ],
      },
    },
  });

  // ── Evidence items (metadata only — no real files) ─────────────────────────
  const evidenceSeeds=[
    {id:'ev-001',ref:'E-CCTV-001',title:'North entrance CCTV — Camera 04',source:'Depot security system extract — synthetic',type:'VIDEO',mimeType:'video/mp4'},
    {id:'ev-002',ref:'E-AUDIO-001',title:'Dispatch radio recording',source:'Fleet operations — synthetic',type:'AUDIO',mimeType:'audio/wav'},
    {id:'ev-003',ref:'E-DOC-001',title:'Delivery manifesto — printed report',source:'Logistics provider — synthetic',type:'DOCUMENT',mimeType:'application/pdf'},
    {id:'ev-004',ref:'E-GPS-001',title:'Vehicle telemetry export',source:'Fleet management system — synthetic',type:'DOCUMENT',mimeType:'text/csv'},
  ];

  for(const seed of evidenceSeeds){
    const existing=await db.evidenceItem.findFirst({where:{id:seed.id}});
    if(existing)continue;
    // Create a synthetic version with a deterministic fake hash
    const fakeContent=`SYNTHETIC_EVIDENCE:${seed.id}:${seed.title}`;
    const fakeSha=sha256(fakeContent);
    const fakeObjectKey=`originals/case-synthetic-001/${seed.id}/synthetic-object`;
    const version=await db.evidenceVersion.create({
      data:{
        id:`ver-${seed.id}`,
        evidenceId:seed.id,
        objectKey:fakeObjectKey,
        objectVersionId:`synth-version-${seed.id}`,
        sha256:fakeSha,
        size:1024,
        mimeType:seed.mimeType,
      },
    });
    await db.evidenceItem.create({
      data:{
        id:seed.id,
        caseId:syntheticCase.id,
        ref:seed.ref,
        title:seed.title,
        source:seed.source,
        type:seed.type,
        custodianId:admin.id,
        status:'PROCESSED',
      },
    });
    // Synthetic custody chain
    const importHash=sha256(''+sha256(JSON.stringify({id:`synth-${seed.id}-import`,versionId:version.id,actor:admin.id,type:'IMPORTED',reason:'Synthetic seed import',occurredAt:'2026-09-08T10:00:00.000Z'})));
    await db.custodyEvent.create({
      data:{
        versionId:version.id,
        actor:admin.id,
        type:'IMPORTED',
        reason:'Synthetic seed import',
        occurredAt:new Date('2026-09-08T10:00:00Z'),
        previousHash:'',
        eventHash:importHash,
        idempotencyKey:`seed-import-${seed.id}`,
      },
    });
  }

  console.log('✓ Organization:', org.name);
  console.log('✓ Users seeded:', [admin,investigator,analyst,reviewer].map(u=>u.name).join(', '));
  console.log('✓ Case:', syntheticCase.title);
  console.log('✓ Evidence items seeded:', evidenceSeeds.length);
  console.log('\nSeed complete. This is synthetic data — no real evidence files or proofs.');
}

main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>db.$disconnect());
