import {db} from '../src/database';
import {passwordHash} from '../src/domain';
async function main(){const email=process.env.SEED_EMAIL,password=process.env.SEED_PASSWORD;if(!email||!password||password.length<16)throw new Error('Set SEED_EMAIL and a SEED_PASSWORD of at least 16 characters.');if(process.env.NODE_ENV==='production')throw new Error('Local seed cannot run in production');const user=await db.user.upsert({where:{email},create:{email,name:'Development analyst',organizationId:'local-development',passwordHash:passwordHash(password)},update:{}});console.log('Development user ready:',user.id)}
main().finally(()=>db.$disconnect());
