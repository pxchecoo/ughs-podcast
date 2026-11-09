(() => {
  const byId = id => document.getElementById(id);
  const motion = window.InterviewMotion;
  const listRoot = byId('interview-staff-content'), detail = byId('interview-detail');
  const labels = { pending: 'Pendiente', in_review: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada' };
  const dates = value => value ? new Intl.DateTimeFormat('es-PR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Puerto_Rico' }).format(new Date(value)) : 'No disponible';
  let staff = null, page = 1, current = null, generation = 0, detailGeneration = 0;
  let origin = null, displayedPage = 1;
  async function api(path, options = {}) {
    let response;
    try { response = await fetch(path, { ...options, cache: 'no-store', credentials: 'same-origin', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
    catch { throw new Error('No hay conexión. Tus cambios no guardados permanecen en pantalla.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) { staff = null; renderAccess(); }
      throw new Error(data.error?.message ?? 'El servicio no está disponible. Reintenta.');
    }
    return data;
  }
  function renderAccess() {
    byId('interview-staff-content').hidden = !staff;
    byId('interview-staff-prompt').hidden = !!staff;
    byId('staff-logout').hidden = !staff;
    byId('staff-identity').textContent = staff ? (staff.role === 'admin' ? 'Cuenta personal · Administrador' : 'Cuenta personal · Moderadora') : '';
    byId('health-panel').hidden = staff?.role !== 'admin';
    byId('interview-audit').hidden = true;
    if (!staff) {
      motion.reset(); current = null; origin = null; generation++; detailGeneration++;
      byId('interview-rows').replaceChildren(); byId('interview-detail').hidden = true;
      byId('interview-detail-data').replaceChildren(); byId('interview-detail-title').textContent = '';
      byId('interview-notes').value = ''; byId('interview-contact').removeAttribute('href');
      byId('interview-audit').textContent = ''; byId('notification-state').textContent = '';
      byId('health-state').textContent = 'Estado desconocido'; byId('health-details').textContent = '';
    }
  }
  function setLegacy(value) {
    byId('legacy-content').hidden = !value;
    byId('refresh-button').hidden = !value;
    byId('logout-button').hidden = !value;
  }
  function make(tag, text, className) {
    const el = document.createElement(tag); if (text != null) el.textContent = text;
    if (className) el.className = className; return el;
  }
  function message(text, state = 'info') { motion.text(byId('interview-admin-status'), text, listRoot); byId('interview-admin-status').dataset.state = state; }
  async function loadList() {
    if (!staff) return;
    const thisGeneration = ++generation;
    message('Cargando solicitudes…'); motion.busy(byId('interview-search-button'), true); byId('interview-search-button').disabled = true;
    byId('interview-rows').setAttribute('aria-busy', 'true');
    const params = new URLSearchParams({ page, q: byId('interview-search').value.trim(), status: byId('interview-filter').value, order: byId('interview-order').value });
    try {
      const data = await api(`/api/interview-admin?${params}`);
      if (thisGeneration !== generation || !staff) return;
      const tbody = byId('interview-rows'), oldRows = [...tbody.children];
      const existing = new Map(oldRows.map(tr => [tr.dataset.requestId, tr]));
      const rows = data.rows.map(row => {
        const tr = existing.get(row.id) ?? make('tr');
        if (!tr.children.length) {
          tr.dataset.requestId = row.id;
          tr.append(make('td', row.full_name), make('td', row.topic), make('td', dates(row.created_at)), make('td', labels[row.status]));
          const td = make('td'), button = make('button', 'Revisar', 'secondary-button'); button.type = 'button';
          button.setAttribute('aria-label', `Revisar solicitud de ${row.full_name}`);
          button.addEventListener('click', () => openDetail(row.id, button)); td.append(button); tr.append(td);
        }
        return tr;
      });
      const focused = document.activeElement;
      motion.layout(listRoot, () => {
        rows.forEach((tr, i) => {
          const row = data.rows[i];
          [row.full_name, row.topic, dates(row.created_at), labels[row.status]].forEach((value, index) => {
            if (tr.children[index].textContent !== value) motion.text(tr.children[index], value, tr);
          });
          // Move existing nodes instead of discarding them: focus and identity survive.
          if (tbody.children[i] !== tr) tbody.insertBefore(tr, tbody.children[i] ?? null);
        });
        oldRows.filter(tr => !rows.includes(tr)).forEach(tr => tr.remove());
        byId('interview-empty').hidden = data.rows.length > 0;
        const filtered = !!(params.get('q') || params.get('status') || page > 1);
        byId('interview-empty-title').textContent = filtered ? 'No encontramos solicitudes con estos filtros.' : 'Todavía no tenemos solicitudes.';
        byId('interview-empty-copy').textContent = filtered ? 'Prueba otra búsqueda o vuelve a la primera página.' : 'Cuando alguien quiera participar en University en Vivo, su solicitud aparecerá aquí.';
        byId('interview-prev').disabled = page === 1; byId('interview-next').disabled = !data.hasMore; motion.text(byId('interview-page'), `Página ${page}`, byId('interview-page').parentElement);
      }, { elements: [...new Set([...oldRows, ...rows])].flatMap(tr => [tr, ...tr.children]).concat([...tbody.closest('table').querySelectorAll('th'), byId('interview-empty'), byId('interview-page').parentElement, detail]), enter: [...rows, byId('interview-empty')], leave: oldRows.filter(tr => !rows.includes(tr)), direction: page < displayedPage ? -1 : 1 });
      displayedPage = page;
      if (focused?.isConnected && rows.some(tr => tr.contains(focused))) focused.focus({ preventScroll: true });
      message('');
    } catch (e) { if (thisGeneration === generation) message(e.message); }
    finally { if (thisGeneration === generation) { byId('interview-search-button').disabled = false; motion.busy(byId('interview-search-button'), false); byId('interview-rows').removeAttribute('aria-busy'); } }
  }
  async function openDetail(id, trigger) {
    const request = ++detailGeneration;
    motion.busy(trigger, true);
    message('Cargando detalles…');
    try {
      const { row } = await api(`/api/interview-admin?id=${encodeURIComponent(id)}`);
      if (!staff || request !== detailGeneration) return;
      const from = detail.hidden ? trigger?.closest('tr') : detail;
      await motion.morph(byId('interview-requests'), from, detail, () => {
        if (!staff || request !== detailGeneration) return;
        current = row; origin = trigger;
        byId('interview-detail-title').textContent = row.topic;
        const details = byId('interview-detail-data'); details.replaceChildren();
        for (const [label,value] of [['Nombre',row.full_name],['Correo',row.email],['Relación con la escuela',row.school_affiliation || 'No indicada'],['Motivación',row.motivation],['Experiencia previa',row.previous_experience === null ? 'Prefiere no responder' : row.previous_experience ? 'Sí' : 'No'],['Recibida',dates(row.created_at)],['Consentimiento',`${row.consent_version} · ${dates(row.consent_accepted_at)}`]]) details.append(make('dt',label),make('dd',value));
        byId('interview-review-status').value = row.status; byId('interview-notes').value = row.internal_notes ?? '';
        byId('interview-contact').href = `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent('University en Vivo — Solicitud de entrevista')}`;
        byId('interview-export').hidden = !staff.can_export; byId('interview-delete').hidden = !staff.can_delete;
        byId('interview-audit-button').hidden = staff.role !== 'admin'; byId('interview-audit').hidden = true;
        detail.hidden = false; message('');
      }, { parts: [[from?.tagName === 'TR' ? from.children[1] : byId('interview-detail-title'), byId('interview-detail-title')]], focus: () => {
        if (staff && request === detailGeneration) byId('interview-detail-title').focus();
      } });
    } catch (e) { if (staff && request === detailGeneration) message(e.message); }
    finally { motion.busy(trigger, false); }
  }
  function closeDetail() {
    detailGeneration++;
    const trigger = origin?.isConnected ? origin : null;
    const row = trigger?.closest('tr');
    return motion.morph(byId('interview-requests'), detail, row, () => { detail.hidden = true; current = null; }, {
      reverse: true, parts: [[byId('interview-detail-title'), row?.children[1]]],
      focus: () => (trigger ?? byId('interview-search')).focus()
    });
  }
  async function loadHealth() {
    if (staff?.role !== 'admin') return;
    try {
      const data = await api('/api/database-health');
      if (staff?.role !== 'admin') return;
      motion.text(byId('health-state'), { ok: 'Operativa', failed: 'Problemas detectados', unknown: 'Estado desconocido' }[data.state] ?? 'Estado desconocido', byId('health-panel'));
      motion.text(byId('health-details'), `Última comprobación completa o con error: ${dates(data.latest?.finished_at)}. Última comprobación ligera: ${data.latestProbe?.mode === 'connectivity' ? dates(data.latestProbe.finished_at) + (data.latestProbe.status === 'ok' ? ' (conexión correcta)' : ' (falló)') : 'No disponible'}. Última exitosa: ${dates(data.lastSuccess)}. Próxima: ${data.nextCheck ?? 'Programación no disponible'}. ${data.latest?.error_code ? 'La última comprobación detectó un error técnico; revisa los logs autorizados.' : ''}`, byId('health-panel'));
      const outbox = await api('/api/interview-admin?action=outbox');
      const failed = outbox.rows.filter(x => x.status === 'failed').length;
      if (staff?.role !== 'admin') return;
      motion.text(byId('notification-state'), `Avisos pendientes recientes: ${outbox.rows.length} (máximo mostrado: 30). Requieren revisión: ${failed}.`, byId('health-panel'));
    } catch (e) { if (staff?.role === 'admin') { motion.text(byId('health-state'), 'Estado desconocido', byId('health-panel')); motion.text(byId('health-details'), e.message, byId('health-panel')); } }
  }
  async function restore() {
    try { const result = await api('/api/interview-admin?action=session'); staff = result.staff; renderAccess(); await Promise.all([loadList(), loadHealth()]); return true; }
    catch { renderAccess(); return false; }
  }
  byId('staff-login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = byId('staff-login-button'); button.disabled = true; byId('staff-login-status').textContent = 'Verificando…';
    try {
      const data = await api('/api/interview-admin?action=login', { method:'POST', body:JSON.stringify({ email:byId('staff-email').value, password:byId('staff-password').value }) });
      staff = data.staff; renderAccess(); setLegacy(false); window.showDashboard(); byId('staff-login-status').textContent = '';
      await Promise.all([loadList(),loadHealth()]);
    } catch (e) { byId('staff-login-status').textContent = e.message; }
    finally { byId('staff-password').value = ''; button.disabled = false; }
  });
  byId('staff-logout').addEventListener('click', async () => {
    try { await api('/api/interview-admin?action=logout', { method:'POST' }); }
    catch (e) { message(e.message); return; }
    staff = null; renderAccess(); window.showLogin('Sesión personal cerrada.');
  });
  byId('staff-open-login').addEventListener('click', () => { byId('dashboard-view').hidden = true; byId('login-view').hidden = false; byId('staff-email').focus(); });
  byId('interview-search-form').addEventListener('submit', event => { event.preventDefault(); page=1; loadList(); });
  byId('interview-prev').addEventListener('click', () => { if(page>1) { page--; loadList(); } });
  byId('interview-next').addEventListener('click', () => { page++; loadList(); });
  byId('interview-close').addEventListener('click', closeDetail);
  byId('interview-review-form').addEventListener('submit', async event => {
    event.preventDefault(); if(!current) return; const button=byId('interview-save'); if(button.disabled) return; motion.busy(button, true); button.disabled=true; message('Guardando…');
    const editedId = current.id, editedGeneration = detailGeneration;
    try {
      const data = await api(`/api/interview-admin?id=${current.id}`, { method:'PATCH', body:JSON.stringify({ revision:current.revision, status:byId('interview-review-status').value, internal_notes:byId('interview-notes').value }) });
      if (!staff) return;
      if (current?.id === editedId && detailGeneration === editedGeneration) current=data.row;
      await loadList(); message('Cambios guardados.', 'success'); motion.confirm(button);
    } catch(e) { message(e.message); } finally { button.disabled=false; motion.busy(button, false); }
  });
  byId('interview-audit-button').addEventListener('click', async () => {
    if(!current) return;
    const id = current.id;
    try { const data=await api(`/api/interview-admin?action=audit&id=${id}`); if (!staff || current?.id !== id) return; const list=byId('interview-audit');
      motion.layout(listRoot, () => { list.replaceChildren();
      for(const event of data.events) list.append(make('li',`${dates(event.created_at)} · ${event.event_type} · ${labels[event.old_status] ?? '—'} → ${labels[event.new_status] ?? '—'}${event.notes_changed ? ' · Notas modificadas' : ''} · Cuenta: ${event.actor_id ?? 'Envío público'}`)); list.hidden=false;
      }, { elements: [list], enter: [list] });
    } catch(e) { message(e.message); }
  });
  byId('interview-export').addEventListener('click', async () => {
    if(!current || !confirm('¿Exportar esta solicitud con datos personales? Guárdala únicamente en un lugar institucional autorizado.')) return;
    try { const data=await api(`/api/interview-admin?action=export&id=${current.id}`,{method:'POST',body:JSON.stringify({confirm:true})});
      const url=URL.createObjectURL(new Blob([JSON.stringify(data.row,null,2)],{type:'application/json'})); const link=make('a');link.href=url;link.download=`solicitud-${current.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) { message(e.message); }
  });
  byId('interview-delete').addEventListener('click',async()=>{
    if(!current || prompt('Esta acción elimina permanentemente la solicitud y sus datos. Solo procede con una solicitud de eliminación autorizada. Escribe ELIMINAR para confirmar.') !== 'ELIMINAR')return;
    try { await api(`/api/interview-admin?id=${current.id}`,{method:'DELETE',body:JSON.stringify({revision:current.revision,confirmation:'ELIMINAR'})});byId('interview-detail').hidden=true;current=null;await loadList();message('Solicitud eliminada. Se conservó un evento técnico sin datos personales.'); }
    catch(e){message(e.message);}
  });
  byId('health-check').addEventListener('click',async()=>{
    const button=byId('health-check'); if (button.disabled) return; motion.busy(button, true);button.disabled=true;motion.text(byId('health-state'), 'Comprobando…', byId('health-panel'));
    try { await api('/api/database-health',{method:'POST'});await loadHealth(); }
    catch(e){if (staff?.role === 'admin') { motion.text(byId('health-state'), 'Estado desconocido', byId('health-panel'));motion.text(byId('health-details'), e.message, byId('health-panel')); }}
    finally{button.disabled=false;motion.busy(button, false);}
  });
  byId('notification-retry').addEventListener('click',async()=>{
    const button=byId('notification-retry');if (button.disabled) return;motion.busy(button, true);button.disabled=true;
    try { const result=await api('/api/interview-admin?action=outbox',{method:'POST'});await loadHealth();if (staff?.role !== 'admin') return;motion.text(byId('notification-state'), `Avisos procesados: ${result.processed}; aceptados por el proveedor: ${result.sent}; pendientes o fallidos: ${result.failed}.`, byId('health-panel'));motion.confirm(button); }
    catch(e){if (staff?.role === 'admin') motion.text(byId('notification-state'), e.message, byId('health-panel'));}
    finally{button.disabled=false;motion.busy(button, false);}
  });
  window.interviewAdmin = { restore, isAuthenticated: () => !!staff, setLegacy };
})();
