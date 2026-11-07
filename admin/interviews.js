(() => {
  const byId = id => document.getElementById(id);
  const labels = { pending: 'Pendiente', in_review: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada' };
  const dates = value => value ? new Intl.DateTimeFormat('es-PR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Puerto_Rico' }).format(new Date(value)) : 'No disponible';
  let staff = null, page = 1, current = null, generation = 0;
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
      current = null; generation++;
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
  function message(text, state = 'info') { byId('interview-admin-status').textContent = text; byId('interview-admin-status').dataset.state = state; }
  async function loadList() {
    if (!staff) return;
    const thisGeneration = ++generation;
    message('Cargando solicitudes…'); byId('interview-search-button').disabled = true;
    const params = new URLSearchParams({ page, q: byId('interview-search').value.trim(), status: byId('interview-filter').value, order: byId('interview-order').value });
    try {
      const data = await api(`/api/interview-admin?${params}`);
      if (thisGeneration !== generation || !staff) return;
      const tbody = byId('interview-rows'); tbody.replaceChildren();
      for (const row of data.rows) {
        const tr = make('tr');
        tr.append(make('td', row.full_name), make('td', row.topic), make('td', dates(row.created_at)), make('td', labels[row.status]));
        const td = make('td'), button = make('button', 'Revisar', 'secondary-button'); button.type = 'button';
        button.setAttribute('aria-label', `Revisar solicitud de ${row.full_name}`);
        button.addEventListener('click', () => openDetail(row.id)); td.append(button); tr.append(td); tbody.append(tr);
      }
      byId('interview-empty').hidden = data.rows.length > 0;
      const filtered = !!(params.get('q') || params.get('status') || page > 1);
      byId('interview-empty-title').textContent = filtered ? 'No encontramos solicitudes con estos filtros.' : 'Todavía no tenemos solicitudes.';
      byId('interview-empty-copy').textContent = filtered ? 'Prueba otra búsqueda o vuelve a la primera página.' : 'Cuando alguien quiera participar en University en Vivo, su solicitud aparecerá aquí.';
      byId('interview-prev').disabled = page === 1; byId('interview-next').disabled = !data.hasMore; byId('interview-page').textContent = `Página ${page}`;
      message('');
    } catch (e) { if (thisGeneration === generation) message(e.message); }
    finally { byId('interview-search-button').disabled = false; }
  }
  async function openDetail(id) {
    message('Cargando detalles…');
    try {
      const { row } = await api(`/api/interview-admin?id=${encodeURIComponent(id)}`);
      if (!staff) return; current = row;
      byId('interview-detail-title').textContent = row.topic;
      const details = byId('interview-detail-data'); details.replaceChildren();
      for (const [label,value] of [['Nombre',row.full_name],['Correo',row.email],['Relación con la escuela',row.school_affiliation || 'No indicada'],['Motivación',row.motivation],['Experiencia previa',row.previous_experience === null ? 'Prefiere no responder' : row.previous_experience ? 'Sí' : 'No'],['Recibida',dates(row.created_at)],['Consentimiento',`${row.consent_version} · ${dates(row.consent_accepted_at)}`]]) details.append(make('dt',label),make('dd',value));
      byId('interview-review-status').value = row.status; byId('interview-notes').value = row.internal_notes ?? '';
      byId('interview-contact').href = `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent('University en Vivo — Solicitud de entrevista')}`;
      byId('interview-export').hidden = !staff.can_export; byId('interview-delete').hidden = !staff.can_delete;
      byId('interview-audit-button').hidden = staff.role !== 'admin'; byId('interview-audit').hidden = true;
      byId('interview-detail').hidden = false; byId('interview-detail-title').focus(); message('');
    } catch (e) { message(e.message); }
  }
  async function loadHealth() {
    if (staff?.role !== 'admin') return;
    try {
      const data = await api('/api/database-health');
      byId('health-state').textContent = { ok: 'Operativa', failed: 'Problemas detectados', unknown: 'Estado desconocido' }[data.state] ?? 'Estado desconocido';
      byId('health-details').textContent = `Última comprobación completa o con error: ${dates(data.latest?.finished_at)}. Última comprobación ligera: ${data.latestProbe?.mode === 'connectivity' ? dates(data.latestProbe.finished_at) + (data.latestProbe.status === 'ok' ? ' (conexión correcta)' : ' (falló)') : 'No disponible'}. Última exitosa: ${dates(data.lastSuccess)}. Próxima: ${data.nextCheck ?? 'Programación no disponible'}. ${data.latest?.error_code ? 'La última comprobación detectó un error técnico; revisa los logs autorizados.' : ''}`;
      const outbox = await api('/api/interview-admin?action=outbox');
      const failed = outbox.rows.filter(x => x.status === 'failed').length;
      byId('notification-state').textContent = `Avisos pendientes recientes: ${outbox.rows.length} (máximo mostrado: 30). Requieren revisión: ${failed}.`;
    } catch (e) { byId('health-state').textContent = 'Estado desconocido'; byId('health-details').textContent = e.message; }
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
  byId('interview-close').addEventListener('click', () => { byId('interview-detail').hidden=true; current=null; byId('interview-search').focus(); });
  byId('interview-review-form').addEventListener('submit', async event => {
    event.preventDefault(); if(!current) return; const button=byId('interview-save'); if(button.disabled) return; button.disabled=true; message('Guardando…');
    try {
      const data = await api(`/api/interview-admin?id=${current.id}`, { method:'PATCH', body:JSON.stringify({ revision:current.revision, status:byId('interview-review-status').value, internal_notes:byId('interview-notes').value }) });
      current=data.row; await loadList(); message('Cambios guardados.', 'success');
    } catch(e) { message(e.message); } finally { button.disabled=false; }
  });
  byId('interview-audit-button').addEventListener('click', async () => {
    if(!current) return;
    try { const data=await api(`/api/interview-admin?action=audit&id=${current.id}`); const list=byId('interview-audit'); list.replaceChildren();
      for(const event of data.events) list.append(make('li',`${dates(event.created_at)} · ${event.event_type} · ${labels[event.old_status] ?? '—'} → ${labels[event.new_status] ?? '—'}${event.notes_changed ? ' · Notas modificadas' : ''} · Cuenta: ${event.actor_id ?? 'Envío público'}`)); list.hidden=false;
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
    const button=byId('health-check');button.disabled=true;byId('health-state').textContent='Comprobando…';
    try { await api('/api/database-health',{method:'POST'});await loadHealth(); }
    catch(e){byId('health-state').textContent='Estado desconocido';byId('health-details').textContent=e.message;}
    finally{button.disabled=false;}
  });
  byId('notification-retry').addEventListener('click',async()=>{
    const button=byId('notification-retry');button.disabled=true;
    try { const result=await api('/api/interview-admin?action=outbox',{method:'POST'});await loadHealth();byId('notification-state').textContent=`Avisos procesados: ${result.processed}; aceptados por el proveedor: ${result.sent}; pendientes o fallidos: ${result.failed}.`; }
    catch(e){byId('notification-state').textContent=e.message;}
    finally{button.disabled=false;}
  });
  window.interviewAdmin = { restore, isAuthenticated: () => !!staff, setLegacy };
})();
