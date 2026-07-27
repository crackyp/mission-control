#!/usr/bin/env node
const fs = require('fs/promises');
const readline = require('readline');
const { OAuth2Client } = require('google-auth-library');

const CLIENT_FILE = process.env.GA_CLIENT_FILE || '/home/crackypp/.openclaw/secrets/client_secret_34331223700-g8eumr5383b7k0g939vnbfsevnudatj1.apps.googleusercontent.com.json';
const TOKEN_FILE = process.env.GA_TOKEN_FILE || '/home/crackypp/.openclaw/secrets/ga-token.json';
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

async function main() {
  const clientRaw = JSON.parse(await fs.readFile(CLIENT_FILE, 'utf8'));
  const cfg = clientRaw.installed || clientRaw.web;
  if (!cfg) throw new Error('OAuth client file is missing installed/web config');

  const redirectUri = (cfg.redirect_uris || []).find((uri) => uri.includes('localhost')) || (cfg.redirect_uris || [])[0] || 'http://localhost';
  const oauth2Client = new OAuth2Client(cfg.client_id, cfg.client_secret, redirectUri);

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\nOpen this URL while signed into the Google account that has access to the GA4 property:\n');
  console.log(url);
  console.log('\nAfter approving, paste the full redirected URL or just the code parameter here.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('Code or URL: ', resolve));
  rl.close();

  let code = String(answer).trim();
  try {
    const parsed = new URL(code);
    code = parsed.searchParams.get('code') || code;
  } catch {}
  if (!code) throw new Error('No authorization code provided');

  const { tokens } = await oauth2Client.getToken(code);
  await fs.mkdir(require('path').dirname(TOKEN_FILE), { recursive: true });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log(`\nSaved refreshed GA OAuth token to ${TOKEN_FILE}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
