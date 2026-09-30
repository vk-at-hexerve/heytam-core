import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
console.log('Connecting to URI:', uri ? uri.slice(0, 40) + '...' : 'none');

const client = new MongoClient(uri);

async function run() {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'heytam-ai-agents');

  const businesses = await db.collection('businesses').find({}).toArray();
  console.log('ALL BUSINESSES:', businesses.map(b => ({ id: b.id, name: b.name, email: b.email })));

  const tools = await db.collection('business_tools').find({}).toArray();
  console.log('ALL BUSINESS TOOLS:', tools.map(t => ({ businessId: t.businessId, toolId: t.toolId, status: t.status })));

  await client.close();
}

run();
