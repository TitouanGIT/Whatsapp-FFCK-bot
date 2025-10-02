import { DateTime } from 'luxon';
import {
  saveCourse,
  listCourses,
  setCompetitionFields,
  getCompetition,
} from './db.js';

const VISITOR_GROUP_ID = process.env.VISITOR_GROUP_ID;
const CREATOR_GROUP_ID = process.env.CREATOR_GROUP_ID;

const sessions = new Map();
const adminSessions = new Map();

function isCreatorGroup(chatId) { return chatId === CREATOR_GROUP_ID; }

function menuText() {
  return [
    '*Menu création* (réponds par *1*, *2*, *3*, *4* ou *5*)',
    '1) ➕ Créer une course (assistant en MP)',
    '2) 📋 Lister les dernières courses (MP)',
    '3) 🔒 Fermer l’accès (retirer l’annonce dans le salon invités)',
    '4) 🔓 Ré-ouvrir l’accès (ré-annoncer dans le salon invités)',
    '5) 🛑 Fermer la course (retirer annonce + supprimer le groupe)',
    '',
    'Champs demandés : *nom, lieu, type, date, date fin inscription, note*.',
    '(Tu peux écrire *skip* pour passer un champ, sauf le *nom*.)',
  ].join('\n');
}

function fmtDate(d) { return d ? DateTime.fromISO(d).toFormat('dd/LL/yyyy') : '—'; }

function formatRecap(d) {
  return [
    `🛶 *Récapitulatif*`,
    `• Nom : *${d.nom || '—'}*`,
    `• Lieu : *${d.lieu || '—'}*`,
    `• Type : *${d.type || '—'}*`,
    `• Date : *${fmtDate(d.date)}*`,
    `• Fin inscr. : *${d.close ? DateTime.fromISO(d.close).toFormat('dd/LL/yyyy HH:mm') : '—'}*`,
    `• Note : ${d.note || '—'}`,
  ].join('\n');
}

async function createCourseGroup(client, courseData, creatorJid) {
  const subject = `${process.env.GROUP_PREFIX || '[Compétition]'} ${courseData.nom}`;
  const res = await client.createGroup(subject, [creatorJid]);
  const groupJid = res?.gid?._serialized ?? res?.gid ?? res;
  const chat = await client.getChatById(groupJid);
  try { await chat.promoteParticipants([creatorJid]); } catch {}
  let inviteCode = null;
  try { inviteCode = await chat.getInviteCode(); } catch {}
  const welcomeText = [
    `👋 *Bienvenue dans le groupe invités*`,
    `*${courseData.nom}*`,
    '',
    `📍 Lieu : *${courseData.lieu || '—'}*`,
    `🏷️ Type : *${courseData.type || '—'}*`,
    `📅 Date : *${fmtDate(courseData.date)}*`,
    courseData.close ? `⏳ Fin des inscriptions : *${DateTime.fromISO(courseData.close).toFormat('dd/LL/yyyy HH:mm')}*` : null,
    courseData.note ? `📝 Note : ${courseData.note}` : null,
  ].filter(Boolean).join('\n');
  try { await client.sendMessage(groupJid, welcomeText); } catch {}
  return { groupJid, inviteCode, subject };
}

async function postAnnouncement(client, compId, d, inviteCode, subject) {
  if (!VISITOR_GROUP_ID) throw new Error('VISITOR_GROUP_ID manquant');
  const text = [
    `📣 *${subject}*`,
    `📍 ${d.lieu || '—'}   🏷️ ${d.type || '—'}`,
    `📅 ${fmtDate(d.date)}${d.close ? `   ⏳ Fin insc. ${DateTime.fromISO(d.close).toFormat('dd/LL HH:mm')}` : ''}`,
    d.note ? `📝 ${d.note}` : null,
    '',
    `🔗 *Rejoindre le groupe :* https://chat.whatsapp.com/${inviteCode || '…'}`,
  ].filter(Boolean).join('\n');
  const sent = await client.sendMessage(VISITOR_GROUP_ID, text);
  const msgId = sent?.id?._serialized || sent?.id || null;
  await setCompetitionFields(compId, { announce_chat_jid: VISITOR_GROUP_ID, announce_msg_id: msgId });
  return msgId;
}

async function deleteAnnouncement(client, comp) {
  if (!comp?.announce_chat_jid || !comp?.announce_msg_id) return false;
  const chat = await client.getChatById(comp.announce_chat_jid);
  const msgs = await chat.fetchMessages({ limit: 100 });
  const found = msgs.find(m => (m?.id?._serialized || m?.id) === comp.announce_msg_id);
  if (!found) return false;
  try { await found.delete(true); await setCompetitionFields(comp.id, { announce_msg_id: null }); return true; }
  catch { return false; }
}

