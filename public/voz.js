// Voz en la oficina: lee los avisos en voz alta y ejecuta órdenes habladas (🎤) sobre la tarea o el chat del aviso.
// Aprobar, devolver y pasar a otro agente piden confirmación; responder a una consulta se envía directo (el agente sabe que es un dictado).
import { S, post, h, holo, fail, speak, listen, paintMic, canListen, voicePrefs } from './core.js';
import { notifPhrase, ctxFromLink, parseCommand } from './comandos.js';

let last = null; // último aviso: para "repite" y como contexto del 🎤 de la barra

// app.js lo llama con cada aviso; devuelve el botón 🎤 para el holograma
export function announce(n) {
  last = n;
  if (voicePrefs().read) speak(notifPhrase(n));
  return cmdBtn(n.link, n.kind);
}
export const cmdBtn = (link = '', kind = '') => canListen() && S.boot.me.role !== 'observador'
  ? `<button type="button" class="btn sm" data-vcmd="${h(link)}" data-kind="${h(kind)}" title="Responder hablando (pulsa otra vez para terminar)"><span class="mi">🎤</span> Responder</button>` : '';

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-vcmd]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  // 🎤 de un aviso: su tarea/chat. 🎙 de la barra: la tarea/chat abierto en pantalla o, si no, el último aviso
  const page = ctxFromLink(location.hash);
  const ctx = b.dataset.vcmd ? ctxFromLink(b.dataset.vcmd, b.dataset.kind) : page.task || page.conv ? page : last ? ctxFromLink(last.link, last.kind) : page;
  const text = await listen(st => paintMic(b, st));
  if (text && activeConfirmation && /^(s[ií]|confirmo|confirmar|no|cancela|cancelar)[.!?\s]*$/i.test(text.trim())) {
    const id = activeConfirmation;
    await resolveConfirmation(id, /^(s[ií]|confirmo|confirmar)/i.test(text.trim()));
    return;
  }
  if (text) await run(parseCommand(text, ctx), text);
});

const say = (msg, heard) => { holo('🎙 ' + msg, heard ? `«${heard}»` : ''); speak(msg); };

async function run(c, heard) {
  const t = c.task;
  try {
    switch (c.action) {
      case 'none': return say('De acuerdo, queda para después.', heard);
      case 'repeat': return last ? speak(notifPhrase(last)) : say('No hay avisos para repetir.');
      case 'open': if (t || c.conv) { location.hash = t ? `#/tarea/${t}` : `#/cantina/${c.conv}`; return; } break;
      case 'reply':
        if (!t && !c.conv) break;
        await post(t ? `/api/tasks/${t}/reply` : `/api/conversations/${c.conv}/reply`, { text: c.text, voz: true });
        return say(t ? `Listo, se lo dije en la tarea ${t}.` : 'Listo, respondí en el chat.', c.text);
      case 'approve':
        if (!t) break;
        return confirmAct(`aprobar la tarea ${t}${c.merge ? ' y fusionarla' : ''}`, () => post(`/api/tasks/${t}/approve`, { merge: c.merge }));
      case 'return':
        if (!t) break;
        return confirmAct(`devolver la tarea ${t}: ${c.text}`, () => post(`/api/tasks/${t}/return`, { comment: c.text }));
      case 'handoff': {
        if (!t) break;
        const ag = S.boot.agents.find(a => a.key === c.agent);
        if (!ag) return say('No encontré ese agente.', heard);
        return confirmAct(`pasar la tarea ${t} a ${ag.name}`, () => post(`/api/tasks/${t}/handoff`, { agent_id: ag.id, reason: 'voz' }));
      }
      case 'chat': // sin tarea ni chat: lo dejo escrito en la Cantina para que elijas agente y lo envíes
        S.voiceDraft = c.text; location.hash = '#/cantina';
        return say('Lo dejé listo en la Cantina: elige el agente y envíalo.', c.text);
    }
    say('No sé a qué tarea te refieres. Di por ejemplo: aprueba la 29, devuélvela porque…, pásala a Codex, o responde en la tarea 30…', heard);
  } catch (err) { fail(err); speak('No se pudo. ' + err.message); }
}

const pending = new Map();
let activeConfirmation = null;
function confirmAct(what, fn) {
  const id = String(Date.now() + Math.random());
  if (activeConfirmation) pending.delete(activeConfirmation);
  activeConfirmation = id;
  pending.set(id, { what, fn });
  setTimeout(() => { pending.delete(id); if (activeConfirmation === id) activeConfirmation = null; }, 30000);
  holo('🎙 ¿Confirmas?', what.charAt(0).toUpperCase() + what.slice(1), { ms: 30000,
    actions: `<button class="btn sm g" data-vok="${id}">Confirmar</button><button class="btn sm ghost" data-vno="${id}">Cancelar</button>` });
  speak(`¿Confirmo ${what}?`);
}
async function resolveConfirmation(id, confirmed) {
  const p = pending.get(id);
  pending.delete(id);
  if (activeConfirmation === id) activeConfirmation = null;
  document.querySelector(`[data-vok="${id}"]`)?.closest('.holo')?.remove();
  if (!p || !confirmed) return;
  try { await p.fn(); holo('✔ Hecho', p.what); speak('Hecho.'); } catch (err) { fail(err); }
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-vok],[data-vno]'); if (!b) return;
  e.stopPropagation();
  const id = b.dataset.vok || b.dataset.vno;
  await resolveConfirmation(id, !!b.dataset.vok);
});
