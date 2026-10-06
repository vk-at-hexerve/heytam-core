import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

dotenv.config();
const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
if (!uri) {
  console.error('No MONGODB_URI found.');
  process.exit(1);
}

const client = new MongoClient(uri);
const dbJsonPath = path.resolve('data/db.json');
const dbJson = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));

async function syncToMongo() {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'heytam-ai-agents');
  const bizId = 'biz_1790004412473_jo1fh';
  
  // 1. Sync OAuth connections
  for (const [k, v] of (dbJson.oauthConnectionsStore || [])) {
    if (k.startsWith(bizId)) {
      const provider = v.provider || k.replace(`${bizId}_`, '');
      console.log('Upserting Mongo OAuth:', provider);
      await db.collection('oauth_connections').updateOne(
        { businessId: bizId, provider: provider },
        { 
          $set: {
            businessId: bizId,
            provider: provider,
            connected: true,
            verified: true,
            accountEmail: v.accountEmail || (v.credentials && v.credentials.smtpUser) || 'shivamawasthi1129@gmail.com',
            credentials: v.credentials || v,
            extraConfig: v.extraConfig || v.credentials || v,
            updatedAt: new Date().toISOString()
          }
        },
        { upsert: true }
      );
    }
  }

  // 2. Sync Tool Configurations
  for (const [k, v] of (dbJson.toolConfigStore || [])) {
    if (k.startsWith(bizId)) {
      const toolId = k.replace(`${bizId}_`, '');
      console.log('Upserting Mongo Tool Config:', toolId);
      await db.collection('tool_configurations').updateOne(
        { businessId: bizId, toolId: toolId },
        {
          $set: {
            businessId: bizId,
            toolId: toolId,
            config: v,
            isConfigured: true,
            updatedAt: new Date().toISOString()
          }
        },
        { upsert: true }
      );
    }
  }

  // 3. Sync Business Tools
  for (const [k, tools] of (dbJson.businessToolsStore || [])) {
    if (k === bizId && Array.isArray(tools)) {
      console.log('Upserting Mongo Business Tools count:', tools.length);
      for (const t of tools) {
        await db.collection('business_tools').updateOne(
          { businessId: bizId, toolId: t.toolId },
          {
            $set: {
              ...t,
              businessId: bizId,
              status: 'active',
              isConfigured: true,
              updatedAt: new Date().toISOString()
            }
          },
          { upsert: true }
        );
      }
    }
  }

  console.log('SUCCESS! MongoDB Atlas updated with all latest credentials.');
  await client.close();
}

syncToMongo().catch(console.error);