async function deleteCourseGroup(client, comp) {
  if (!comp?.group_jid) return;
  try {
    const chat = await client.getChatById(comp.group_jid);
    try { await chat.revokeInvite?.(); } catch {}
    if (chat?.isGroup && Array.isArray(chat.participants)) {
      const me = client.info?.wid?._serialized;
      const toRemove = chat.participants.map(p => p?.id?._serialized).filter(j => j && j !== me);
      if (toRemove.length && chat.removeParticipants) { try { await chat.removeParticipants(toRemove); } catch {} }
    }
    try { await chat.leave?.(); } catch {}
    try { await chat.delete?.(); } catch {}
  } catch(e) { console.error('deleteCourseGroup error', e); }
}

function parseDateFR(input) {
  const t = (input || '').trim().toLowerCase();
  let dt = DateTime.fromISO(t, { zone: 'Europe/Paris' });
  if (!dt.isValid) dt = DateTime.fromFormat(t, 'dd/LL/yyyy', { zone: 'Europe/Paris' });
  if (!dt.isValid) {
    if (t === "aujourd'hui" || t === 'aujourdhui') dt = DateTime.local();
    if (t === 'demain') dt = DateTime.local().plus({ days: 1 });
  }
  return dt.isValid ? dt.startOf('day').toISODate() : null;
}

async function advanceWizard(client, msg, userJid, answer) {
  const sess = sessions.get(userJid);
  if (!sess) return false;
  const d = sess.data;

  switch (sess.step) {
    case 'nom': {
      if (!answer || /^skip$/i.test(answer)) { await msg.reply('📝 *Nom de la course ?* (obligatoire, pas de *skip*)'); return true; }
      d.nom = answer; sess.step = 'lieu';
      await msg.reply('📍 *Lieu ?* (ou écris *skip*)'); return true;
    }
    case 'lieu': {
      if (/^skip$/i.test(answer)) d.lieu = null; else d.lieu = answer || null;
      sess.step = 'type'; await msg.reply('🏷️ *Type ?* (ex: Régional, National, Club…) — ou *skip*'); return true;
    }
    case 'type': {
      if (/^skip$/i.test(answer)) d.type = null; else d.type = answer || null;
      sess.step = 'date'; await msg.reply('📅 *Date ?* (YYYY-MM-DD ou JJ/MM/AAAA, ou "aujourd\'hui"/"demain" — ou *skip*)'); return true;
    }
    case 'date': {
      if (/^skip$/i.test(answer)) { d.date = null; }
      else {
        const iso = parseDateFR(answer);
        if (!iso) { await msg.reply('Format invalide. Exemple: 2025-09-28 (ou *skip*)'); return true; }
        d.date = iso;
      }
      sess.step = 'close'; await msg.reply('⏳ *Fin d’inscription ?* (YYYY-MM-DDTHH:mm — ou *skip*)'); return true;
    }
    case 'close': {
      if (/^skip$/i.test(answer)) d.close = null;
      else {
        const dt = DateTime.fromISO(answer || '');
        if (!dt.isValid) { await msg.reply('Format invalide. Exemple: 2025-09-20T18:00 (ou *skip*)'); return true; }
        d.close = dt.toISO({ suppressSeconds: true, suppressMilliseconds: true });
      }
      sess.step = 'note'; await msg.reply('📝 *Note (optionnel)* — tu peux écrire un texte ou *skip*'); return true;
    }
    case 'note': {
      d.note = /^skip$/i.test(answer) ? null : (answer || null);
      sess.step = 'confirm'; await msg.reply(`${formatRecap(d)}\n\nTape *confirmer* pour valider, ou *annuler* pour abandonner.`); return true;
    }
    case 'confirm': {
      const t = (answer || '').trim().toLowerCase();
      if (t === 'annuler') { sessions.delete(userJid); await msg.reply('❌ Création annulée.'); return true; }
      if (t !== 'confirmer') { await msg.reply('Réponds par *confirmer* ou *annuler*.'); return true; }

      let compId;
      try {
        compId = await saveCourse({
          nom: d.nom, lieu: d.lieu ?? null, type: d.type ?? null,
          date: d.date ?? null, close_at: d.close ?? null, note: d.note ?? null,
          status: 'draft', creator_jid: userJid,
        });
      } catch (e) { console.error('saveCourse error', e); await msg.reply('❌ Erreur lors de la sauvegarde.'); return true; }

      let groupInfo = null;
      try {
        groupInfo = await createCourseGroup(client, d, userJid);
        await setCompetitionFields(compId, { group_jid: groupInfo.groupJid, invite_code: groupInfo.inviteCode || null, status: 'open', close_at: d.close ?? null });
      } catch (e) { console.error('createCourseGroup error', e); await msg.reply(`✅ Course créée (#${compId}).\n⚠️ Impossible de créer le groupe invités.`); sessions.delete(userJid); return true; }

      try { await postAnnouncement(client, compId, d, groupInfo.inviteCode, groupInfo.subject); } catch (e) { console.error('postAnnouncement error', e); }

      sessions.delete(userJid);
      await msg.reply(`✅ Course créée (#${compId}).\n${formatRecap(d)}\n\n🔗 Invitation : ${groupInfo.inviteCode ? 'https://chat.whatsapp.com/' + groupInfo.inviteCode : '—'}`);
      return true;
    }
    default:
      sessions.delete(userJid); await msg.reply('Wizard réinitialisé.'); return true;
  }
}

