/**
 * tools/repair-chat-timestamps.js
 * 自愈修复被污染的历史会话时间戳：
 * 还原各会话真实更新时间，统一数字毫秒格式，并同步单会话文件与 all.json。
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../chat_data');
const backupsDir = path.join(dataDir, 'backups');
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

function parseTs(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val < 100000000000 ? Math.round(val * 1000) : Math.round(val);
    if (typeof val === 'string' && val.trim()) {
        const num = Number(val);
        if (!isNaN(num) && num > 0) return num < 100000000000 ? Math.round(num * 1000) : Math.round(num);
        const parsed = Date.parse(val);
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

const userNamespaces = ['user_u_a418898cebde5e2b1e15d181'];

const backup0825Path = path.join(backupsDir, 'user_u_a418898cebde5e2b1e15d181_all.json.before-empty-import-cleanup.20260825-153014');
let backup0825Chats = {};
if (fs.existsSync(backup0825Path)) {
    try {
        backup0825Chats = JSON.parse(fs.readFileSync(backup0825Path, 'utf8')).chats || {};
    } catch (e) {
        console.warn('Failed to read 0825 backup:', e.message);
    }
}

for (const ns of userNamespaces) {
    const allFile = path.join(dataDir, `${ns}_all.json`);
    if (!fs.existsSync(allFile)) {
        console.log(`File not found: ${allFile}`);
        continue;
    }

    console.log(`Processing ${ns}...`);
    const preBackupFile = path.join(backupsDir, `${ns}_all.json.pre-repair-${Date.now()}`);
    fs.copyFileSync(allFile, preBackupFile);
    console.log(`Created backup: ${path.basename(preBackupFile)}`);

    const allData = JSON.parse(fs.readFileSync(allFile, 'utf8'));
    const chats = allData.chats || {};
    const chatIds = Object.keys(chats);
    console.log(`Total chats in ${ns}: ${chatIds.length}`);

    let repairedCount = 0;
    const repairedMap = {};

    for (const cid of chatIds) {
        const c = chats[cid];
        let realTs = 0;

        const msgs = Array.isArray(c.messages) ? c.messages : [];

        // 优先 1：会话 ID 中的 13 位时间戳。对于 chat_*/test_* 等本地会话，
        // 这是创建时间的稳定来源，不能被批量保存产生的 updated_at 覆盖。
        const idMatch = cid.match(/_(\d{13})/);
        if (idMatch) {
            const idTs = Number(idMatch[1]);
            if (idTs > 1600000000000 && idTs < 2000000000000) realTs = idTs;
        }

        // 优先 2：污染发生前的历史 all.json 备份。
        if (!realTs && backup0825Chats[cid]) {
            const b_up = parseTs(backup0825Chats[cid].updated_at);
            if (b_up > 1600000000000) realTs = b_up;
            if (!realTs) {
                const b_msgs = Array.isArray(backup0825Chats[cid].messages) ? backup0825Chats[cid].messages : [];
                for (let i = b_msgs.length - 1; i >= 0; i--) {
                    const m = b_msgs[i];
                    const t = m && typeof m === 'object' ? parseTs(m.time || m.timestamp || m.created_at) : 0;
                    if (t > 1600000000000) { realTs = t; break; }
                }
            }
        }

        // 优先 3：当前会话最后一条绝对消息时间。
        if (!realTs) {
            for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                const t = m && typeof m === 'object' ? parseTs(m.time || m.timestamp || m.created_at) : 0;
                if (t > 1600000000000) { realTs = t; break; }
            }
        }

        // 优先 4：单会话文件中的时间或消息时间。
        const singleFile = path.join(dataDir, `${ns}_${cid}.json`);
        if (!realTs && fs.existsSync(singleFile)) {
            try {
                const sfData = JSON.parse(fs.readFileSync(singleFile, 'utf8'));
                const sfUp = parseTs(sfData.updated_at);
                if (sfUp > 1600000000000) realTs = sfUp;
                const sfMsgs = Array.isArray(sfData.messages) ? sfData.messages : [];
                for (let i = sfMsgs.length - 1; !realTs && i >= 0; i--) {
                    const m = sfMsgs[i];
                    const t = m && typeof m === 'object' ? parseTs(m.time || m.timestamp || m.created_at) : 0;
                    if (t > 1600000000000) realTs = t;
                }
            } catch (e) {}
        }

        if (!realTs && msgs.length > 0) {
            for (let i = 0; i < msgs.length; i++) {
                const m = msgs[i];
                if (m && typeof m === 'object') {
                    const t = parseTs(m.time || m.timestamp || m.created_at);
                    if (t > 1600000000000 && !String(t).startsWith('1788411805')) {
                        realTs = t;
                        break;
                    }
                }
            }
        }

        if (!realTs) {
            realTs = parseTs(c.updated_at);
        }

        if (realTs > 0) {
            if (c.updated_at !== realTs) {
                c.updated_at = realTs;
                repairedCount++;
            }
            repairedMap[cid] = realTs;
        }
    }

    fs.writeFileSync(allFile, JSON.stringify(allData), 'utf8');
    console.log(`Updated ${allFile}: repaired ${repairedCount} timestamps.`);

    let singleRepaired = 0;
    const singleFiles = fs.readdirSync(dataDir).filter(f => f.startsWith(`${ns}_`) && f.endsWith('.json') && !f.endsWith('_all.json') && !f.startsWith('config_'));
    for (const sf of singleFiles) {
        const fullPath = path.join(dataDir, sf);
        const cid = sf.replace(`${ns}_`, '').replace('.json', '');
        const targetTs = repairedMap[cid];
        if (targetTs) {
            try {
                const sfData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                if (sfData.updated_at !== targetTs) {
                    sfData.updated_at = targetTs;
                    fs.writeFileSync(fullPath, JSON.stringify(sfData), 'utf8');
                    singleRepaired++;
                }
            } catch (e) {}
        }
    }
    console.log(`Synced ${singleRepaired} single chat files with repaired timestamps.`);
}

console.log('Timestamp repair finished successfully!');
