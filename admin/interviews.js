(() => {
  const byId = id => document.getElementById(id);
  const motion = window.InterviewMotion;
  const listRoot = byId('interview-staff-content'), detail = byId('interview-detail');
  const labels = { pending: 'Pendiente', in_review: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada' };
  const dates = value => value ? new Intl.DateTimeFormat('es-PR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Puerto_Rico' }).format(new Date(value)) : 'No disponible';
  let staff = null, page = 1, current = null, generation = 0, detailGeneration = 0;
  let origin = null, displayedPage = 1, view = 'active';
  const dialog = byId('interview-delete-dialog');
  let deletion = null, deletionBusy = false, dialogClosing = false, dialogOrigin = null;
  const canDelete = () => staff?.role === 'admin' && staff.can_delete === true;
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
    byId('interview-view-controls').hidden = !canDelete();
    if (!staff) {
      motion.reset(); dialog.close(); deletion = null; view = 'active'; current = null; origin = null; generation++; detailGeneration++;
      byId('interview-active-view').setAttribute('aria-pressed', 'true');
      byId('interview-trash-view').setAttribute('aria-pressed', 'false');
      byId('interview-rows').replaceChildren(); byId('interview-detail').hidden = true;
      byId('interview-detail-data').replaceChildren(); byId('interview-detail-title').textContent = '';
      byId('interview-notes').value = ''; byId('interview-contact').removeAttribute('href'); byId('interview-call').removeAttribute('href');
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
  async function loadList({ quiet = false, collapse = false } = {}) {
    if (!staff) return;
    const thisGeneration = ++generation;
    if (!quiet) message('Cargando solicitudes…'); motion.busy(byId('interview-search-button'), true); byId('interview-search-button').disabled = true;
    byId('interview-rows').setAttribute('aria-busy', 'true');
    const params = new URLSearchParams({ page, view, q: byId('interview-search').value.trim(), status: byId('interview-filter').value, order: byId('interview-order').value });
    try {
      const data = await api(`/api/interview-admin?${params}`);
      if (thisGeneration !== generation || !staff) return false;
      if (!data.rows.length && page > 1) { page--; return await loadList({ quiet, collapse }); }
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
        byId('interview-empty-title').textContent = filtered ? 'No encontramos solicitudes con estos filtros.' : (view === 'trash' ? 'La papelera está vacía.' : 'Todavía no tenemos solicitudes.');
        byId('interview-empty-copy').textContent = filtered ? 'Prueba otra búsqueda o vuelve a la primera página.' : (view === 'trash' ? 'Las solicitudes eliminadas aparecerán aquí hasta su restauración o eliminación permanente autorizada.' : 'Cuando alguien quiera participar en University en Vivo, su solicitud aparecerá aquí.');
        byId('interview-prev').disabled = page === 1; byId('interview-next').disabled = !data.hasMore; motion.text(byId('interview-page'), `Página ${page}`, byId('interview-page').parentElement);
      }, { elements: [...new Set([...oldRows, ...rows])].flatMap(tr => [tr, ...tr.children]).concat([...tbody.closest('table').querySelectorAll('th'), byId('interview-empty'), byId('interview-page').parentElement, detail]), enter: [...rows, byId('interview-empty')], leave: oldRows.filter(tr => !rows.includes(tr)), direction: page < displayedPage ? -1 : 1, collapse });
      displayedPage = page;
      if (focused?.isConnected && rows.some(tr => tr.contains(focused))) focused.focus({ preventScroll: true });
      if (!quiet) message('');
      return true;
    } catch (e) { if (thisGeneration === generation) message(e.message); return false; }
    finally { if (thisGeneration === generation) { byId('interview-search-button').disabled = false; motion.busy(byId('interview-search-button'), false); byId('interview-rows').removeAttribute('aria-busy'); } }
  }
  async function openDetail(id, trigger) {
    const request = ++detailGeneration;
    motion.busy(trigger, true);
    message('Cargando detalles…');
    try {
      const { row } = await api(`/api/interview-admin?id=${encodeURIComponent(id)}&view=${view}`);
      if (!staff || request !== detailGeneration) return;
      const from = detail.hidden ? trigger?.closest('tr') : detail;
      await motion.morph(byId('interview-requests'), from, detail, () => {
        if (!staff || request !== detailGeneration) return;
        current = row; origin = trigger;
        byId('interview-detail-title').textContent = row.topic;
        const details = byId('interview-detail-data'); details.replaceChildren();
        for (const [label,value] of [['Nombre',row.full_name],['Correo',row.email || 'No especificado'],['Teléfono',row.phone_number || 'No especificado'],['Contacto preferido',({ phone: 'Llamada telefónica', email: 'Correo electrónico', both: 'Ambas' })[row.preferred_contact_method] || 'No especificado'],['Relación con la escuela',row.school_affiliation || 'No indicada'],['Motivación',row.motivation],['Experiencia previa',row.previous_experience === null ? 'Prefiere no responder' : row.previous_experience ? 'Sí' : 'No'],['Recibida',dates(row.created_at)],['Consentimiento',`${row.consent_version} · ${dates(row.consent_accepted_at)}`]]) details.append(make('dt',label),make('dd',value));
        byId('interview-review-status').value = row.status; byId('interview-notes').value = row.internal_notes ?? '';
        byId('interview-contact').href = `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent('University en Vivo — Solicitud de entrevista')}`;
        const deleted = !!row.deleted_at;
        byId('interview-review-form').hidden = deleted;
        byId('interview-contact').hidden = deleted || !row.email;
        byId('interview-copy-email').hidden = deleted || !row.email;
        byId('interview-call').hidden = deleted || !row.phone_number;
        byId('interview-copy-phone').hidden = deleted || !row.phone_number;
        byId('interview-call').removeAttribute('href');
        if (row.phone_number) byId('interview-call').href = `tel:${row.phone_number}`;
        byId('interview-export').hidden = deleted || !staff.can_export;
        byId('interview-delete').hidden = deleted || !canDelete();
        byId('interview-restore').hidden = !deleted || !canDelete();
        byId('interview-purge').hidden = !deleted || !canDelete() || !staff.can_purge;
        byId('interview-audit-button').hidden = staff.role !== 'admin'; byId('interview-audit').hidden = true;
        detail.hidden = false; detail.inert = false; message('');
      }, { parts: [[from?.tagName === 'TR' ? from.children[1] : byId('interview-detail-title'), byId('interview-detail-title')]], focus: () => {
        if (staff && request === detailGeneration) byId('interview-detail-title').focus();
      } });
    } catch (e) { if (staff && request === detailGeneration) message(e.message); }
    finally { motion.busy(trigger, false); }
  }
  function closeDetail({ settle = false } = {}) {
    detailGeneration++;
    const trigger = origin?.isConnected ? origin : null;
    const row = trigger?.closest('tr');
    return motion.morph(byId('interview-requests'), detail, row, () => { detail.hidden = true; current = null; }, {
      reverse: true, settle, parts: [[byId('interview-detail-title'), row?.children[1]]],
      focus: () => (trigger ?? byId('interview-search')).focus({ preventScroll: true })
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
  for (const [id, field, confirmation] of [['interview-copy-email', 'email', 'Correo copiado.'], ['interview-copy-phone', 'phone_number', 'Teléfono copiado.']]) {
    byId(id).addEventListener('click', async () => {
      if (!staff || !current || current.deleted_at || !current[field]) return;
      try { await navigator.clipboard.writeText(current[field]); if (staff && current) { message(confirmation, 'success'); motion.confirm(byId(id)); } }
      catch { if (staff && current) message('No pudimos copiar. Selecciona el dato y cópialo manualmente.'); }
    });
  }
  byId('interview-export').addEventListener('click', async () => {
    if(!current || !confirm('¿Exportar esta solicitud con datos personales? Guárdala únicamente en un lugar institucional autorizado.')) return;
    try { const data=await api(`/api/interview-admin?action=export&id=${current.id}`,{method:'POST',body:JSON.stringify({confirm:true})});
      const url=URL.createObjectURL(new Blob([JSON.stringify(data.row,null,2)],{type:'application/json'})); const link=make('a');link.href=url;link.download=`solicitud-${current.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) { message(e.message); }
  });
  function showDeletion(kind) {
    if (!current || !canDelete() || deletionBusy || dialog.open || (kind === 'purge' && !staff.can_purge)) return;
    deletion = { kind, id: current.id, revision: current.revision, stage: 1 };
    dialogOrigin = byId({ trash: 'interview-delete', restore: 'interview-restore', purge: 'interview-purge' }[kind]);
    byId('interview-delete-title').textContent = kind === 'restore' ? '¿Restaurar esta solicitud?' : kind === 'purge' ? '¿Eliminar permanentemente esta solicitud?' : '¿Eliminar esta solicitud?';
    byId('interview-delete-copy').textContent = kind === 'restore' ? 'Esta solicitud volverá a la lista de entrevistas con su estado y datos conservados.' : kind === 'purge' ? 'Se borrarán sus datos personales y no podrás recuperarla. Esta acción requiere una confirmación adicional.' : 'Esta solicitud se eliminará de la lista de entrevistas. ¿Deseas continuar?';
    byId('interview-delete-confirm').textContent = kind === 'restore' ? 'Restaurar solicitud' : kind === 'purge' ? 'Continuar' : 'Eliminar solicitud';
    byId('interview-purge-verification').hidden = true; byId('interview-purge-text').value = '';
    byId('interview-delete-error').textContent = ''; dialogClosing = false;
    dialog.showModal();
    motion.animate(dialog, [{ opacity: 0, transform: 'translateY(8px) scale(.97)', clipPath: 'inset(0 0 12% 0 round 24px)' }, { opacity: 1, transform: 'none', clipPath: 'inset(0 round 24px)' }], { duration: 260, channel: 'dialog' });
    [...dialog.children].forEach((el, i) => motion.animate(el, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, delay: 45 + i * 15, channel: 'dialog-content' }));
  }
  async function hideDeletion() {
    if (!dialog.open || dialogClosing) return;
    dialogClosing = true;
    const animation = motion.animate(dialog, [{ opacity: Number(getComputedStyle(dialog).opacity), transform: getComputedStyle(dialog).transform }, { opacity: 0, transform: 'translateY(4px) scale(.98)' }], { duration: 160, channel: 'dialog' });
    await animation?.finished.catch(() => {});
    dialog.close(); dialogClosing = false; deletion = null;
    if (staff && dialogOrigin?.isConnected) dialogOrigin.focus({ preventScroll: true });
    dialogOrigin = null;
  }
  byId('interview-delete').addEventListener('click', () => showDeletion('trash'));
  byId('interview-restore').addEventListener('click', () => showDeletion('restore'));
  byId('interview-purge').addEventListener('click', () => showDeletion('purge'));
  byId('interview-delete-cancel').addEventListener('click', () => { if (!deletionBusy) hideDeletion(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!deletionBusy) hideDeletion(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(el => el.getClientRects().length);
    event.preventDefault();
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement);
    const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    controls[next].focus();
  });
  byId('interview-delete-confirm').addEventListener('click', async () => {
    if (!deletion || deletionBusy || dialogClosing) return;
    if (deletion.kind === 'purge' && deletion.stage === 1) {
      deletion.stage = 2;
      motion.layout(dialog, () => {
        byId('interview-purge-verification').hidden = false;
        byId('interview-delete-confirm').textContent = 'Eliminar permanentemente';
      }, { elements: [...dialog.children], enter: [byId('interview-purge-verification')] });
      byId('interview-purge-text').focus({ preventScroll: true }); return;
    }
    if (deletion.kind === 'purge' && byId('interview-purge-text').value !== 'ELIMINAR PERMANENTEMENTE') {
      motion.text(byId('interview-delete-error'), 'Escribe ELIMINAR PERMANENTEMENTE para confirmar.', dialog); return;
    }
    const operation = { ...deletion }, button = byId('interview-delete-confirm');
    const label = button.textContent;
    deletionBusy = true; motion.busy(button, true); button.disabled = true;
    byId('interview-delete-cancel').disabled = true;
    byId('interview-delete-error').textContent = '';
    motion.text(button, 'Procesando…', dialog); dialog.setAttribute('aria-busy', 'true');
    try {
      const action = operation.kind === 'trash' ? '' : `&action=${operation.kind}`;
      const result = await api(`/api/interview-admin?id=${operation.id}${action}`, { method: operation.kind === 'restore' ? 'POST' : 'DELETE', body: JSON.stringify({ revision: operation.revision, confirmation: operation.kind === 'restore' ? 'RESTAURAR' : operation.kind === 'purge' ? 'ELIMINAR PERMANENTEMENTE' : 'ELIMINAR' }) });
      if (result.ok !== true) throw new Error('No pudimos confirmar la operación. Revisa los detalles antes de reintentar.');
      if (!staff) return;
      await hideDeletion();
      if (current?.id === operation.id) {
        await closeDetail({ settle: true });
      }
      const refreshed = await loadList({ quiet: true, collapse: true });
      if (!staff) return;
      if (!refreshed) {
        const rows = [...byId('interview-rows').children], removed = rows.find(tr => tr.dataset.requestId === operation.id);
        motion.layout(listRoot, () => removed?.remove(), { elements: rows, leave: removed ? [removed] : [], collapse: true });
      }
      const confirmation = { trash: 'Solicitud enviada a la papelera.', restore: 'Solicitud restaurada.', purge: 'Solicitud eliminada permanentemente.' }[operation.kind];
      message(confirmation + (refreshed ? '' : ' No pudimos actualizar la paginación; reintenta la búsqueda.'), 'success');
      byId('interview-search').focus({ preventScroll: true });
    } catch (e) {
      if (staff && dialog.open) motion.text(byId('interview-delete-error'), e.message, dialog);
    } finally {
      deletionBusy = false; button.disabled = false; byId('interview-delete-cancel').disabled = false;
      motion.busy(button, false); button.textContent = label; dialog.removeAttribute('aria-busy');
    }
  });
  async function changeView(next) {
    if (deletionBusy || dialog.open || !canDelete() || view === next) return;
    if (!detail.hidden) await closeDetail();
    else detailGeneration++;
    view = next; page = 1;
    byId('interview-active-view').setAttribute('aria-pressed', String(view === 'active'));
    byId('interview-trash-view').setAttribute('aria-pressed', String(view === 'trash'));
    await loadList();
  }
  byId('interview-active-view').addEventListener('click', () => changeView('active'));
  byId('interview-trash-view').addEventListener('click', () => changeView('trash'));
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