export function registerCommands(client) {
  const handler = async (msg) => {
    if (msg.fromMe) return;
    const chat = await msg.getChat();
    const body = (msg.body || '').trim();
    const contact = await msg.getContact();
    const userJid = contact?.id?._serialized;

    if (sessions.has(userJid)) { const consumed = await advanceWizard(client, msg, userJid, body); if (consumed) return; }

    if (body === '/id') { await msg.reply(`🆔 *${msg.from}*`); return; }

    if (isCreatorGroup(msg.from)) {
      if (/^\/?menu$/i.test(body)) { await msg.reply(menuText()); return; }
      if (/^[1-5]$/.test(body)) {
        if (body === '1') {
          sessions.set(userJid, { step: 'nom', data: {} });
          try {
            await client.sendMessage(userJid, '📝 *Nom de la course ?* (obligatoire)');
            await client.sendMessage(userJid, 'Tu peux écrire *skip* sur les étapes suivantes (sauf le nom).');
            await msg.reply('👉 Je t’écris en privé pour la suite.');
          } catch (e) { await msg.reply('⚠️ Je ne peux pas t’écrire en MP. Envoie-moi *start* en privé puis refais *1*.'); }
          return;
        }
        if (body === '2') {
          const rows = await listCourses({ limit: 10 });
          const lines = rows.length ? rows.map((r) => `• *${r.title}* — ${r.level || '—'} — ${r.location || '—'} — ${r.date_iso ? DateTime.fromISO(r.date_iso).toFormat('dd/LL/yyyy') : '—'} — _#${r.id}_`) : ['Aucune course.'];
          try { await client.sendMessage(userJid, ['📋 *Dernières courses*', ...lines].join('\n')); await msg.reply('👉 Liste envoyée en privé.'); }
          catch { await msg.reply('⚠️ Envoie *start* en privé puis recommence.'); }
          return;
        }
        if (body === '3') { adminSessions.set(userJid, { action: 'closeaccess' }); try { await client.sendMessage(userJid, '🔒 Envoie l’ID de la course à *fermer l’accès* (ex: 12).'); await msg.reply('👉 Je te contacte en MP.'); } catch { await msg.reply('⚠️ Envoie *start* en privé puis recommence.'); } return; }
        if (body === '4') { adminSessions.set(userJid, { action: 'reopen' }); try { await client.sendMessage(userJid, '🔓 Envoie l’ID de la course à *ré-ouvrir* (ex: 12).'); await msg.reply('👉 Je te contacte en MP.'); } catch { await msg.reply('⚠️ Envoie *start* en privé puis recommence.'); } return; }
        if (body === '5') { adminSessions.set(userJid, { action: 'close' }); try { await client.sendMessage(userJid, '🛑 Envoie l’ID de la course à *fermer* (ex: 12).'); await msg.reply('👉 Je te contacte en MP.'); } catch { await msg.reply('⚠️ Envoie *start* en privé puis recommence.'); } return; }
      }
    }

    if (adminSessions.has(userJid) && !chat.isGroup) {
      const adm = adminSessions.get(userJid);
      const id = Number((body || '').trim());
      if (!Number.isInteger(id) || id <= 0) { await msg.reply('Donne un ID valide (ex: 12).'); return; }
      const comp = await getCompetition(id);
      if (!comp) { await msg.reply('❌ Introuvable.'); return; }

      if (adm.action === 'closeaccess') {
        const ok = await deleteAnnouncement(client, comp);
        await msg.reply(ok ? '🔒 Accès fermé (annonce retirée).' : '⚠️ Rien à retirer ou erreur.');
      } else if (adm.action === 'reopen') {
        const d = { nom: comp.title, lieu: comp.location, type: comp.level, date: comp.date_iso, close: comp.close_at, note: comp.note || null };
        await postAnnouncement(client, comp.id, d, comp.invite_code, `${process.env.GROUP_PREFIX || '[Compétition]'} ${comp.title}`);
        await msg.reply('🔓 Accès ré-ouvert (annonce renvoyée).');
      } else if (adm.action === 'close') {
        await deleteAnnouncement(client, comp);
        await deleteCourseGroup(client, comp);
        await setCompetitionFields(comp.id, { status: 'closed' });
        await msg.reply('🛑 Course fermée et groupe supprimé.');
      }
      adminSessions.delete(userJid);
      return;
    }

    if (!chat.isGroup && /^start$/i.test(body)) {
      await msg.reply('✅ MP OK. Retourne dans le salon de création et tape *menu*, puis *1*.');
      return;
    }
  };
  client.on('message', handler);
}
