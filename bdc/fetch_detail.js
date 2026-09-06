const crypto = require('crypto');
const { sm2 } = require('/tmp/bdc/node_modules/sm-crypto');

const BASE = 'https://console.hunanbdc.cn/devops';
const ID = '8662170ABA80D9EBC5A0E27EFF4C659F';
const CHANNEL_ID = '2372';
const CHANNEL_NAME = '公示公告';
const PATH = '/estate/scfw/getAllDetails';

const ZERO_IV = Buffer.alloc(16, 0);

function sm4EncryptHex(plainHex, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const cipher = crypto.createCipheriv('sm4-cbc', key, ZERO_IV);
  cipher.setAutoPadding(false);
  const out = Buffer.concat([cipher.update(Buffer.from(plainHex, 'hex')), cipher.final()]);
  return out.toString('hex');
}

function sm4DecryptHex(cipherHex, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const decipher = crypto.createDecipheriv('sm4-cbc', key, ZERO_IV);
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
  return out.toString('hex');
}

// replicate frontend setDigit: pad hex string to multiple of 32 chars with "80" + zeros
function setDigit(hex) {
  const n = hex.length % 32;
  const t = 32 - n;
  let pad = '';
  for (let o = 0; o < t - 2; o++) pad += '0';
  return hex + '80' + pad;
}

// replicate frontend: decrypt hex -> find last "80" -> truncate -> utf8
function stripPaddingAndUtf8(hex) {
  const idx = hex.lastIndexOf('80');
  const u = hex.substr(0, idx);
  return Buffer.from(u, 'hex').toString('utf8');
}

async function getSessionKey(pubkeyHex) {
  const url = `${BASE}/rest/script/applySessionQKey?encodedPubKey=${pubkeyHex}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ date: Date.now() }),
  });
  return resp.json();
}

async function main() {
  const kp = sm2.generateKeyPairHex();
  const priv = kp.privateKey;
  const pub = kp.publicKey;
  console.log('pubkey len:', pub.length);

  const sk = await getSessionKey(pub);
  console.log('applySessionQKey:', JSON.stringify(sk).slice(0, 300));
  if (!sk || !sk.data || !sk.data.cipherQKey) {
    console.log('FAILED to get session key');
    return;
  }
  const { keyId, cipherQKey } = sk.data;
  const sm4keyHex = sm2.doDecrypt(cipherQKey.slice(2), priv, 1);
  console.log('sm4keyHex len:', sm4keyHex.length, '=', sm4keyHex);

  // Build D as frontend does
  const D = { jessionid: '', path: PATH, params: { WZID: ID, CHANNEL_ID: CHANNEL_ID, CHANNEL_NAME: CHANNEL_NAME } };
  const Dhex = Buffer.from(JSON.stringify(D), 'utf8').toString('hex');
  const paramsCipher = sm4EncryptHex(setDigit(Dhex), sm4keyHex);

  const C = { iv: '00000000000000000000000000000000', algID: 'CBC', keyId: keyId, params: paramsCipher, target: undefined };
  const formBody = new URLSearchParams();
  formBody.set('iv', C.iv);
  formBody.set('algID', C.algID);
  formBody.set('keyId', C.keyId);
  formBody.set('params', C.params);
  const resp = await fetch(`${BASE}/rest/script/getAllEncryptNMDataBpmx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: formBody.toString(),
  });
  const j = await resp.json();
  console.log('gateway response keys:', Object.keys(j), 'status:', j.status, 'code:', j.code);
  if (j.status && j.code) {
    const dec = sm4DecryptHex(j.data, sm4keyHex);
    const padded = stripPaddingAndUtf8(dec);
    const outer = JSON.parse(padded);
    const inner = JSON.parse(outer.result);
    console.log('=== inner keys ===', Object.keys(inner));
    console.log('=== total ===', inner.total);
    for (const row of inner.rows || []) {
      console.log('=== row keys ===', Object.keys(row));
      for (const k of Object.keys(row)) {
        console.log('--- ' + k + ' ---');
        console.log(String(row[k]).slice(0, 12000));
      }
    }
  } else if (j.status) {
    console.log('data (unencrypted):', JSON.stringify(j.data).slice(0, 2000));
  } else {
    console.log('gateway error:', JSON.stringify(j).slice(0, 500));
  }
}

main().catch((e) => { console.error('ERROR', e.message, e.stack); process.exit(1); });
