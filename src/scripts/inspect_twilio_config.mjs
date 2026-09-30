import { MongoClient } from 'mongodb';
import dns from 'dns';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '1.1.1.1']);

const uri = process.env.MONGODB_URI || process.env.DATABASE_URL || "mongodb+srv://hexerve:hexerve@cluster0.zy7afj9.mongodb.net/heytam-ai-agents?retryWrites=true&w=majority";

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'heytam-ai-agents');

  const bizId = "biz_1790397889723_p0q7t";

  const oauth = await db.collection("oauth_connections").find({ businessId: bizId, provider: "twilio" }).toArray();
  console.log("Twilio OAuth Connections:", JSON.stringify(oauth, null, 2));

  const toolConfigs = await db.collection("tool_configs").find({ businessId: bizId }).toArray();
  console.log("Tool Configs:", JSON.stringify(toolConfigs, null, 2));

  await client.close();
}

main().catch(console.error);
