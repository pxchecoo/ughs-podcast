/* Interview-only motion. No dependency, persistent clones, or changes to resting styles. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const easing = 'cubic-bezier(.22, 1, .36, 1)';
  const running = new Set(), channels = new WeakMap(), textSnapshots = new Map();
  let shared = null;
  const enabled = () => !preference.matches && typeof Element.prototype.animate === 'function';
  const rect = el => el?.isConnected && !el.hidden ? el.getBoundingClientRect() : null;
  const visible = box => box && box.width > 0 && box.height > 0;

  function snapshot(el, box) {
    const layer = document.createElement('div');
    layer.className = 'interview-motion-layer'; layer.inert = true; layer.setAttribute('aria-hidden', 'true');
    const ghost = el.cloneNode(true);
    ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    ghost.classList.add('interview-motion-ghost');
    // A clone outside its original ancestry no longer matches ID/ancestor rules.
    // Freeze its visual styles before insertion, including right-aligned table
    // cells and detail spacing, without copying animations or application IDs.
    const sources = [el, ...el.querySelectorAll('*')], copies = [ghost, ...ghost.querySelectorAll('*')];
    const properties = ['font', 'color', 'background', 'border', 'borderRadius', 'padding', 'margin', 'boxSizing', 'boxShadow', 'textAlign', 'letterSpacing', 'whiteSpace', 'overflowWrap', 'maxWidth', 'gap', 'alignItems', 'justifyContent', 'flexDirection', 'gridTemplateColumns'];
    sources.forEach((source, i) => {
      const style = getComputedStyle(source), copy = copies[i];
      properties.forEach(property => { copy.style[property] = style[property]; });
      if (i) copy.style.display = style.display;
      copy.style.animation = 'none'; copy.style.transition = 'none'; copy.removeAttribute('data-motion-busy');
    });
    if (el.tagName === 'TR') [...ghost.children].forEach((cell, i) => { cell.style.width = `${el.children[i].getBoundingClientRect().width}px`; });
    Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    layer.append(ghost);
    return { layer, ghost };
  }

  function stop(el, channel = 'layout') { channels.get(el)?.get(channel)?.cancel(); }
  function animate(el, frames, { duration = 320, delay = 0, channel = 'layout', ...options } = {}) {
    if (!enabled() || !el?.isConnected) return null;
    stop(el, channel);
    const animation = el.animate(frames, { duration, delay, easing, fill: 'both', ...options });
    if (!channels.has(el)) channels.set(el, new Map());
    channels.get(el).set(channel, animation); running.add(animation);
    const cleanup = () => {
      if (channels.get(el)?.get(channel) === animation) channels.get(el).delete(channel);
      running.delete(animation); animation.cancel();
    };
    animation.finished.then(cleanup, cleanup);
    return animation;
  }

  // Measure the current presentation before cancelling: rapid reversals start where the
  // previous animation actually is, rather than at its last committed layout.
  function layout(root, update, { elements = [], enter = [], leave = [], direction = 1 } = {}) {
    if (!root) { update(); return; }
    const nodes = [...new Set(elements)].filter(Boolean);
    const before = new Map(nodes.map(el => [el, rect(el)]));
    const outgoing = enabled() ? leave.filter(el => visible(rect(el))).map(el => snapshot(el, rect(el))) : [];
    const height = rect(root)?.height;
    stop(root, 'height'); nodes.forEach(el => stop(el));
    update();
    outgoing.forEach(({layer, ghost}) => {
      document.body.append(layer);
      const animation = animate(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-direction * 12}px)`, clipPath: 'inset(0 0 100% 0)' }], { duration: 180 });
      if (animation) animation.finished.then(() => layer.remove(), () => layer.remove());
      else layer.remove();
    });
    if (!enabled() || !visible(rect(root))) return;
    const afterHeight = rect(root).height;
    if (height != null && Math.abs(height - afterHeight) > .5) {
      animate(root, [{ height: `${height}px`, overflow: 'clip' }, { height: `${afterHeight}px`, overflow: 'clip' }], { channel: 'height', duration: 380 });
    }
    // Read every destination before starting animations. Nested cells compensate
    // for their moving row, so column reflow and row travel never double up.
    const deltas = new Map();
    nodes.forEach(el => {
      const first = before.get(el), last = rect(el);
      if (visible(first) && visible(last)) deltas.set(el, { x: first.left - last.left, y: first.top - last.top });
    });
    deltas.forEach((delta, el) => {
      let ancestor = el.parentElement;
      while (ancestor && !deltas.has(ancestor)) ancestor = ancestor.parentElement;
      const parent = deltas.get(ancestor);
      const x = delta.x - (parent?.x ?? 0), y = delta.y - (parent?.y ?? 0);
      if (Math.abs(x) + Math.abs(y) > .5) animate(el, [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }]);
    });
    enter.filter(Boolean).forEach((el, index) => {
      if (!visible(before.get(el)) && visible(rect(el))) animate(el, [
        { opacity: 0, transform: `translateX(${direction * 12}px)`, clipPath: 'inset(0 0 100% 0)' },
        { opacity: 1, transform: 'none', clipPath: 'inset(0)' }
      ], { duration: 300, delay: Math.min(index * 22, 110) });
    });
  }

  function text(el, value, root = el?.parentElement) {
    if (!el || el.textContent === value) return;
    textSnapshots.get(el)?.();
    const first = rect(el);
    const outgoing = enabled() && el.textContent && visible(first) ? snapshot(el, first) : null;
    layout(root, () => { el.textContent = value; }, { elements: [...root.children] });
    const last = rect(el);
    if (outgoing) {
      document.body.append(outgoing.layer);
      const animation = animate(outgoing.ghost, [
        { opacity: 1, transform: 'none', clipPath: 'inset(0)' },
        { opacity: 0, transform: `translate(${(last?.left ?? first.left) - first.left}px, -3px)`, clipPath: 'inset(0 0 100% 0)' }
      ], { duration: 180, channel: 'text' });
      const cleanup = () => {
        outgoing.layer.remove(); animation?.cancel();
        if (textSnapshots.get(el) === cleanup) textSnapshots.delete(el);
      };
      textSnapshots.set(el, cleanup);
      if (animation) animation.finished.then(cleanup, cleanup);
      else cleanup();
    }
    animate(el, [{ opacity: 0, clipPath: 'inset(100% 0 0 0)' }, { opacity: 1, clipPath: 'inset(0)' }], { duration: 220, channel: 'text' });
    if (el.tagName === 'BUTTON' && visible(first) && visible(last) && Math.abs(first.width - last.width) > .5) {
      animate(el, [{ width: `${first.width}px` }, { width: `${last.width}px` }], { duration: 240, channel: 'width' });
    }
  }

  function busy(button, value) {
    if (!button) return;
    if (value) {
      const box = rect(button);
      // Hold the real control's dimensions across label and disabled-state changes.
      if (!button.hasAttribute('data-motion-busy')) {
        button._interviewSize = [button.style.minWidth, button.style.minHeight];
        if (visible(box)) {
          const style = getComputedStyle(button);
          button.style.minWidth = style.width; button.style.minHeight = style.height;
        }
      }
      button.dataset.motionBusy = ''; button.setAttribute('aria-busy', 'true');
    } else {
      delete button.dataset.motionBusy; button.removeAttribute('aria-busy');
      if (button._interviewSize) {
        [button.style.minWidth, button.style.minHeight] = button._interviewSize;
        delete button._interviewSize;
      }
    }
  }
  function confirm(button) {
    animate(button, [{ transform: 'scale(.985)' }, { transform: 'scale(1)' }], { channel: 'feedback', duration: 240 });
  }

  function cancelShared() {
    if (!shared) return;
    const previous = shared; shared = null; previous.cancelled = true;
    // Skipping a visual transition must never discard its confirmed DOM update.
    previous.commit?.();
    previous.transition?.skipTransition(); previous.cleanup();
  }

  // Match a source to a destination without changing the final DOM structure. The
  // title can travel independently so long panels never stretch their typography.
  function morph(root, from, to, update, { focus, parts = [], reverse = false, native = true } = {}) {
    cancelShared();
    if (!enabled() || !visible(rect(from)) || !to?.isConnected) {
      layout(root, update, { elements: [...root.children], enter: [to] });
      focus?.(); return Promise.resolve();
    }
    const pairs = [[from, to], ...parts].filter(([a,b]) => a && b);
    const state = { cancelled: false, cleanup: () => {} }; shared = state;
    const names = pairs.map((_, i) => `interview-shared-${i}`);
    const restore = pairs.flat().map(el => [el, el.style.viewTransitionName]);
    const restoreNames = () => restore.forEach(([el, value]) => { el.style.viewTransitionName = value; });
    state.cleanup = () => {
      restoreNames();
      from.classList.remove('interview-motion-source');
      to.classList.remove('interview-motion-source');
      document.documentElement.removeAttribute('data-interview-transition');
    };
    if (native && typeof document.startViewTransition === 'function') {
      document.documentElement.dataset.interviewTransition = '';
      if (reverse && from !== to && !to.contains(from)) to.classList.add('interview-motion-source');
      pairs.forEach(([a], i) => { a.style.viewTransitionName = names[i]; });
      state.commit = () => {
        if (state.committed) return;
        state.committed = true;
        restoreNames(); update();
        to.classList.remove('interview-motion-source');
        if (!state.cancelled && from !== to && !from.hidden && !from.contains(to)) from.classList.add('interview-motion-source');
        if (!state.cancelled) pairs.forEach(([, b], i) => { b.style.viewTransitionName = names[i]; });
        focus?.();
      };
      const transition = document.startViewTransition(state.commit);
      state.transition = transition;
      // ready rejects when snapshots cannot be captured (background tabs, resize,
      // a newer transition). The DOM update still runs; no navigation depends on it.
      transition.ready.catch(() => {});
      transition.finished.finally(() => {
        if (shared === state) { state.cleanup(); shared = null; }
      }).catch(() => {});
      return transition.updateCallbackDone;
    }
    const first = rect(from);
    // A temporary inert snapshot supplies the outgoing half on older browsers.
    // It is removed on finish, interruption, reduced motion, resize and logout.
    const { layer, ghost } = snapshot(from, first);
    document.body.append(layer);
    layout(root, update, { elements: [...root.children] });
    const last = rect(to);
    if (!visible(last)) { layer.remove(); shared = null; focus?.(); return Promise.resolve(); }
    if (from !== to) from.classList.add('interview-motion-source');
    const previousCleanup = state.cleanup;
    state.cleanup = () => { previousCleanup(); layer.remove(); from.classList.remove('interview-motion-source'); };
    const x = last.left - first.left, y = last.top - first.top;
    const animation = animate(ghost, [
      { transform: 'none', width: `${first.width}px`, height: `${first.height}px`, opacity: 1 },
      { transform: `translate(${x}px, ${y}px)`, width: `${last.width}px`, height: `${last.height}px`, opacity: 0 }
    ], { duration: 380 });
    if (!reverse) animate(to, [
      { transform: `translate(${-x}px, ${-y}px)`, clipPath: `inset(0 ${Math.max(0, last.width - first.width)}px ${Math.max(0, last.height - first.height)}px 0)`, opacity: 0 },
      { transform: 'none', clipPath: 'inset(0)', opacity: 1 }
    ], { duration: 380 });
    // Keep the reverse destination covered until its outgoing snapshot arrives.
    else animate(to, [{ opacity: 0 }, { opacity: 1 }], { duration: 380 });
    animation?.finished.then(() => {
      if (shared === state) { state.cleanup(); shared = null; }
    }, () => { if (shared === state) { state.cleanup(); shared = null; } });
    focus?.(); return Promise.resolve();
  }

  function reset() {
    cancelShared(); [...running].forEach(animation => animation.cancel());
    [...textSnapshots.values()].forEach(cleanup => cleanup());
    document.querySelectorAll('.interview-motion-layer').forEach(el => el.remove());
  }
  preference.addEventListener('change', () => { if (preference.matches) reset(); });
  addEventListener('resize', reset, { passive: true });
  addEventListener('pagehide', reset);
  // An active snapshot must never prevent the next keyboard/pointer interaction.
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, cancelShared, { capture: true });
  window.InterviewMotion = { layout, text, busy, confirm, morph, reset, animate, enabled };
})();
