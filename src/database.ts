import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
export const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
