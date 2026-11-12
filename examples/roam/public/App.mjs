function replaceBetween(start, end, content) {
  const parent = start.parentNode;
  if (!parent || parent !== end.parentNode) {
    throw new Error('Conditional boundary is detached');
  }
  let current = start.nextSibling;
  while (current && current !== end) {
    const next = current.nextSibling;
    parent.removeChild(current);
    current = next;
  }
  parent.insertBefore(content, end);
}

function moveBoundaryBefore(start, end, reference) {
  const parent = reference.parentNode;
  if (!parent || parent !== start.parentNode || parent !== end.parentNode) {
    throw new Error('Boundary move target is detached');
  }
  const nodes = [];
  let current = start;
  while (current) {
    nodes.push(current);
    if (current === end) break;
    current = current.nextSibling;
  }
  for (const node of nodes) {
    parent.insertBefore(node, reference);
  }
}

function cloneScope(scope) {
  const snapshot = {};
  for (const key of Object.keys(scope)) {
    snapshot[key] = scope[key];
  }
  return snapshot;
}

function hasScopeChanged(beforeScope, afterScope) {
  const beforeKeys = Object.keys(beforeScope);
  const afterKeys = Object.keys(afterScope);
  if (beforeKeys.length !== afterKeys.length) {
    return true;
  }
  for (const key of afterKeys) {
    if (!Object.prototype.hasOwnProperty.call(beforeScope, key)) {
      return true;
    }
    if (!Object.is(beforeScope[key], afterScope[key])) {
      return true;
    }
  }
  return false;
}

function collectDirtyBindings(beforeScope, afterScope) {
  const dirty = [];
  const seen = new Set();
  for (const key of Object.keys(beforeScope)) {
    seen.add(key);
    if (
      !Object.prototype.hasOwnProperty.call(afterScope, key) ||
      !Object.is(beforeScope[key], afterScope[key])
    ) {
      dirty.push(key);
    }
  }
  for (const key of Object.keys(afterScope)) {
    if (seen.has(key)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(beforeScope, key)) {
      dirty.push(key);
    }
  }
  return dirty;
}

function normalizeDirtyState(dirtyState) {
  if (Array.isArray(dirtyState)) {
    return { bindings: dirtyState, paths: [] };
  }
  if (!dirtyState || typeof dirtyState !== 'object') {
    return { bindings: [], paths: [] };
  }
  return {
    bindings: Array.isArray(dirtyState.bindings) ? dirtyState.bindings : [],
    paths: Array.isArray(dirtyState.paths) ? dirtyState.paths : [],
  };
}

const __weiv_observableBrand = Symbol.for('weiv.observable');

function __weiv_getObservableNode(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return null;
  }
  const node = Reflect.get(value, __weiv_observableBrand);
  if (!node || typeof node !== 'object') {
    return null;
  }
  return node;
}

function __weiv_isObservable(value) {
  return __weiv_getObservableNode(value) !== null;
}

const __weiv_trackedRootCache = new Map();
const __weiv_trackedSubscribers = new Set();
const __weiv_pendingTrackedPathIds = new Set();
let __weiv_trackedFlushScheduled = false;

function __weiv_findTrackedRootPlan(bindingName) {
  if (!trackedStateGraph || !Array.isArray(trackedStateGraph.roots)) {
    return null;
  }
  for (const root of trackedStateGraph.roots) {
    if (root && root.bindingName === bindingName) {
      return root;
    }
  }
  return null;
}

function __weiv_markTrackedPathsForWrite(rootId, fullPath) {
  if (!trackedStateGraph || !Array.isArray(trackedStateGraph.paths)) {
    return;
  }
  for (const pathRecord of trackedStateGraph.paths) {
    if (!pathRecord || pathRecord.rootId !== rootId || typeof pathRecord.path !== 'string')
      continue;
    if (pathRecord.path === fullPath || pathRecord.path.startsWith(`${fullPath}.`)) {
      __weiv_pendingTrackedPathIds.add(pathRecord.pathId);
    }
  }
}

function __weiv_scheduleTrackedFlush() {
  if (__weiv_trackedFlushScheduled) {
    return;
  }
  __weiv_trackedFlushScheduled = true;
  globalThis.queueMicrotask(() => {
    __weiv_trackedFlushScheduled = false;
    const dirtyPaths = Array.from(__weiv_pendingTrackedPathIds);
    __weiv_pendingTrackedPathIds.clear();
    if (dirtyPaths.length === 0) {
      return;
    }
    for (const instance of Array.from(__weiv_trackedSubscribers)) {
      if (!instance || instance.destroyed) {
        __weiv_trackedSubscribers.delete(instance);
        continue;
      }
      if (typeof instance.updateDirty === 'function') {
        const scope = instance.refresh();
        instance.updateDirty({ bindings: [], paths: dirtyPaths }, scope);
      } else if (typeof instance.update === 'function') {
        instance.update();
      }
    }
  });
}

function __weiv_wrapTrackedValue(rootId, currentPath, value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  const proxy = new Proxy(value, {
    get(target, prop, receiver) {
      const result = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string') {
        return result;
      }
      const nextPath = currentPath ? `${currentPath}.${prop}` : prop;
      return __weiv_wrapTrackedValue(rootId, nextPath, result);
    },
    set(target, prop, nextValue, receiver) {
      const updated = Reflect.set(target, prop, nextValue, receiver);
      if (updated && typeof prop === 'string') {
        const nextPath = currentPath ? `${currentPath}.${prop}` : prop;
        __weiv_markTrackedPathsForWrite(rootId, nextPath);
        __weiv_scheduleTrackedFlush();
      }
      return updated;
    },
    deleteProperty(target, prop) {
      const updated = Reflect.deleteProperty(target, prop);
      if (updated && typeof prop === 'string') {
        const nextPath = currentPath ? `${currentPath}.${prop}` : prop;
        __weiv_markTrackedPathsForWrite(rootId, nextPath);
        __weiv_scheduleTrackedFlush();
      }
      return updated;
    },
  });
  return proxy;
}

function __weiv_getTrackedRoot(bindingName, value) {
  if (__weiv_isObservable(value)) {
    return value;
  }
  const rootPlan = __weiv_findTrackedRootPlan(bindingName);
  if (!rootPlan) {
    return value;
  }
  const cachedEntry = __weiv_trackedRootCache.get(rootPlan.rootId);
  if (cachedEntry && Object.is(cachedEntry.value, value)) {
    return cachedEntry.proxy;
  }
  const trackedValue = __weiv_wrapTrackedValue(rootPlan.rootId, bindingName, value);
  __weiv_trackedRootCache.set(rootPlan.rootId, { value, proxy: trackedValue });
  return trackedValue;
}

function collectTrackedDirtyPaths() {
  if (__weiv_pendingTrackedPathIds.size === 0) {
    return [];
  }
  const dirtyPaths = Array.from(__weiv_pendingTrackedPathIds);
  __weiv_pendingTrackedPathIds.clear();
  return dirtyPaths;
}

function __weiv_hasTrackedRoots() {
  return (
    trackedStateGraph &&
    Array.isArray(trackedStateGraph.roots) &&
    trackedStateGraph.roots.length > 0
  );
}

function __weiv_registerTrackedSubscriber(instance) {
  if (__weiv_hasTrackedRoots()) {
    __weiv_trackedSubscribers.add(instance);
  }
}

function __weiv_unregisterTrackedSubscriber(instance) {
  __weiv_trackedSubscribers.delete(instance);
}

function flushOwnedBoundary(instance, beforeScope) {
  if (instance.destroyed) {
    return beforeScope;
  }
  const afterScope = instance.refresh();
  const dirtyBindings = collectDirtyBindings(beforeScope, afterScope);
  const dirtyPaths = collectTrackedDirtyPaths();
  if (dirtyBindings.length > 0 || dirtyPaths.length > 0) {
    if (typeof instance.updateDirty === 'function') {
      instance.updateDirty({ bindings: dirtyBindings, paths: dirtyPaths }, afterScope);
    } else {
      instance.update();
    }
    return cloneScope(instance.refresh());
  }
  return cloneScope(afterScope);
}

function runOwnedBoundary(instance, callback) {
  let beforeScope = cloneScope(instance.refresh());
  let result;
  try {
    result = callback();
  } catch (error) {
    flushOwnedBoundary(instance, beforeScope);
    throw error;
  }
  beforeScope = flushOwnedBoundary(instance, beforeScope);
  if (result && typeof result.then === 'function') {
    return result.finally(() => {
      flushOwnedBoundary(instance, beforeScope);
    });
  }
  return result;
}
function createForEntry_17(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['traveler']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['traveler']: currentItem };
    updateRegion_text_20(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_21 = document.createElement('i');
  entryRefs[21] = __ref_21;
  __ref_21.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_20 = document.createTextNode('');
  entryRefs[20] = __ref_20;
  __ref_21.append(__ref_20);
  fragment.append(__ref_21);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_17(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.travelers ?? [];
  const previous = refs[19] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[18]);
    } else {
      record = createForEntry_17(instance, scope, item, refs[18]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[19] = nextRecords;
}

function createConditionalFragment_33(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_37 = document.createElement('div');
    refs[37] = __ref_37;
    __ref_37.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_37.setAttribute('class', 'error');
    __ref_37.setAttribute('role', 'alert');
    const __ref_36 = document.createTextNode('');
    refs[36] = __ref_36;
    __ref_37.append(__ref_36);
    fragment.append(__ref_37);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_33(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_33(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.errorMessage);
  if (refs[35] !== next) {
    const previous = refs[35];
    destroyConditionalBranch_33(instance, previous === true);
    refs[35] = next;
    replaceBetween(refs[33], refs[34], createConditionalFragment_33(instance, scope, next));
  }
  if (next) {
    updateRegion_text_36(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_38(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_43 = document.createElement('section');
    refs[43] = __ref_43;
    __ref_43.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_43.setAttribute('class', 'loading');
    const __ref_41 = document.createElement('i');
    refs[41] = __ref_41;
    __ref_41.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_43.append(__ref_41);
    const __ref_42 = document.createElement('p');
    refs[42] = __ref_42;
    __ref_42.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_42.append(document.createTextNode('Waking the place scouts…'));
    __ref_43.append(__ref_42);
    fragment.append(__ref_43);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_38(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_38(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.data);
  if (refs[40] !== next) {
    const previous = refs[40];
    destroyConditionalBranch_38(instance, previous === true);
    refs[40] = next;
    replaceBetween(refs[38], refs[39], createConditionalFragment_38(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_44(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_227 = document.createElement('div');
    refs[227] = __ref_227;
    __ref_227.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_227.setAttribute('class', 'atlas-view');
    const __ref_59 = document.createElement('section');
    refs[59] = __ref_59;
    __ref_59.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_59.setAttribute('class', 'intro');
    const __ref_51 = document.createElement('div');
    refs[51] = __ref_51;
    __ref_51.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_48 = document.createElement('div');
    refs[48] = __ref_48;
    __ref_48.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_48.setAttribute('class', 'kicker');
    __ref_48.append(document.createTextNode('ROAM’S ONE SMALL GAME · '));
    const __ref_47 = document.createTextNode('');
    refs[47] = __ref_47;
    __ref_48.append(__ref_47);
    __ref_48.append(document.createTextNode(' → Japan'));
    __ref_51.append(__ref_48);
    const __ref_49 = document.createElement('h1');
    refs[49] = __ref_49;
    __ref_49.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_49.append(document.createTextNode('Make one day everyone wants to live.'));
    __ref_51.append(__ref_49);
    const __ref_50 = document.createElement('p');
    refs[50] = __ref_50;
    __ref_50.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_50.append(
      document.createTextNode('Drop one concrete desire. Watch the scouts grow a day around it.'),
    );
    __ref_51.append(__ref_50);
    __ref_59.append(__ref_51);
    const __ref_58 = document.createElement('div');
    refs[58] = __ref_58;
    __ref_58.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_58.setAttribute('class', 'date-orbit');
    const __ref_52 = document.createElement('small');
    refs[52] = __ref_52;
    __ref_52.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_52.append(document.createTextNode('the window'));
    __ref_58.append(__ref_52);
    const __ref_55 = document.createElement('b');
    refs[55] = __ref_55;
    __ref_55.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_53 = document.createTextNode('');
    refs[53] = __ref_53;
    __ref_55.append(__ref_53);
    __ref_55.append(document.createTextNode('—'));
    const __ref_54 = document.createTextNode('');
    refs[54] = __ref_54;
    __ref_55.append(__ref_54);
    __ref_58.append(__ref_55);
    const __ref_57 = document.createElement('span');
    refs[57] = __ref_57;
    __ref_57.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_56 = document.createTextNode('');
    refs[56] = __ref_56;
    __ref_57.append(__ref_56);
    __ref_58.append(__ref_57);
    __ref_59.append(__ref_58);
    __ref_227.append(__ref_59);
    const __ref_72 = document.createElement('section');
    refs[72] = __ref_72;
    __ref_72.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_72.setAttribute('class', 'drop-zone');
    const __ref_62 = document.createElement('div');
    refs[62] = __ref_62;
    __ref_62.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_62.setAttribute('class', 'play-step');
    const __ref_60 = document.createElement('b');
    refs[60] = __ref_60;
    __ref_60.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_60.append(document.createTextNode('1'));
    __ref_62.append(__ref_60);
    const __ref_61 = document.createElement('span');
    refs[61] = __ref_61;
    __ref_61.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_61.append(document.createTextNode('Drop a desire'));
    __ref_62.append(__ref_61);
    __ref_72.append(__ref_62);
    const __ref_65 = document.createElement('div');
    refs[65] = __ref_65;
    __ref_65.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_65.setAttribute('class', 'desire-input');
    const __ref_63 = document.createElement('input');
    refs[63] = __ref_63;
    __ref_63.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_63.setAttribute('placeholder', 'I want a quiet breakfast…');
    __ref_63.setAttribute('maxlength', '120');
    __ref_63.addEventListener('input', (event) => {
      const resolved = scope.updateQuickDesire;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_63.addEventListener('keydown', (event) => {
      const resolved = scope.quickKey;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_65.append(__ref_63);
    const __ref_64 = document.createElement('button');
    refs[64] = __ref_64;
    __ref_64.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_64.addEventListener('click', (event) => {
      const resolved = scope.dropDesire;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_64.append(document.createTextNode('drop it on the world ↘'));
    __ref_65.append(__ref_64);
    __ref_72.append(__ref_65);
    const __ref_71 = document.createElement('div');
    refs[71] = __ref_71;
    __ref_71.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_71.setAttribute('class', 'live-examples');
    const __ref_66 = document.createElement('small');
    refs[66] = __ref_66;
    __ref_66.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_66.append(document.createTextNode('or play the live example'));
    __ref_71.append(__ref_66);
    const __ref_67 = document.createElement('button');
    refs[67] = __ref_67;
    __ref_67.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_67.addEventListener('click', (event) => {
      const resolved = scope.exampleBreakfast;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_67.append(document.createTextNode('quiet breakfast'));
    __ref_71.append(__ref_67);
    const __ref_68 = document.createElement('button');
    refs[68] = __ref_68;
    __ref_68.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_68.addEventListener('click', (event) => {
      const resolved = scope.exampleSwim;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_68.append(document.createTextNode('ocean swim'));
    __ref_71.append(__ref_68);
    const __ref_69 = document.createElement('button');
    refs[69] = __ref_69;
    __ref_69.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_69.addEventListener('click', (event) => {
      const resolved = scope.exampleMusic;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_69.append(document.createTextNode('late-night music'));
    __ref_71.append(__ref_69);
    const __ref_70 = document.createElement('button');
    refs[70] = __ref_70;
    __ref_70.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_70.addEventListener('click', (event) => {
      const resolved = scope.exampleArchitecture;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_70.append(document.createTextNode('hidden architecture'));
    __ref_71.append(__ref_70);
    __ref_72.append(__ref_71);
    __ref_227.append(__ref_72);
    const __ref_89 = document.createElement('section');
    refs[89] = __ref_89;
    __ref_89.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_89.setAttribute('class', 'grown-fragment');
    const __ref_77 = document.createElement('div');
    refs[77] = __ref_77;
    __ref_77.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_73 = document.createElement('span');
    refs[73] = __ref_73;
    __ref_73.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_73.append(document.createTextNode('VISIBLE CONSEQUENCE'));
    __ref_77.append(__ref_73);
    const __ref_75 = document.createElement('h2');
    refs[75] = __ref_75;
    __ref_75.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_75.append(document.createTextNode('Scouts grew three route fragments around “'));
    const __ref_74 = document.createTextNode('');
    refs[74] = __ref_74;
    __ref_75.append(__ref_74);
    __ref_75.append(document.createTextNode('”'));
    __ref_77.append(__ref_75);
    const __ref_76 = document.createElement('p');
    refs[76] = __ref_76;
    __ref_76.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_76.append(
      document.createTextNode(
        'Place and weather are real observations; the fragments remain playful possibilities.',
      ),
    );
    __ref_77.append(__ref_76);
    __ref_89.append(__ref_77);
    const __ref_88 = document.createElement('div');
    refs[88] = __ref_88;
    __ref_88.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_88.setAttribute('class', 'fragment-list');
    const __ref_78 = document.createComment('for:start');
    const __ref_79 = document.createComment('for:end');
    refs[78] = __ref_78;
    refs[79] = __ref_79;
    refs[80] = [];
    __ref_88.append(__ref_78);
    __ref_88.append(__ref_79);
    __ref_89.append(__ref_88);
    __ref_227.append(__ref_89);
    const __ref_120 = document.createElement('section');
    refs[120] = __ref_120;
    __ref_120.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_120.setAttribute('class', 'map-card');
    const __ref_92 = document.createElement('div');
    refs[92] = __ref_92;
    __ref_92.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_92.setAttribute('class', 'map-copy');
    const __ref_90 = document.createElement('span');
    refs[90] = __ref_90;
    __ref_90.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_90.append(document.createTextNode('2 · PULL A POSSIBILITY CLOSER'));
    __ref_92.append(__ref_90);
    const __ref_91 = document.createElement('p');
    refs[91] = __ref_91;
    __ref_91.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_91.append(document.createTextNode('Tap a world, then shape the group’s gravity.'));
    __ref_92.append(__ref_91);
    __ref_120.append(__ref_92);
    const __ref_119 = document.createElement('div');
    refs[119] = __ref_119;
    __ref_119.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_119.setAttribute('class', 'map-stage');
    const __ref_93 = document.createElement('div');
    refs[93] = __ref_93;
    __ref_93.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_93.setAttribute('class', 'contour c1');
    __ref_119.append(__ref_93);
    const __ref_94 = document.createElement('div');
    refs[94] = __ref_94;
    __ref_94.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_94.setAttribute('class', 'contour c2');
    __ref_119.append(__ref_94);
    const __ref_95 = document.createElement('div');
    refs[95] = __ref_95;
    __ref_95.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_95.setAttribute('class', 'contour c3');
    __ref_119.append(__ref_95);
    const __ref_97 = document.createElement('div');
    refs[97] = __ref_97;
    __ref_97.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_97.setAttribute('class', 'island tokyo');
    __ref_97.append(document.createTextNode('東京'));
    const __ref_96 = document.createElement('small');
    refs[96] = __ref_96;
    __ref_96.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_96.append(document.createTextNode('Tokyo'));
    __ref_97.append(__ref_96);
    __ref_119.append(__ref_97);
    const __ref_99 = document.createElement('div');
    refs[99] = __ref_99;
    __ref_99.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_99.setAttribute('class', 'island hakone');
    __ref_99.append(document.createTextNode('箱根'));
    const __ref_98 = document.createElement('small');
    refs[98] = __ref_98;
    __ref_98.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_98.append(document.createTextNode('Hakone'));
    __ref_99.append(__ref_98);
    __ref_119.append(__ref_99);
    const __ref_100 = document.createElement('div');
    refs[100] = __ref_100;
    __ref_100.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_100.setAttribute('class', 'ribbon r1');
    __ref_119.append(__ref_100);
    const __ref_101 = document.createElement('div');
    refs[101] = __ref_101;
    __ref_101.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_101.setAttribute('class', 'ribbon r2');
    __ref_119.append(__ref_101);
    const __ref_102 = document.createElement('div');
    refs[102] = __ref_102;
    __ref_102.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_102.setAttribute('class', 'ribbon r3');
    __ref_119.append(__ref_102);
    const __ref_103 = document.createComment('for:start');
    const __ref_104 = document.createComment('for:end');
    refs[103] = __ref_103;
    refs[104] = __ref_104;
    refs[105] = [];
    __ref_119.append(__ref_103);
    __ref_119.append(__ref_104);
    const __ref_118 = document.createElement('div');
    refs[118] = __ref_118;
    __ref_118.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_118.setAttribute('class', 'map-legend');
    const __ref_113 = document.createElement('span');
    refs[113] = __ref_113;
    __ref_113.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_112 = document.createElement('i');
    refs[112] = __ref_112;
    __ref_112.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_113.append(__ref_112);
    __ref_113.append(document.createTextNode('shared signals'));
    __ref_118.append(__ref_113);
    const __ref_115 = document.createElement('span');
    refs[115] = __ref_115;
    __ref_115.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_114 = document.createElement('i');
    refs[114] = __ref_114;
    __ref_114.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_115.append(__ref_114);
    __ref_115.append(document.createTextNode('live conditions'));
    __ref_118.append(__ref_115);
    const __ref_117 = document.createElement('span');
    refs[117] = __ref_117;
    __ref_117.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_116 = document.createElement('i');
    refs[116] = __ref_116;
    __ref_116.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_117.append(__ref_116);
    __ref_117.append(document.createTextNode('scout connections'));
    __ref_118.append(__ref_117);
    __ref_119.append(__ref_118);
    __ref_120.append(__ref_119);
    __ref_227.append(__ref_120);
    const __ref_134 = document.createElement('section');
    refs[134] = __ref_134;
    __ref_134.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_134.setAttribute('class', 'signal-stream');
    const __ref_125 = document.createElement('div');
    refs[125] = __ref_125;
    __ref_125.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_125.setAttribute('class', 'section-title');
    const __ref_123 = document.createElement('div');
    refs[123] = __ref_123;
    __ref_123.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_121 = document.createElement('span');
    refs[121] = __ref_121;
    __ref_121.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_121.append(document.createTextNode('WHAT THE GROUP IS PULLING TOWARD'));
    __ref_123.append(__ref_121);
    const __ref_122 = document.createElement('h2');
    refs[122] = __ref_122;
    __ref_122.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_122.append(document.createTextNode('Signals in the room'));
    __ref_123.append(__ref_122);
    __ref_125.append(__ref_123);
    const __ref_124 = document.createElement('button');
    refs[124] = __ref_124;
    __ref_124.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_124.addEventListener('click', (event) => {
      const resolved = scope.openSignal;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_124.append(document.createTextNode('＋ add a signal'));
    __ref_125.append(__ref_124);
    __ref_134.append(__ref_125);
    const __ref_133 = document.createElement('div');
    refs[133] = __ref_133;
    __ref_133.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_133.setAttribute('class', 'chips');
    const __ref_126 = document.createComment('for:start');
    const __ref_127 = document.createComment('for:end');
    refs[126] = __ref_126;
    refs[127] = __ref_127;
    refs[128] = [];
    __ref_133.append(__ref_126);
    __ref_133.append(__ref_127);
    __ref_134.append(__ref_133);
    __ref_227.append(__ref_134);
    const __ref_172 = document.createElement('section');
    refs[172] = __ref_172;
    __ref_172.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_172.setAttribute('class', 'world-section');
    const __ref_139 = document.createElement('div');
    refs[139] = __ref_139;
    __ref_139.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_139.setAttribute('class', 'section-title');
    const __ref_137 = document.createElement('div');
    refs[137] = __ref_137;
    __ref_137.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_135 = document.createElement('span');
    refs[135] = __ref_135;
    __ref_135.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_135.append(document.createTextNode('THREE EVOLVING JOURNEY WORLDS'));
    __ref_137.append(__ref_135);
    const __ref_136 = document.createElement('h2');
    refs[136] = __ref_136;
    __ref_136.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_136.append(document.createTextNode('Different ways the same week could feel'));
    __ref_137.append(__ref_136);
    __ref_139.append(__ref_137);
    const __ref_138 = document.createElement('p');
    refs[138] = __ref_138;
    __ref_138.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_138.append(
      document.createTextNode('None is a funnel. Keep one, blend them, or let them change.'),
    );
    __ref_139.append(__ref_138);
    __ref_172.append(__ref_139);
    const __ref_162 = document.createElement('div');
    refs[162] = __ref_162;
    __ref_162.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_162.setAttribute('class', 'world-grid');
    const __ref_140 = document.createComment('for:start');
    const __ref_141 = document.createComment('for:end');
    refs[140] = __ref_140;
    refs[141] = __ref_141;
    refs[142] = [];
    __ref_162.append(__ref_140);
    __ref_162.append(__ref_141);
    __ref_172.append(__ref_162);
    const __ref_171 = document.createElement('div');
    refs[171] = __ref_171;
    __ref_171.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_171.setAttribute('class', 'weave');
    const __ref_169 = document.createElement('div');
    refs[169] = __ref_169;
    __ref_169.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_163 = document.createElement('span');
    refs[163] = __ref_163;
    __ref_163.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_163.append(document.createTextNode('3 · WEAVE THE GROUP'));
    __ref_169.append(__ref_163);
    const __ref_165 = document.createElement('b');
    refs[165] = __ref_165;
    __ref_165.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_165.append(document.createTextNode('“'));
    const __ref_164 = document.createTextNode('');
    refs[164] = __ref_164;
    __ref_165.append(__ref_164);
    __ref_165.append(document.createTextNode('”'));
    __ref_169.append(__ref_165);
    const __ref_166 = document.createElement('i');
    refs[166] = __ref_166;
    __ref_166.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_166.append(document.createTextNode('＋'));
    __ref_169.append(__ref_166);
    const __ref_168 = document.createElement('b');
    refs[168] = __ref_168;
    __ref_168.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_168.append(document.createTextNode('“'));
    const __ref_167 = document.createTextNode('');
    refs[167] = __ref_167;
    __ref_168.append(__ref_167);
    __ref_168.append(document.createTextNode('”'));
    __ref_169.append(__ref_168);
    __ref_171.append(__ref_169);
    const __ref_170 = document.createElement('button');
    refs[170] = __ref_170;
    __ref_170.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_170.addEventListener('click', (event) => {
      const resolved = scope.weaveDesires;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_170.append(document.createTextNode('weave these desires →'));
    __ref_171.append(__ref_170);
    __ref_172.append(__ref_171);
    __ref_227.append(__ref_172);
    const __ref_226 = document.createElement('section');
    refs[226] = __ref_226;
    __ref_226.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_226.setAttribute('class', 'ribbon-workspace');
    const __ref_196 = document.createElement('div');
    refs[196] = __ref_196;
    __ref_196.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_196.setAttribute('class', 'journey-ribbon');
    const __ref_178 = document.createElement('div');
    refs[178] = __ref_178;
    __ref_178.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_178.setAttribute('class', 'section-title');
    const __ref_176 = document.createElement('div');
    refs[176] = __ref_176;
    __ref_176.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_173 = document.createElement('span');
    refs[173] = __ref_173;
    __ref_173.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_173.append(document.createTextNode('4 · WALK THROUGH THE RESULTING DAY'));
    __ref_176.append(__ref_173);
    const __ref_175 = document.createElement('h2');
    refs[175] = __ref_175;
    __ref_175.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_174 = document.createTextNode('');
    refs[174] = __ref_174;
    __ref_175.append(__ref_174);
    __ref_176.append(__ref_175);
    __ref_178.append(__ref_176);
    const __ref_177 = document.createElement('button');
    refs[177] = __ref_177;
    __ref_177.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_177.addEventListener('click', (event) => {
      const resolved = scope.saveTrail;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_177.append(document.createTextNode('save this trail ☆'));
    __ref_178.append(__ref_177);
    __ref_196.append(__ref_178);
    const __ref_195 = document.createElement('div');
    refs[195] = __ref_195;
    __ref_195.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_195.setAttribute('class', 'days');
    const __ref_179 = document.createComment('for:start');
    const __ref_180 = document.createComment('for:end');
    refs[179] = __ref_179;
    refs[180] = __ref_180;
    refs[181] = [];
    __ref_195.append(__ref_179);
    __ref_195.append(__ref_180);
    __ref_196.append(__ref_195);
    __ref_226.append(__ref_196);
    const __ref_225 = document.createElement('aside');
    refs[225] = __ref_225;
    __ref_225.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_209 = document.createElement('section');
    refs[209] = __ref_209;
    __ref_209.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_209.setAttribute('class', 'simulation');
    const __ref_197 = document.createElement('span');
    refs[197] = __ref_197;
    __ref_197.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_197.setAttribute('class', 'eyebrow');
    __ref_197.append(document.createTextNode('ALTERNATE-DAY SIMULATION'));
    __ref_209.append(__ref_197);
    const __ref_198 = document.createElement('h3');
    refs[198] = __ref_198;
    __ref_198.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_198.append(document.createTextNode('What if the day turns?'));
    __ref_209.append(__ref_198);
    const __ref_205 = document.createElement('div');
    refs[205] = __ref_205;
    __ref_205.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_205.setAttribute('class', 'weather-shape');
    const __ref_199 = document.createElement('i');
    refs[199] = __ref_199;
    __ref_199.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_205.append(__ref_199);
    const __ref_201 = document.createElement('b');
    refs[201] = __ref_201;
    __ref_201.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_200 = document.createTextNode('');
    refs[200] = __ref_200;
    __ref_201.append(__ref_200);
    __ref_205.append(__ref_201);
    const __ref_204 = document.createElement('small');
    refs[204] = __ref_204;
    __ref_204.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_204.append(document.createTextNode('day '));
    const __ref_202 = document.createTextNode('');
    refs[202] = __ref_202;
    __ref_204.append(__ref_202);
    __ref_204.append(document.createTextNode(' · '));
    const __ref_203 = document.createTextNode('');
    refs[203] = __ref_203;
    __ref_204.append(__ref_203);
    __ref_205.append(__ref_204);
    __ref_209.append(__ref_205);
    const __ref_207 = document.createElement('p');
    refs[207] = __ref_207;
    __ref_207.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_206 = document.createTextNode('');
    refs[206] = __ref_206;
    __ref_207.append(__ref_206);
    __ref_209.append(__ref_207);
    const __ref_208 = document.createElement('button');
    refs[208] = __ref_208;
    __ref_208.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_208.addEventListener('click', (event) => {
      const resolved = scope.nextSimulation;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_208.append(document.createTextNode('shuffle this day ↝'));
    __ref_209.append(__ref_208);
    __ref_225.append(__ref_209);
    const __ref_224 = document.createElement('section');
    refs[224] = __ref_224;
    __ref_224.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_224.setAttribute('class', 'scout-glimpse');
    const __ref_210 = document.createElement('span');
    refs[210] = __ref_210;
    __ref_210.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_210.setAttribute('class', 'eyebrow');
    __ref_210.append(document.createTextNode('SCOUT CHORUS'));
    __ref_224.append(__ref_210);
    const __ref_211 = document.createComment('for:start');
    const __ref_212 = document.createComment('for:end');
    refs[211] = __ref_211;
    refs[212] = __ref_212;
    refs[213] = [];
    __ref_224.append(__ref_211);
    __ref_224.append(__ref_212);
    const __ref_223 = document.createElement('button');
    refs[223] = __ref_223;
    __ref_223.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_223.addEventListener('click', (event) => {
      const resolved = scope.showScouts;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_223.append(document.createTextNode('hear what they noticed →'));
    __ref_224.append(__ref_223);
    __ref_225.append(__ref_224);
    __ref_226.append(__ref_225);
    __ref_227.append(__ref_226);
    fragment.append(__ref_227);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_44(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_80 = refs[80] ?? [];
    for (const record of __records_80) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_105 = refs[105] ?? [];
    for (const record of __records_105) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_128 = refs[128] ?? [];
    for (const record of __records_128) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_142 = refs[142] ?? [];
    for (const record of __records_142) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_181 = refs[181] ?? [];
    for (const record of __records_181) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_213 = refs[213] ?? [];
    for (const record of __records_213) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_44(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.data && scope.active === 'atlas');
  if (refs[46] !== next) {
    const previous = refs[46];
    destroyConditionalBranch_44(instance, previous === true);
    refs[46] = next;
    replaceBetween(refs[44], refs[45], createConditionalFragment_44(instance, scope, next));
  }
  if (next) {
    updateRegion_text_47(instance, scope, refs);
    updateRegion_text_53(instance, scope, refs);
    updateRegion_text_54(instance, scope, refs);
    updateRegion_text_56(instance, scope, refs);
    updateRegion_attribute_63_value(instance, scope, refs);
    updateRegion_attribute_64_disabled(instance, scope, refs);
    updateRegion_text_74(instance, scope, refs);
    updateRegion_loop_78(instance, scope, refs);
    updateRegion_loop_103(instance, scope, refs);
    updateRegion_loop_126(instance, scope, refs);
    updateRegion_loop_140(instance, scope, refs);
    updateRegion_text_164(instance, scope, refs);
    updateRegion_text_167(instance, scope, refs);
    updateRegion_attribute_170_disabled(instance, scope, refs);
    updateRegion_text_174(instance, scope, refs);
    updateRegion_attribute_177_disabled(instance, scope, refs);
    updateRegion_loop_179(instance, scope, refs);
    updateRegion_text_200(instance, scope, refs);
    updateRegion_text_202(instance, scope, refs);
    updateRegion_text_203(instance, scope, refs);
    updateRegion_text_206(instance, scope, refs);
    updateRegion_loop_211(instance, scope, refs);
  } else {
  }
}

function createForEntry_78(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['world']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['world']: currentItem };
    updateRegion_text_82(instance, loopScope, entryRefs);
    updateRegion_text_84(instance, loopScope, entryRefs);
    updateRegion_text_85(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_87 = document.createElement('button');
  entryRefs[87] = __ref_87;
  __ref_87.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_87.addEventListener('click', (event) => {
    const resolved = loopScope.focusWorld(loopScope.world.id);
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_81 = document.createElement('i');
  entryRefs[81] = __ref_81;
  __ref_81.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_87.append(__ref_81);
  const __ref_83 = document.createElement('b');
  entryRefs[83] = __ref_83;
  __ref_83.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_82 = document.createTextNode('');
  entryRefs[82] = __ref_82;
  __ref_83.append(__ref_82);
  __ref_87.append(__ref_83);
  const __ref_86 = document.createElement('small');
  entryRefs[86] = __ref_86;
  __ref_86.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_84 = document.createTextNode('');
  entryRefs[84] = __ref_84;
  __ref_86.append(__ref_84);
  __ref_86.append(document.createTextNode(' · '));
  const __ref_85 = document.createTextNode('');
  entryRefs[85] = __ref_85;
  __ref_86.append(__ref_85);
  __ref_87.append(__ref_86);
  fragment.append(__ref_87);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_78(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.worlds ?? [];
  const previous = refs[80] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[79]);
    } else {
      record = createForEntry_78(instance, scope, item, refs[79]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[80] = nextRecords;
}

function createForEntry_103(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['world']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['world']: currentItem };
    updateRegion_attribute_111_class(instance, loopScope, entryRefs);
    updateRegion_text_107(instance, loopScope, entryRefs);
    updateRegion_text_109(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_111 = document.createElement('button');
  entryRefs[111] = __ref_111;
  __ref_111.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_111.addEventListener('click', (event) => {
    const resolved = loopScope.focusWorld(loopScope.world.id);
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_106 = document.createElement('i');
  entryRefs[106] = __ref_106;
  __ref_106.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_111.append(__ref_106);
  const __ref_108 = document.createElement('b');
  entryRefs[108] = __ref_108;
  __ref_108.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_107 = document.createTextNode('');
  entryRefs[107] = __ref_107;
  __ref_108.append(__ref_107);
  __ref_111.append(__ref_108);
  const __ref_110 = document.createElement('small');
  entryRefs[110] = __ref_110;
  __ref_110.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_109 = document.createTextNode('');
  entryRefs[109] = __ref_109;
  __ref_110.append(__ref_109);
  __ref_111.append(__ref_110);
  fragment.append(__ref_111);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_103(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.worlds ?? [];
  const previous = refs[105] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[104]);
    } else {
      record = createForEntry_103(instance, scope, item, refs[104]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[105] = nextRecords;
}

function createForEntry_126(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['signal']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['signal']: currentItem };
    updateRegion_attribute_132_class(instance, loopScope, entryRefs);
    updateRegion_text_129(instance, loopScope, entryRefs);
    updateRegion_text_131(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_132 = document.createElement('button');
  entryRefs[132] = __ref_132;
  __ref_132.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_130 = document.createElement('small');
  entryRefs[130] = __ref_130;
  __ref_130.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_129 = document.createTextNode('');
  entryRefs[129] = __ref_129;
  __ref_130.append(__ref_129);
  __ref_132.append(__ref_130);
  const __ref_131 = document.createTextNode('');
  entryRefs[131] = __ref_131;
  __ref_132.append(__ref_131);
  fragment.append(__ref_132);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_126(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.signals ?? [];
  const previous = refs[128] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[127]);
    } else {
      record = createForEntry_126(instance, scope, item, refs[127]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[128] = nextRecords;
}

function createForEntry_140(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['world']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['world']: currentItem };
    updateRegion_attribute_161_class(instance, loopScope, entryRefs);
    updateRegion_text_143(instance, loopScope, entryRefs);
    updateRegion_text_145(instance, loopScope, entryRefs);
    updateRegion_attribute_149_class(instance, loopScope, entryRefs);
    updateRegion_text_150(instance, loopScope, entryRefs);
    updateRegion_text_152(instance, loopScope, entryRefs);
    updateRegion_text_154(instance, loopScope, entryRefs);
    updateRegion_attribute_156_disabled(instance, loopScope, entryRefs);
    updateRegion_attribute_157_disabled(instance, loopScope, entryRefs);
    updateRegion_text_158(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_161 = document.createElement('article');
  entryRefs[161] = __ref_161;
  __ref_161.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_147 = document.createElement('div');
  entryRefs[147] = __ref_147;
  __ref_147.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_147.setAttribute('class', 'world-top');
  const __ref_144 = document.createElement('span');
  entryRefs[144] = __ref_144;
  __ref_144.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_143 = document.createTextNode('');
  entryRefs[143] = __ref_143;
  __ref_144.append(__ref_143);
  __ref_147.append(__ref_144);
  const __ref_146 = document.createElement('b');
  entryRefs[146] = __ref_146;
  __ref_146.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_145 = document.createTextNode('');
  entryRefs[145] = __ref_145;
  __ref_146.append(__ref_145);
  __ref_146.append(document.createTextNode('% resonance'));
  __ref_147.append(__ref_146);
  __ref_161.append(__ref_147);
  const __ref_149 = document.createElement('div');
  entryRefs[149] = __ref_149;
  __ref_149.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_148 = document.createElement('i');
  entryRefs[148] = __ref_148;
  __ref_148.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_149.append(__ref_148);
  __ref_161.append(__ref_149);
  const __ref_151 = document.createElement('h3');
  entryRefs[151] = __ref_151;
  __ref_151.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_150 = document.createTextNode('');
  entryRefs[150] = __ref_150;
  __ref_151.append(__ref_150);
  __ref_161.append(__ref_151);
  const __ref_153 = document.createElement('p');
  entryRefs[153] = __ref_153;
  __ref_153.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_152 = document.createTextNode('');
  entryRefs[152] = __ref_152;
  __ref_153.append(__ref_152);
  __ref_161.append(__ref_153);
  const __ref_155 = document.createElement('div');
  entryRefs[155] = __ref_155;
  __ref_155.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_155.setAttribute('class', 'echoes');
  __ref_155.append(document.createTextNode('echoing · '));
  const __ref_154 = document.createTextNode('');
  entryRefs[154] = __ref_154;
  __ref_155.append(__ref_154);
  __ref_161.append(__ref_155);
  const __ref_160 = document.createElement('div');
  entryRefs[160] = __ref_160;
  __ref_160.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_160.setAttribute('class', 'gravity');
  const __ref_156 = document.createElement('button');
  entryRefs[156] = __ref_156;
  __ref_156.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_156.addEventListener('click', (event) => {
    const resolved = loopScope.pullWorld(loopScope.world.id);
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  __ref_156.append(document.createTextNode('↗ pull closer'));
  __ref_160.append(__ref_156);
  const __ref_157 = document.createElement('button');
  entryRefs[157] = __ref_157;
  __ref_157.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_157.addEventListener('click', (event) => {
    const resolved = loopScope.pushWorld(loopScope.world.id);
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  __ref_157.append(document.createTextNode('↘ push away'));
  __ref_160.append(__ref_157);
  const __ref_159 = document.createElement('b');
  entryRefs[159] = __ref_159;
  __ref_159.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_158 = document.createTextNode('');
  entryRefs[158] = __ref_158;
  __ref_159.append(__ref_158);
  __ref_160.append(__ref_159);
  __ref_161.append(__ref_160);
  fragment.append(__ref_161);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_140(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.worlds ?? [];
  const previous = refs[142] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[141]);
    } else {
      record = createForEntry_140(instance, scope, item, refs[141]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[142] = nextRecords;
}

function createForEntry_179(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['day']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['day']: currentItem };
    updateRegion_attribute_194_class(instance, loopScope, entryRefs);
    updateRegion_text_182(instance, loopScope, entryRefs);
    updateRegion_text_184(instance, loopScope, entryRefs);
    updateRegion_text_185(instance, loopScope, entryRefs);
    updateRegion_text_187(instance, loopScope, entryRefs);
    updateRegion_text_189(instance, loopScope, entryRefs);
    updateRegion_text_192(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_194 = document.createElement('button');
  entryRefs[194] = __ref_194;
  __ref_194.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_194.addEventListener('click', (event) => {
    const resolved = loopScope.simulateDay(loopScope.day.day);
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_183 = document.createElement('i');
  entryRefs[183] = __ref_183;
  __ref_183.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_182 = document.createTextNode('');
  entryRefs[182] = __ref_182;
  __ref_183.append(__ref_182);
  __ref_194.append(__ref_183);
  const __ref_191 = document.createElement('div');
  entryRefs[191] = __ref_191;
  __ref_191.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_186 = document.createElement('small');
  entryRefs[186] = __ref_186;
  __ref_186.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_184 = document.createTextNode('');
  entryRefs[184] = __ref_184;
  __ref_186.append(__ref_184);
  __ref_186.append(document.createTextNode(' · '));
  const __ref_185 = document.createTextNode('');
  entryRefs[185] = __ref_185;
  __ref_186.append(__ref_185);
  __ref_191.append(__ref_186);
  const __ref_188 = document.createElement('b');
  entryRefs[188] = __ref_188;
  __ref_188.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_187 = document.createTextNode('');
  entryRefs[187] = __ref_187;
  __ref_188.append(__ref_187);
  __ref_191.append(__ref_188);
  const __ref_190 = document.createElement('p');
  entryRefs[190] = __ref_190;
  __ref_190.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_189 = document.createTextNode('');
  entryRefs[189] = __ref_189;
  __ref_190.append(__ref_189);
  __ref_191.append(__ref_190);
  __ref_194.append(__ref_191);
  const __ref_193 = document.createElement('span');
  entryRefs[193] = __ref_193;
  __ref_193.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_192 = document.createTextNode('');
  entryRefs[192] = __ref_192;
  __ref_193.append(__ref_192);
  __ref_194.append(__ref_193);
  fragment.append(__ref_194);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_179(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.selected.days ?? [];
  const previous = refs[181] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[180]);
    } else {
      record = createForEntry_179(instance, scope, item, refs[180]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[181] = nextRecords;
}

function createForEntry_211(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['scout']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['scout']: currentItem };
    updateRegion_attribute_215_style(instance, loopScope, entryRefs);
    updateRegion_text_214(instance, loopScope, entryRefs);
    updateRegion_text_216(instance, loopScope, entryRefs);
    updateRegion_text_217(instance, loopScope, entryRefs);
    updateRegion_text_219(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_222 = document.createElement('article');
  entryRefs[222] = __ref_222;
  __ref_222.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_215 = document.createElement('i');
  entryRefs[215] = __ref_215;
  __ref_215.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_214 = document.createTextNode('');
  entryRefs[214] = __ref_214;
  __ref_215.append(__ref_214);
  __ref_222.append(__ref_215);
  const __ref_221 = document.createElement('div');
  entryRefs[221] = __ref_221;
  __ref_221.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_218 = document.createElement('b');
  entryRefs[218] = __ref_218;
  __ref_218.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_216 = document.createTextNode('');
  entryRefs[216] = __ref_216;
  __ref_218.append(__ref_216);
  __ref_218.append(document.createTextNode(' · '));
  const __ref_217 = document.createTextNode('');
  entryRefs[217] = __ref_217;
  __ref_218.append(__ref_217);
  __ref_221.append(__ref_218);
  const __ref_220 = document.createElement('p');
  entryRefs[220] = __ref_220;
  __ref_220.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_219 = document.createTextNode('');
  entryRefs[219] = __ref_219;
  __ref_220.append(__ref_219);
  __ref_221.append(__ref_220);
  __ref_222.append(__ref_221);
  fragment.append(__ref_222);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_211(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.scouts ?? [];
  const previous = refs[213] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[212]);
    } else {
      record = createForEntry_211(instance, scope, item, refs[212]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[213] = nextRecords;
}

function createConditionalFragment_228(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_247 = document.createElement('div');
    refs[247] = __ref_247;
    __ref_247.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_247.setAttribute('class', 'subview');
    const __ref_231 = document.createElement('div');
    refs[231] = __ref_231;
    __ref_231.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_231.setAttribute('class', 'kicker');
    __ref_231.append(document.createTextNode('COLLECTIVE TASTE, STILL EVOLVING'));
    __ref_247.append(__ref_231);
    const __ref_232 = document.createElement('h1');
    refs[232] = __ref_232;
    __ref_232.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_232.append(document.createTextNode('Signals, not requirements'));
    __ref_247.append(__ref_232);
    const __ref_233 = document.createElement('p');
    refs[233] = __ref_233;
    __ref_233.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_233.setAttribute('class', 'lede');
    __ref_233.append(
      document.createTextNode(
        'Moods, fascinations, rhythms and constraints can coexist without being flattened into a form score.',
      ),
    );
    __ref_247.append(__ref_233);
    const __ref_245 = document.createElement('div');
    refs[245] = __ref_245;
    __ref_245.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_245.setAttribute('class', 'signal-wall');
    const __ref_234 = document.createComment('for:start');
    const __ref_235 = document.createComment('for:end');
    refs[234] = __ref_234;
    refs[235] = __ref_235;
    refs[236] = [];
    __ref_245.append(__ref_234);
    __ref_245.append(__ref_235);
    __ref_247.append(__ref_245);
    const __ref_246 = document.createElement('button');
    refs[246] = __ref_246;
    __ref_246.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_246.setAttribute('class', 'primary');
    __ref_246.addEventListener('click', (event) => {
      const resolved = scope.openSignal;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_246.append(document.createTextNode('Add something the group should feel'));
    __ref_247.append(__ref_246);
    fragment.append(__ref_247);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_228(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_236 = refs[236] ?? [];
    for (const record of __records_236) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_228(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.data && scope.active === 'signals');
  if (refs[230] !== next) {
    const previous = refs[230];
    destroyConditionalBranch_228(instance, previous === true);
    refs[230] = next;
    replaceBetween(refs[228], refs[229], createConditionalFragment_228(instance, scope, next));
  }
  if (next) {
    updateRegion_loop_234(instance, scope, refs);
  } else {
  }
}

function createForEntry_234(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['signal']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['signal']: currentItem };
    updateRegion_attribute_244_class(instance, loopScope, entryRefs);
    updateRegion_text_237(instance, loopScope, entryRefs);
    updateRegion_text_238(instance, loopScope, entryRefs);
    updateRegion_text_240(instance, loopScope, entryRefs);
    updateRegion_text_242(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_244 = document.createElement('article');
  entryRefs[244] = __ref_244;
  __ref_244.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_239 = document.createElement('small');
  entryRefs[239] = __ref_239;
  __ref_239.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_237 = document.createTextNode('');
  entryRefs[237] = __ref_237;
  __ref_239.append(__ref_237);
  __ref_239.append(document.createTextNode(' · '));
  const __ref_238 = document.createTextNode('');
  entryRefs[238] = __ref_238;
  __ref_239.append(__ref_238);
  __ref_244.append(__ref_239);
  const __ref_241 = document.createElement('b');
  entryRefs[241] = __ref_241;
  __ref_241.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_240 = document.createTextNode('');
  entryRefs[240] = __ref_240;
  __ref_241.append(__ref_240);
  __ref_244.append(__ref_241);
  const __ref_243 = document.createElement('p');
  entryRefs[243] = __ref_243;
  __ref_243.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_243.append(document.createTextNode('Now echoing across '));
  const __ref_242 = document.createTextNode('');
  entryRefs[242] = __ref_242;
  __ref_243.append(__ref_242);
  __ref_243.append(document.createTextNode(' journey worlds.'));
  __ref_244.append(__ref_243);
  fragment.append(__ref_244);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_234(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.signals ?? [];
  const previous = refs[236] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[235]);
    } else {
      record = createForEntry_234(instance, scope, item, refs[235]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[236] = nextRecords;
}

function createConditionalFragment_248(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_283 = document.createElement('div');
    refs[283] = __ref_283;
    __ref_283.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_283.setAttribute('class', 'subview');
    const __ref_251 = document.createElement('div');
    refs[251] = __ref_251;
    __ref_251.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_251.setAttribute('class', 'kicker');
    __ref_251.append(document.createTextNode('PERSISTENT PERSPECTIVES'));
    __ref_283.append(__ref_251);
    const __ref_252 = document.createElement('h1');
    refs[252] = __ref_252;
    __ref_252.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_252.append(document.createTextNode('The scouts notice differently'));
    __ref_283.append(__ref_252);
    const __ref_253 = document.createElement('p');
    refs[253] = __ref_253;
    __ref_253.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_253.setAttribute('class', 'lede');
    __ref_253.append(
      document.createTextNode(
        'Each pulse remembers the group, reads the changing world, and leaves a trace instead of restarting from zero.',
      ),
    );
    __ref_283.append(__ref_253);
    const __ref_268 = document.createElement('div');
    refs[268] = __ref_268;
    __ref_268.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_268.setAttribute('class', 'scout-grid');
    const __ref_254 = document.createComment('for:start');
    const __ref_255 = document.createComment('for:end');
    refs[254] = __ref_254;
    refs[255] = __ref_255;
    refs[256] = [];
    __ref_268.append(__ref_254);
    __ref_268.append(__ref_255);
    __ref_283.append(__ref_268);
    const __ref_282 = document.createElement('section');
    refs[282] = __ref_282;
    __ref_282.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_282.setAttribute('class', 'sources');
    const __ref_269 = document.createElement('h2');
    refs[269] = __ref_269;
    __ref_269.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_269.append(document.createTextNode('What grounds them'));
    __ref_282.append(__ref_269);
    const __ref_270 = document.createComment('for:start');
    const __ref_271 = document.createComment('for:end');
    refs[270] = __ref_270;
    refs[271] = __ref_271;
    refs[272] = [];
    __ref_282.append(__ref_270);
    __ref_282.append(__ref_271);
    __ref_283.append(__ref_282);
    fragment.append(__ref_283);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_248(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_256 = refs[256] ?? [];
    for (const record of __records_256) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_272 = refs[272] ?? [];
    for (const record of __records_272) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_248(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.data && scope.active === 'scouts');
  if (refs[250] !== next) {
    const previous = refs[250];
    destroyConditionalBranch_248(instance, previous === true);
    refs[250] = next;
    replaceBetween(refs[248], refs[249], createConditionalFragment_248(instance, scope, next));
  }
  if (next) {
    updateRegion_loop_254(instance, scope, refs);
    updateRegion_loop_270(instance, scope, refs);
  } else {
  }
}

function createForEntry_254(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['scout']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['scout']: currentItem };
    updateRegion_attribute_258_style(instance, loopScope, entryRefs);
    updateRegion_text_257(instance, loopScope, entryRefs);
    updateRegion_text_259(instance, loopScope, entryRefs);
    updateRegion_text_261(instance, loopScope, entryRefs);
    updateRegion_text_263(instance, loopScope, entryRefs);
    updateRegion_text_265(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_267 = document.createElement('article');
  entryRefs[267] = __ref_267;
  __ref_267.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_258 = document.createElement('i');
  entryRefs[258] = __ref_258;
  __ref_258.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_257 = document.createTextNode('');
  entryRefs[257] = __ref_257;
  __ref_258.append(__ref_257);
  __ref_267.append(__ref_258);
  const __ref_260 = document.createElement('span');
  entryRefs[260] = __ref_260;
  __ref_260.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_259 = document.createTextNode('');
  entryRefs[259] = __ref_259;
  __ref_260.append(__ref_259);
  __ref_267.append(__ref_260);
  const __ref_262 = document.createElement('h2');
  entryRefs[262] = __ref_262;
  __ref_262.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_261 = document.createTextNode('');
  entryRefs[261] = __ref_261;
  __ref_262.append(__ref_261);
  __ref_267.append(__ref_262);
  const __ref_264 = document.createElement('p');
  entryRefs[264] = __ref_264;
  __ref_264.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_263 = document.createTextNode('');
  entryRefs[263] = __ref_263;
  __ref_264.append(__ref_263);
  __ref_267.append(__ref_264);
  const __ref_266 = document.createElement('small');
  entryRefs[266] = __ref_266;
  __ref_266.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_265 = document.createTextNode('');
  entryRefs[265] = __ref_265;
  __ref_266.append(__ref_265);
  __ref_267.append(__ref_266);
  fragment.append(__ref_267);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_254(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.scouts ?? [];
  const previous = refs[256] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[255]);
    } else {
      record = createForEntry_254(instance, scope, item, refs[255]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[256] = nextRecords;
}

function createForEntry_270(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['source']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['source']: currentItem };
    updateRegion_attribute_273_class(instance, loopScope, entryRefs);
    updateRegion_text_274(instance, loopScope, entryRefs);
    updateRegion_text_276(instance, loopScope, entryRefs);
    updateRegion_attribute_280_href(instance, loopScope, entryRefs);
    updateRegion_text_279(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_281 = document.createElement('article');
  entryRefs[281] = __ref_281;
  __ref_281.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_273 = document.createElement('i');
  entryRefs[273] = __ref_273;
  __ref_273.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_281.append(__ref_273);
  const __ref_278 = document.createElement('div');
  entryRefs[278] = __ref_278;
  __ref_278.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_275 = document.createElement('b');
  entryRefs[275] = __ref_275;
  __ref_275.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_274 = document.createTextNode('');
  entryRefs[274] = __ref_274;
  __ref_275.append(__ref_274);
  __ref_278.append(__ref_275);
  const __ref_277 = document.createElement('p');
  entryRefs[277] = __ref_277;
  __ref_277.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_276 = document.createTextNode('');
  entryRefs[276] = __ref_276;
  __ref_277.append(__ref_276);
  __ref_278.append(__ref_277);
  __ref_281.append(__ref_278);
  const __ref_280 = document.createElement('a');
  entryRefs[280] = __ref_280;
  __ref_280.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_280.setAttribute('rel', 'noreferrer');
  __ref_280.setAttribute('target', '_blank');
  const __ref_279 = document.createTextNode('');
  entryRefs[279] = __ref_279;
  __ref_280.append(__ref_279);
  __ref_281.append(__ref_280);
  fragment.append(__ref_281);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_270(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.sources ?? [];
  const previous = refs[272] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[271]);
    } else {
      record = createForEntry_270(instance, scope, item, refs[271]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[272] = nextRecords;
}

function createConditionalFragment_284(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_328 = document.createElement('div');
    refs[328] = __ref_328;
    __ref_328.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_328.setAttribute('class', 'subview memory-view');
    const __ref_287 = document.createElement('div');
    refs[287] = __ref_287;
    __ref_287.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_287.setAttribute('class', 'kicker');
    __ref_287.append(document.createTextNode('SAVED TRAILS'));
    __ref_328.append(__ref_287);
    const __ref_288 = document.createElement('h1');
    refs[288] = __ref_288;
    __ref_288.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_288.append(document.createTextNode('Return to a day worth living'));
    __ref_328.append(__ref_288);
    const __ref_289 = document.createElement('p');
    refs[289] = __ref_289;
    __ref_289.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_289.setAttribute('class', 'lede');
    __ref_289.append(
      document.createTextNode(
        'Saved trails keep the desire, route world and environmental context together so the group can return after conditions change.',
      ),
    );
    __ref_328.append(__ref_289);
    const __ref_302 = document.createElement('div');
    refs[302] = __ref_302;
    __ref_302.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_302.setAttribute('class', 'memory-stats');
    const __ref_293 = document.createElement('article');
    refs[293] = __ref_293;
    __ref_293.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_291 = document.createElement('b');
    refs[291] = __ref_291;
    __ref_291.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_290 = document.createTextNode('');
    refs[290] = __ref_290;
    __ref_291.append(__ref_290);
    __ref_293.append(__ref_291);
    const __ref_292 = document.createElement('span');
    refs[292] = __ref_292;
    __ref_292.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_292.append(document.createTextNode('trails saved'));
    __ref_293.append(__ref_292);
    __ref_302.append(__ref_293);
    const __ref_297 = document.createElement('article');
    refs[297] = __ref_297;
    __ref_297.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_295 = document.createElement('b');
    refs[295] = __ref_295;
    __ref_295.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_294 = document.createTextNode('');
    refs[294] = __ref_294;
    __ref_295.append(__ref_294);
    __ref_297.append(__ref_295);
    const __ref_296 = document.createElement('span');
    refs[296] = __ref_296;
    __ref_296.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_296.append(document.createTextNode('earlier pulses retained'));
    __ref_297.append(__ref_296);
    __ref_302.append(__ref_297);
    const __ref_301 = document.createElement('article');
    refs[301] = __ref_301;
    __ref_301.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_299 = document.createElement('b');
    refs[299] = __ref_299;
    __ref_299.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_298 = document.createTextNode('');
    refs[298] = __ref_298;
    __ref_299.append(__ref_298);
    __ref_301.append(__ref_299);
    const __ref_300 = document.createElement('span');
    refs[300] = __ref_300;
    __ref_300.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_300.append(document.createTextNode('desires remembered'));
    __ref_301.append(__ref_300);
    __ref_302.append(__ref_301);
    __ref_328.append(__ref_302);
    const __ref_315 = document.createElement('section');
    refs[315] = __ref_315;
    __ref_315.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_315.setAttribute('class', 'saved-list');
    const __ref_303 = document.createComment('for:start');
    const __ref_304 = document.createComment('for:end');
    refs[303] = __ref_303;
    refs[304] = __ref_304;
    refs[305] = [];
    __ref_315.append(__ref_303);
    __ref_315.append(__ref_304);
    __ref_328.append(__ref_315);
    const __ref_327 = document.createElement('section');
    refs[327] = __ref_327;
    __ref_327.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_327.setAttribute('class', 'story');
    const __ref_316 = document.createComment('for:start');
    const __ref_317 = document.createComment('for:end');
    refs[316] = __ref_316;
    refs[317] = __ref_317;
    refs[318] = [];
    __ref_327.append(__ref_316);
    __ref_327.append(__ref_317);
    __ref_328.append(__ref_327);
    fragment.append(__ref_328);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_284(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_305 = refs[305] ?? [];
    for (const record of __records_305) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_318 = refs[318] ?? [];
    for (const record of __records_318) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_284(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.data && scope.active === 'memory');
  if (refs[286] !== next) {
    const previous = refs[286];
    destroyConditionalBranch_284(instance, previous === true);
    refs[286] = next;
    replaceBetween(refs[284], refs[285], createConditionalFragment_284(instance, scope, next));
  }
  if (next) {
    updateRegion_text_290(instance, scope, refs);
    updateRegion_text_294(instance, scope, refs);
    updateRegion_text_298(instance, scope, refs);
    updateRegion_loop_303(instance, scope, refs);
    updateRegion_loop_316(instance, scope, refs);
  } else {
  }
}

function createForEntry_303(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['trail']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['trail']: currentItem };
    updateRegion_text_307(instance, loopScope, entryRefs);
    updateRegion_text_309(instance, loopScope, entryRefs);
    updateRegion_text_312(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_314 = document.createElement('article');
  entryRefs[314] = __ref_314;
  __ref_314.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_306 = document.createElement('span');
  entryRefs[306] = __ref_306;
  __ref_306.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_306.append(document.createTextNode('☆'));
  __ref_314.append(__ref_306);
  const __ref_311 = document.createElement('div');
  entryRefs[311] = __ref_311;
  __ref_311.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_308 = document.createElement('b');
  entryRefs[308] = __ref_308;
  __ref_308.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_307 = document.createTextNode('');
  entryRefs[307] = __ref_307;
  __ref_308.append(__ref_307);
  __ref_311.append(__ref_308);
  const __ref_310 = document.createElement('p');
  entryRefs[310] = __ref_310;
  __ref_310.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_310.append(document.createTextNode('grown around “'));
  const __ref_309 = document.createTextNode('');
  entryRefs[309] = __ref_309;
  __ref_310.append(__ref_309);
  __ref_310.append(document.createTextNode('”'));
  __ref_311.append(__ref_310);
  __ref_314.append(__ref_311);
  const __ref_313 = document.createElement('small');
  entryRefs[313] = __ref_313;
  __ref_313.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_312 = document.createTextNode('');
  entryRefs[312] = __ref_312;
  __ref_313.append(__ref_312);
  __ref_314.append(__ref_313);
  fragment.append(__ref_314);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_303(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.savedTrails ?? [];
  const previous = refs[305] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[304]);
    } else {
      record = createForEntry_303(instance, scope, item, refs[304]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[305] = nextRecords;
}

function createForEntry_316(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['entry']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['entry']: currentItem };
    updateRegion_text_319(instance, loopScope, entryRefs);
    updateRegion_text_321(instance, loopScope, entryRefs);
    updateRegion_text_323(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_326 = document.createElement('article');
  entryRefs[326] = __ref_326;
  __ref_326.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_320 = document.createElement('i');
  entryRefs[320] = __ref_320;
  __ref_320.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_319 = document.createTextNode('');
  entryRefs[319] = __ref_319;
  __ref_320.append(__ref_319);
  __ref_326.append(__ref_320);
  const __ref_325 = document.createElement('div');
  entryRefs[325] = __ref_325;
  __ref_325.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_322 = document.createElement('b');
  entryRefs[322] = __ref_322;
  __ref_322.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_321 = document.createTextNode('');
  entryRefs[321] = __ref_321;
  __ref_322.append(__ref_321);
  __ref_325.append(__ref_322);
  const __ref_324 = document.createElement('p');
  entryRefs[324] = __ref_324;
  __ref_324.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_323 = document.createTextNode('');
  entryRefs[323] = __ref_323;
  __ref_324.append(__ref_323);
  __ref_325.append(__ref_324);
  __ref_326.append(__ref_325);
  fragment.append(__ref_326);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_316(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.story ?? [];
  const previous = refs[318] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[317]);
    } else {
      record = createForEntry_316(instance, scope, item, refs[317]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === 'function') {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[318] = nextRecords;
}

function createConditionalFragment_330(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_347 = document.createElement('div');
    refs[347] = __ref_347;
    __ref_347.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_347.setAttribute('class', 'modal-layer');
    __ref_347.addEventListener('click', (event) => {
      const resolved = scope.closeSignalBackdrop;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_346 = document.createElement('section');
    refs[346] = __ref_346;
    __ref_346.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_346.setAttribute('class', 'modal');
    __ref_346.setAttribute('role', 'dialog');
    __ref_346.setAttribute('aria-modal', 'true');
    const __ref_333 = document.createElement('span');
    refs[333] = __ref_333;
    __ref_333.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_333.setAttribute('class', 'kicker');
    __ref_333.append(document.createTextNode('ADD TO THE FIELD'));
    __ref_346.append(__ref_333);
    const __ref_334 = document.createElement('h2');
    refs[334] = __ref_334;
    __ref_334.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_334.append(document.createTextNode('What should this journey feel like?'));
    __ref_346.append(__ref_334);
    const __ref_339 = document.createElement('div');
    refs[339] = __ref_339;
    __ref_339.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_339.setAttribute('class', 'kind-row');
    const __ref_335 = document.createElement('button');
    refs[335] = __ref_335;
    __ref_335.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_335.addEventListener('click', (event) => {
      const resolved = scope.kindMood;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_335.append(document.createTextNode('mood'));
    __ref_339.append(__ref_335);
    const __ref_336 = document.createElement('button');
    refs[336] = __ref_336;
    __ref_336.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_336.addEventListener('click', (event) => {
      const resolved = scope.kindFascination;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_336.append(document.createTextNode('fascination'));
    __ref_339.append(__ref_336);
    const __ref_337 = document.createElement('button');
    refs[337] = __ref_337;
    __ref_337.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_337.addEventListener('click', (event) => {
      const resolved = scope.kindRhythm;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_337.append(document.createTextNode('rhythm'));
    __ref_339.append(__ref_337);
    const __ref_338 = document.createElement('button');
    refs[338] = __ref_338;
    __ref_338.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_338.addEventListener('click', (event) => {
      const resolved = scope.kindConstraint;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_338.append(document.createTextNode('constraint'));
    __ref_339.append(__ref_338);
    __ref_346.append(__ref_339);
    const __ref_342 = document.createElement('label');
    refs[342] = __ref_342;
    __ref_342.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    const __ref_340 = document.createTextNode('');
    refs[340] = __ref_340;
    __ref_342.append(__ref_340);
    const __ref_341 = document.createElement('textarea');
    refs[341] = __ref_341;
    __ref_341.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_341.setAttribute('maxlength', '120');
    __ref_341.setAttribute('placeholder', 'late light, hand-painted signs, room to get lost…');
    __ref_341.addEventListener('input', (event) => {
      const resolved = scope.updateSignal;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_342.append(__ref_341);
    __ref_346.append(__ref_342);
    const __ref_345 = document.createElement('div');
    refs[345] = __ref_345;
    __ref_345.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_345.setAttribute('class', 'modal-actions');
    const __ref_343 = document.createElement('button');
    refs[343] = __ref_343;
    __ref_343.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_343.addEventListener('click', (event) => {
      const resolved = scope.closeSignal;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_343.append(document.createTextNode('not now'));
    __ref_345.append(__ref_343);
    const __ref_344 = document.createElement('button');
    refs[344] = __ref_344;
    __ref_344.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_344.setAttribute('class', 'primary');
    __ref_344.addEventListener('click', (event) => {
      const resolved = scope.saveSignal;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_344.append(document.createTextNode('let the scouts notice'));
    __ref_345.append(__ref_344);
    __ref_346.append(__ref_345);
    __ref_347.append(__ref_346);
    fragment.append(__ref_347);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_330(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_330(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.showSignal);
  if (refs[332] !== next) {
    const previous = refs[332];
    destroyConditionalBranch_330(instance, previous === true);
    refs[332] = next;
    replaceBetween(refs[330], refs[331], createConditionalFragment_330(instance, scope, next));
  }
  if (next) {
    updateRegion_text_340(instance, scope, refs);
    updateRegion_attribute_341_value(instance, scope, refs);
    updateRegion_attribute_344_disabled(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_348(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_366 = document.createElement('div');
    refs[366] = __ref_366;
    __ref_366.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_366.setAttribute('class', 'modal-layer');
    __ref_366.addEventListener('click', (event) => {
      const resolved = scope.closeNewBackdrop;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_365 = document.createElement('section');
    refs[365] = __ref_365;
    __ref_365.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_365.setAttribute('class', 'modal');
    __ref_365.setAttribute('role', 'dialog');
    __ref_365.setAttribute('aria-modal', 'true');
    const __ref_351 = document.createElement('span');
    refs[351] = __ref_351;
    __ref_351.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_351.setAttribute('class', 'kicker');
    __ref_351.append(document.createTextNode('OPEN A FRESH POSSIBILITY SPACE'));
    __ref_365.append(__ref_351);
    const __ref_352 = document.createElement('h2');
    refs[352] = __ref_352;
    __ref_352.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_352.append(document.createTextNode('Begin with a few sparks'));
    __ref_365.append(__ref_352);
    const __ref_361 = document.createElement('div');
    refs[361] = __ref_361;
    __ref_361.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_361.setAttribute('class', 'form-grid');
    const __ref_354 = document.createElement('label');
    refs[354] = __ref_354;
    __ref_354.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_354.append(document.createTextNode('Starting from'));
    const __ref_353 = document.createElement('input');
    refs[353] = __ref_353;
    __ref_353.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_353.addEventListener('input', (event) => {
      const resolved = scope.updateOrigin;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_354.append(__ref_353);
    __ref_361.append(__ref_354);
    const __ref_356 = document.createElement('label');
    refs[356] = __ref_356;
    __ref_356.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_356.append(document.createTextNode('First day'));
    const __ref_355 = document.createElement('input');
    refs[355] = __ref_355;
    __ref_355.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_355.setAttribute('type', 'date');
    __ref_355.addEventListener('input', (event) => {
      const resolved = scope.updateStart;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_356.append(__ref_355);
    __ref_361.append(__ref_356);
    const __ref_358 = document.createElement('label');
    refs[358] = __ref_358;
    __ref_358.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_358.append(document.createTextNode('Last day · seven days'));
    const __ref_357 = document.createElement('input');
    refs[357] = __ref_357;
    __ref_357.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_357.setAttribute('type', 'date');
    __ref_357.addEventListener('input', (event) => {
      const resolved = scope.updateEnd;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_358.append(__ref_357);
    __ref_361.append(__ref_358);
    const __ref_360 = document.createElement('label');
    refs[360] = __ref_360;
    __ref_360.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_360.setAttribute('class', 'wide');
    __ref_360.append(document.createTextNode('Signals, separated by commas'));
    const __ref_359 = document.createElement('textarea');
    refs[359] = __ref_359;
    __ref_359.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_359.setAttribute('placeholder', 'soft mornings, strange typography, mountain air');
    __ref_359.addEventListener('input', (event) => {
      const resolved = scope.updateSparks;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_360.append(__ref_359);
    __ref_361.append(__ref_360);
    __ref_365.append(__ref_361);
    const __ref_364 = document.createElement('div');
    refs[364] = __ref_364;
    __ref_364.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_364.setAttribute('class', 'modal-actions');
    const __ref_362 = document.createElement('button');
    refs[362] = __ref_362;
    __ref_362.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_362.addEventListener('click', (event) => {
      const resolved = scope.closeNew;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_362.append(document.createTextNode('keep this atlas'));
    __ref_364.append(__ref_362);
    const __ref_363 = document.createElement('button');
    refs[363] = __ref_363;
    __ref_363.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
    __ref_363.setAttribute('class', 'primary');
    __ref_363.addEventListener('click', (event) => {
      const resolved = scope.createAtlas;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_363.append(document.createTextNode('grow the atlas'));
    __ref_364.append(__ref_363);
    __ref_365.append(__ref_364);
    __ref_366.append(__ref_365);
    fragment.append(__ref_366);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_348(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_348(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.showNew);
  if (refs[350] !== next) {
    const previous = refs[350];
    destroyConditionalBranch_348(instance, previous === true);
    refs[350] = next;
    replaceBetween(refs[348], refs[349], createConditionalFragment_348(instance, scope, next));
  }
  if (next) {
    updateRegion_attribute_353_value(instance, scope, refs);
    updateRegion_attribute_355_value(instance, scope, refs);
    updateRegion_attribute_357_value(instance, scope, refs);
    updateRegion_attribute_359_value(instance, scope, refs);
    updateRegion_attribute_363_disabled(instance, scope, refs);
  } else {
  }
}

function setup(__weiv_props, __weiv_event_handlers = {}) {
  let props = __weiv_props;
  let __weiv_handlers = __weiv_event_handlers;
  let __weiv_runBoundary = (callback) => callback();
  const __weiv_wrapCallback = (callback) => {
    if (typeof callback !== 'function') {
      return callback;
    }
    return (...args) => __weiv_runBoundary(() => callback(...args));
  };
  const setTimeout = (callback, ...args) =>
    globalThis.setTimeout(__weiv_wrapCallback(callback), ...args);
  const setInterval = (callback, ...args) =>
    globalThis.setInterval(__weiv_wrapCallback(callback), ...args);
  const queueMicrotask = (callback) => globalThis.queueMicrotask(__weiv_wrapCallback(callback));
  const requestAnimationFrame = (callback) =>
    globalThis.requestAnimationFrame(__weiv_wrapCallback(callback));
  const emit = (name, payload) => {
    if (typeof __weiv_handlers[name] === 'function') {
      return __weiv_handlers[name](payload);
    }
    return undefined;
  };
  let data = null;
  let initialized = false;
  let busy = false;
  let errorMessage = '';
  let active = 'atlas';
  let worlds = [];
  let signals = [];
  let travelers = [];
  let scouts = [];
  let sources = [];
  let story = [];
  let savedTrails = [];
  let selected = {
    id: '',
    title: '',
    atmosphere: '',
    days: [],
  };
  let simulated = {
    day: 0,
    title: '',
    place: '',
    alternate: '',
  };
  let showSignal = false;
  let draftSignal = '';
  let draftKind = 'mood';
  let showNew = false;
  let draftOrigin = 'Auckland';
  let draftStart = '';
  let draftEnd = '';
  let draftSparks = '';
  let quickDesire = '';
  function boot() {
    if (!initialized && typeof window !== 'undefined') {
      initialized = true;
      queueMicrotask(load);
      window.setInterval(() => {
        if (!busy && !showSignal && !showNew) load();
      }, 4e3);
    }
    return '';
  }
  async function api(path, body) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'x-roam-token': props.token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Request failed');
    return value;
  }
  async function load() {
    try {
      const next = await api('/api/state');
      queueMicrotask(() => applyState(next));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the atlas';
      queueMicrotask(() => {
        errorMessage = message;
      });
    }
  }
  function applyState(next) {
    data = next;
    worlds = next.worlds || [];
    signals = next.brief.signals || [];
    travelers = next.brief.travelers || [];
    scouts = next.scouts || [];
    sources = [
      next.geography && next.geography.provenance,
      next.weather && next.weather.provenance,
    ].filter(Boolean);
    story = next.story || [];
    savedTrails = next.brief.savedTrails || [];
    selected =
      worlds.find((world) => world.id === next.brief.activeWorldId) || worlds[0] || selected;
    simulated = selected.days[0] || simulated;
    errorMessage = '';
  }
  function shortDate(value) {
    return new Intl.DateTimeFormat('en-NZ', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(value + 'T00:00:00Z'));
  }
  function padDay(value) {
    return String(value).padStart(2, '0');
  }
  function statusLine() {
    return data && data.work.status === 'completed'
      ? `atlas pulse ${data.memory.revisions} · awake`
      : 'scouts are reading the conditions';
  }
  function weatherWhisper() {
    if (!data || !data.weather || !data.weather.places.length) return 'seasonality still forming';
    const day = data.weather.places[0].days[0];
    return `${Math.round(day.temperatureMin)}–${Math.round(day.temperatureMax)}° · ${day.precipitationProbability}% rain`;
  }
  function pinClass(world) {
    return `world-pin ${world.id}${world.id === selected.id ? ' active' : ''}`;
  }
  function worldClass(world) {
    return `world-card ${world.id === selected.id ? 'selected' : ''}`;
  }
  function signalClass(signal) {
    return `signal ${signal.kind}`;
  }
  function dayClass(day) {
    return `day ${day.day === simulated.day ? 'active' : ''}`;
  }
  function echoLine(world) {
    return world.signalEchoes.join(' · ');
  }
  function reactionCount(id) {
    return Number(data.brief.reactions[id] || 0);
  }
  function gravityLabel(id) {
    const value = reactionCount(id);
    return value === 0 ? 'open' : value > 0 ? `+${value} group gravity` : `${value} group gravity`;
  }
  function latestDesire() {
    const desire = [...signals].reverse().find((signal) => signal.kind === 'desire');
    return desire ? desire.text : signals.at(-1)?.text || 'one vivid moment';
  }
  function partnerSignal() {
    return signals.find((signal) => signal.author === 'nora') || signals[0];
  }
  function partnerDesire() {
    return partnerSignal()?.text || 'one beautiful pause';
  }
  function savedDate(value) {
    return new Intl.DateTimeFormat('en-NZ', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(value));
  }
  function authorName(id) {
    const person = travelers.find((item) => item.id === id);
    return person ? person.name : 'the group';
  }
  function worldEchoCount(text) {
    return worlds.filter((world) => world.signalEchoes.includes(text)).length;
  }
  function scoutStyle(scout) {
    return `background:${scout.color}`;
  }
  function sourceClass(source) {
    return `source-dot ${source.state}`;
  }
  function storyIcon(entry) {
    if (entry.type === 'call') return '↗';
    if (entry.type === 'child') return '∥';
    return '◌';
  }
  function navClass(name) {
    return active === name ? 'active' : '';
  }
  function showAtlas() {
    active = 'atlas';
  }
  function showSignals() {
    active = 'signals';
  }
  function showScouts() {
    active = 'scouts';
  }
  function showMemory() {
    active = 'memory';
  }
  function simulateDay(day) {
    simulated = selected.days.find((item) => item.day === day) || selected.days[0];
  }
  function nextSimulation() {
    const index = selected.days.findIndex((item) => item.day === simulated.day);
    simulated = selected.days[(index + 1) % selected.days.length];
  }
  async function act(path, body) {
    if (busy) return;
    busy = true;
    errorMessage = '';
    try {
      await api(path, body || {});
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The atlas could not shift';
      queueMicrotask(() => {
        errorMessage = message;
      });
    } finally {
      queueMicrotask(() => {
        busy = false;
      });
    }
  }
  async function focusWorld(id) {
    selected = worlds.find((world) => world.id === id) || selected;
    simulated = selected.days[0] || simulated;
    await act('/api/focus', { worldId: id });
  }
  async function pullWorld(id) {
    await act('/api/nudge', {
      worldId: id,
      direction: 'closer',
    });
  }
  async function pushWorld(id) {
    await act('/api/nudge', {
      worldId: id,
      direction: 'away',
    });
  }
  async function weaveDesires() {
    const partner = partnerSignal();
    if (partner) await act('/api/weave', { signalId: partner.id });
  }
  async function saveTrail() {
    await act('/api/save', { worldId: selected.id });
    queueMicrotask(() => {
      active = 'memory';
    });
  }
  async function refreshAtlas() {
    await act('/api/refresh', {});
  }
  function updateQuickDesire(event) {
    quickDesire = event.currentTarget.value;
  }
  function quickKey(event) {
    if (event.key === 'Enter') dropDesire();
  }
  async function submitDesire(text) {
    if (!text.trim()) return;
    await act('/api/signal', {
      kind: 'desire',
      text,
      author: 'maya',
    });
    queueMicrotask(() => {
      quickDesire = '';
      active = 'atlas';
    });
  }
  async function dropDesire() {
    await submitDesire(quickDesire);
  }
  function exampleBreakfast() {
    submitDesire('quiet breakfast');
  }
  function exampleSwim() {
    submitDesire('ocean swim');
  }
  function exampleMusic() {
    submitDesire('late-night music');
  }
  function exampleArchitecture() {
    submitDesire('hidden architecture');
  }
  function openSignal() {
    draftSignal = '';
    draftKind = 'desire';
    showSignal = true;
  }
  function closeSignal() {
    if (!busy) showSignal = false;
  }
  function closeSignalBackdrop(event) {
    if (event.target === event.currentTarget) closeSignal();
  }
  function updateSignal(event) {
    draftSignal = event.currentTarget.value;
  }
  function kindMood() {
    draftKind = 'mood';
  }
  function kindFascination() {
    draftKind = 'fascination';
  }
  function kindRhythm() {
    draftKind = 'rhythm';
  }
  function kindConstraint() {
    draftKind = 'constraint';
  }
  async function saveSignal() {
    if (!draftSignal.trim()) return;
    await act('/api/signal', {
      kind: draftKind,
      text: draftSignal,
      author: 'maya',
    });
    queueMicrotask(() => {
      showSignal = false;
      active = 'atlas';
    });
  }
  function openNew() {
    if (data) {
      draftOrigin = data.brief.origin;
      draftStart = data.brief.startDate;
      draftEnd = data.brief.endDate;
      draftSparks = '';
    }
    showNew = true;
  }
  function closeNew() {
    if (!busy) showNew = false;
  }
  function closeNewBackdrop(event) {
    if (event.target === event.currentTarget) closeNew();
  }
  function value(event) {
    return event.currentTarget.value;
  }
  function updateOrigin(event) {
    draftOrigin = value(event);
  }
  function updateStart(event) {
    draftStart = value(event);
  }
  function updateEnd(event) {
    draftEnd = value(event);
  }
  function updateSparks(event) {
    draftSparks = value(event);
  }
  async function createAtlas() {
    await act('/api/create', {
      origin: draftOrigin,
      startDate: draftStart,
      endDate: draftEnd,
      signals: draftSparks
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    });
    queueMicrotask(() => {
      showNew = false;
      active = 'atlas';
    });
  }
  props = __weiv_getTrackedRoot('props', props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    __weiv_scope.data = data;
    __weiv_scope.initialized = initialized;
    __weiv_scope.busy = busy;
    __weiv_scope.errorMessage = errorMessage;
    __weiv_scope.active = active;
    __weiv_scope.worlds = worlds;
    __weiv_scope.signals = signals;
    __weiv_scope.travelers = travelers;
    __weiv_scope.scouts = scouts;
    __weiv_scope.sources = sources;
    __weiv_scope.story = story;
    __weiv_scope.savedTrails = savedTrails;
    __weiv_scope.selected = selected;
    __weiv_scope.simulated = simulated;
    __weiv_scope.showSignal = showSignal;
    __weiv_scope.draftSignal = draftSignal;
    __weiv_scope.draftKind = draftKind;
    __weiv_scope.showNew = showNew;
    __weiv_scope.draftOrigin = draftOrigin;
    __weiv_scope.draftStart = draftStart;
    __weiv_scope.draftEnd = draftEnd;
    __weiv_scope.draftSparks = draftSparks;
    __weiv_scope.quickDesire = quickDesire;
    __weiv_scope.boot = boot;
    __weiv_scope.api = api;
    __weiv_scope.load = load;
    __weiv_scope.applyState = applyState;
    __weiv_scope.shortDate = shortDate;
    __weiv_scope.padDay = padDay;
    __weiv_scope.statusLine = statusLine;
    __weiv_scope.weatherWhisper = weatherWhisper;
    __weiv_scope.pinClass = pinClass;
    __weiv_scope.worldClass = worldClass;
    __weiv_scope.signalClass = signalClass;
    __weiv_scope.dayClass = dayClass;
    __weiv_scope.echoLine = echoLine;
    __weiv_scope.reactionCount = reactionCount;
    __weiv_scope.gravityLabel = gravityLabel;
    __weiv_scope.latestDesire = latestDesire;
    __weiv_scope.partnerSignal = partnerSignal;
    __weiv_scope.partnerDesire = partnerDesire;
    __weiv_scope.savedDate = savedDate;
    __weiv_scope.authorName = authorName;
    __weiv_scope.worldEchoCount = worldEchoCount;
    __weiv_scope.scoutStyle = scoutStyle;
    __weiv_scope.sourceClass = sourceClass;
    __weiv_scope.storyIcon = storyIcon;
    __weiv_scope.navClass = navClass;
    __weiv_scope.showAtlas = showAtlas;
    __weiv_scope.showSignals = showSignals;
    __weiv_scope.showScouts = showScouts;
    __weiv_scope.showMemory = showMemory;
    __weiv_scope.simulateDay = simulateDay;
    __weiv_scope.nextSimulation = nextSimulation;
    __weiv_scope.act = act;
    __weiv_scope.focusWorld = focusWorld;
    __weiv_scope.pullWorld = pullWorld;
    __weiv_scope.pushWorld = pushWorld;
    __weiv_scope.weaveDesires = weaveDesires;
    __weiv_scope.saveTrail = saveTrail;
    __weiv_scope.refreshAtlas = refreshAtlas;
    __weiv_scope.updateQuickDesire = updateQuickDesire;
    __weiv_scope.quickKey = quickKey;
    __weiv_scope.submitDesire = submitDesire;
    __weiv_scope.dropDesire = dropDesire;
    __weiv_scope.exampleBreakfast = exampleBreakfast;
    __weiv_scope.exampleSwim = exampleSwim;
    __weiv_scope.exampleMusic = exampleMusic;
    __weiv_scope.exampleArchitecture = exampleArchitecture;
    __weiv_scope.openSignal = openSignal;
    __weiv_scope.closeSignal = closeSignal;
    __weiv_scope.closeSignalBackdrop = closeSignalBackdrop;
    __weiv_scope.updateSignal = updateSignal;
    __weiv_scope.kindMood = kindMood;
    __weiv_scope.kindFascination = kindFascination;
    __weiv_scope.kindRhythm = kindRhythm;
    __weiv_scope.kindConstraint = kindConstraint;
    __weiv_scope.saveSignal = saveSignal;
    __weiv_scope.openNew = openNew;
    __weiv_scope.closeNew = closeNew;
    __weiv_scope.closeNewBackdrop = closeNewBackdrop;
    __weiv_scope.value = value;
    __weiv_scope.updateOrigin = updateOrigin;
    __weiv_scope.updateStart = updateStart;
    __weiv_scope.updateEnd = updateEnd;
    __weiv_scope.updateSparks = updateSparks;
    __weiv_scope.createAtlas = createAtlas;
    return __weiv_scope;
  }
  function __weiv_setProps(nextProps) {
    props = __weiv_getTrackedRoot('props', nextProps);
  }
  function __weiv_setEventHandlers(nextHandlers) {
    __weiv_handlers = nextHandlers;
  }
  function __weiv_setBoundaryRunner(nextRunner) {
    __weiv_runBoundary = nextRunner;
  }
  function __weiv_subscribeImportedObservables(instance) {
    const __weiv_unsubscribes = [];
    const __weiv_seen = new Set();
    const __weiv_register = (value) => {
      const __weiv_node = __weiv_getObservableNode(value);
      if (
        !__weiv_node ||
        __weiv_seen.has(__weiv_node) ||
        !__weiv_node.listeners ||
        typeof __weiv_node.listeners.add !== 'function'
      ) {
        return;
      }
      __weiv_seen.add(__weiv_node);
      const __weiv_listener = () => {
        if (instance.destroyed) {
          return;
        }
        if (typeof instance.update === 'function') {
          instance.update();
        }
      };
      __weiv_node.listeners.add(__weiv_listener);
      __weiv_unsubscribes.push(() => __weiv_node.listeners.delete(__weiv_listener));
    };
    return () => {
      for (const __weiv_unsubscribe of __weiv_unsubscribes) {
        __weiv_unsubscribe();
      }
    };
  }
  return {
    scope: __weiv_scope,
    refresh: __weiv_refresh,
    setProps: __weiv_setProps,
    setEventHandlers: __weiv_setEventHandlers,
    setBoundaryRunner: __weiv_setBoundaryRunner,
    subscribeImportedObservables: __weiv_subscribeImportedObservables,
  };
}

export const scopeId = 'wF814F3C15C0B2B65';
export const css =
  '\n  [data-weiv-scope="wF814F3C15C0B2B65"].app-shell, [data-weiv-scope="wF814F3C15C0B2B65"] .app-shell { --night:#0f1720; --ink:#172027; --paper:#f3efe7; --mist:#dfe5df; --coral:#ff725e; --blue:#6b8cff; --green:#75a77d; min-height:100vh; color:var(--ink); background:var(--paper); font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif; }\n  [data-weiv-scope="wF814F3C15C0B2B65"].app-shell, [data-weiv-scope="wF814F3C15C0B2B65"] .app-shell, [data-weiv-scope="wF814F3C15C0B2B65"].app-shell *, [data-weiv-scope="wF814F3C15C0B2B65"] .app-shell * {box-sizing:border-box} [data-weiv-scope="wF814F3C15C0B2B65"]button, [data-weiv-scope="wF814F3C15C0B2B65"] button, [data-weiv-scope="wF814F3C15C0B2B65"]input, [data-weiv-scope="wF814F3C15C0B2B65"] input, [data-weiv-scope="wF814F3C15C0B2B65"]textarea, [data-weiv-scope="wF814F3C15C0B2B65"] textarea {font:inherit} [data-weiv-scope="wF814F3C15C0B2B65"]button, [data-weiv-scope="wF814F3C15C0B2B65"] button {cursor:pointer}[data-weiv-scope="wF814F3C15C0B2B65"].bootstrap, [data-weiv-scope="wF814F3C15C0B2B65"] .bootstrap {display:none}\n  [data-weiv-scope="wF814F3C15C0B2B65"].rail, [data-weiv-scope="wF814F3C15C0B2B65"] .rail {position:fixed;inset:0 auto 0 0;width:220px;padding:28px 20px;display:flex;flex-direction:column;color:#edf2ef;background:var(--night);z-index:5}[data-weiv-scope="wF814F3C15C0B2B65"].brand, [data-weiv-scope="wF814F3C15C0B2B65"] .brand {display:flex;gap:12px;align-items:center;margin-bottom:38px}[data-weiv-scope="wF814F3C15C0B2B65"].brand>i, [data-weiv-scope="wF814F3C15C0B2B65"] .brand>i {display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--coral);font:italic 28px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].brand b, [data-weiv-scope="wF814F3C15C0B2B65"] .brand b {display:block;font:600 22px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].brand small, [data-weiv-scope="wF814F3C15C0B2B65"] .brand small {display:block;color:#91a09c;font-size:10px;letter-spacing:.08em}[data-weiv-scope="wF814F3C15C0B2B65"].rail nav, [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav {display:grid;gap:6px}[data-weiv-scope="wF814F3C15C0B2B65"].rail nav button, [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav button, [data-weiv-scope="wF814F3C15C0B2B65"].new-atlas, [data-weiv-scope="wF814F3C15C0B2B65"] .new-atlas {border:0;border-radius:10px;padding:11px 12px;color:#9eaaa7;background:transparent;text-align:left}[data-weiv-scope="wF814F3C15C0B2B65"].rail nav button span, [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav button span {display:inline-block;width:28px;color:#65736f}[data-weiv-scope="wF814F3C15C0B2B65"].rail nav button:hover, [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav button:hover, [data-weiv-scope="wF814F3C15C0B2B65"].rail nav button.active, [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav button.active {color:white;background:#ffffff12}[data-weiv-scope="wF814F3C15C0B2B65"].new-atlas, [data-weiv-scope="wF814F3C15C0B2B65"] .new-atlas {margin-top:22px;border:1px solid #ffffff1d;color:#d8dfdc}[data-weiv-scope="wF814F3C15C0B2B65"].rail-foot, [data-weiv-scope="wF814F3C15C0B2B65"] .rail-foot {margin-top:auto}[data-weiv-scope="wF814F3C15C0B2B65"].faces, [data-weiv-scope="wF814F3C15C0B2B65"] .faces {display:flex}[data-weiv-scope="wF814F3C15C0B2B65"].faces i, [data-weiv-scope="wF814F3C15C0B2B65"] .faces i {display:grid;place-items:center;width:30px;height:30px;margin-right:-5px;border:2px solid var(--night);border-radius:50%;background:#42514f;color:white;font-style:normal;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].faces i:nth-child(2), [data-weiv-scope="wF814F3C15C0B2B65"] .faces i:nth-child(2) {background:#5e6fa7}[data-weiv-scope="wF814F3C15C0B2B65"].faces i:nth-child(3), [data-weiv-scope="wF814F3C15C0B2B65"] .faces i:nth-child(3) {background:#8a784c}[data-weiv-scope="wF814F3C15C0B2B65"].rail-foot p, [data-weiv-scope="wF814F3C15C0B2B65"] .rail-foot p {margin:8px 0;color:#b2bfbb;font-size:11px}[data-weiv-scope="wF814F3C15C0B2B65"].rail-foot small, [data-weiv-scope="wF814F3C15C0B2B65"] .rail-foot small {color:#586864;font-size:9px}\n  [data-weiv-scope="wF814F3C15C0B2B65"]main, [data-weiv-scope="wF814F3C15C0B2B65"] main {min-height:100vh;margin-left:220px}[data-weiv-scope="wF814F3C15C0B2B65"]header, [data-weiv-scope="wF814F3C15C0B2B65"] header {height:58px;padding:0 40px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1c28281a;background:#f8f5efcc;backdrop-filter:blur(12px);font-size:11px;letter-spacing:.04em}[data-weiv-scope="wF814F3C15C0B2B65"]header button, [data-weiv-scope="wF814F3C15C0B2B65"] header button {border:0;background:transparent;color:#425850}[data-weiv-scope="wF814F3C15C0B2B65"].pulse-dot, [data-weiv-scope="wF814F3C15C0B2B65"] .pulse-dot {display:inline-block;width:7px;height:7px;margin-right:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px #75a77d1f}[data-weiv-scope="wF814F3C15C0B2B65"].error, [data-weiv-scope="wF814F3C15C0B2B65"] .error {margin:16px 40px;padding:10px 14px;border-radius:8px;background:#ff725e1c;color:#9e3024}[data-weiv-scope="wF814F3C15C0B2B65"].loading, [data-weiv-scope="wF814F3C15C0B2B65"] .loading {min-height:70vh;display:grid;place-items:center;align-content:center}[data-weiv-scope="wF814F3C15C0B2B65"].loading i, [data-weiv-scope="wF814F3C15C0B2B65"] .loading i {width:46px;height:46px;border:1px solid var(--green);border-radius:50%;animation:breathe 1.8s infinite}[data-weiv-scope="wF814F3C15C0B2B65"].loading p, [data-weiv-scope="wF814F3C15C0B2B65"] .loading p {color:#68736e}\n  [data-weiv-scope="wF814F3C15C0B2B65"].atlas-view, [data-weiv-scope="wF814F3C15C0B2B65"] .atlas-view, [data-weiv-scope="wF814F3C15C0B2B65"].subview, [data-weiv-scope="wF814F3C15C0B2B65"] .subview {max-width:1320px;margin:auto;padding:42px 48px 80px}[data-weiv-scope="wF814F3C15C0B2B65"].intro, [data-weiv-scope="wF814F3C15C0B2B65"] .intro {display:flex;justify-content:space-between;align-items:end;margin-bottom:28px}[data-weiv-scope="wF814F3C15C0B2B65"].kicker, [data-weiv-scope="wF814F3C15C0B2B65"] .kicker, [data-weiv-scope="wF814F3C15C0B2B65"].eyebrow, [data-weiv-scope="wF814F3C15C0B2B65"] .eyebrow, [data-weiv-scope="wF814F3C15C0B2B65"].section-title span, [data-weiv-scope="wF814F3C15C0B2B65"] .section-title span {color:#728078;font-size:9px;font-weight:750;letter-spacing:.17em}[data-weiv-scope="wF814F3C15C0B2B65"].intro h1, [data-weiv-scope="wF814F3C15C0B2B65"] .intro h1, [data-weiv-scope="wF814F3C15C0B2B65"].subview>h1, [data-weiv-scope="wF814F3C15C0B2B65"] .subview>h1 {margin:5px 0 4px;font:500 clamp(38px,5vw,68px)/.98 Georgia,serif;letter-spacing:-.035em}[data-weiv-scope="wF814F3C15C0B2B65"].intro p, [data-weiv-scope="wF814F3C15C0B2B65"] .intro p, [data-weiv-scope="wF814F3C15C0B2B65"].lede, [data-weiv-scope="wF814F3C15C0B2B65"] .lede {margin:0;color:#66716c;font:italic 16px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].date-orbit, [data-weiv-scope="wF814F3C15C0B2B65"] .date-orbit {width:210px;padding:18px;border-left:1px solid #cbcfc8}[data-weiv-scope="wF814F3C15C0B2B65"].date-orbit small, [data-weiv-scope="wF814F3C15C0B2B65"] .date-orbit small, [data-weiv-scope="wF814F3C15C0B2B65"].date-orbit span, [data-weiv-scope="wF814F3C15C0B2B65"] .date-orbit span {display:block;color:#7c8882;font-size:10px}[data-weiv-scope="wF814F3C15C0B2B65"].date-orbit b, [data-weiv-scope="wF814F3C15C0B2B65"] .date-orbit b {display:block;margin:4px 0;font:500 17px Georgia}\n  [data-weiv-scope="wF814F3C15C0B2B65"].drop-zone, [data-weiv-scope="wF814F3C15C0B2B65"] .drop-zone {margin-bottom:18px;padding:20px;border-radius:20px;background:var(--night);color:white;box-shadow:0 18px 60px #0f17202b}[data-weiv-scope="wF814F3C15C0B2B65"].play-step, [data-weiv-scope="wF814F3C15C0B2B65"] .play-step {display:flex;gap:9px;align-items:center;margin-bottom:10px}[data-weiv-scope="wF814F3C15C0B2B65"].play-step b, [data-weiv-scope="wF814F3C15C0B2B65"] .play-step b {display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--coral)}[data-weiv-scope="wF814F3C15C0B2B65"].play-step span, [data-weiv-scope="wF814F3C15C0B2B65"] .play-step span {font:600 16px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].desire-input, [data-weiv-scope="wF814F3C15C0B2B65"] .desire-input {display:grid;grid-template-columns:1fr auto;gap:8px}[data-weiv-scope="wF814F3C15C0B2B65"].desire-input input, [data-weiv-scope="wF814F3C15C0B2B65"] .desire-input input {min-width:0;padding:13px 15px;border:1px solid #ffffff29;border-radius:12px;background:#ffffff12;color:white}[data-weiv-scope="wF814F3C15C0B2B65"].desire-input input::placeholder, [data-weiv-scope="wF814F3C15C0B2B65"] .desire-input input::placeholder {color:#91a09d}[data-weiv-scope="wF814F3C15C0B2B65"].desire-input button, [data-weiv-scope="wF814F3C15C0B2B65"] .desire-input button {border:0;border-radius:12px;padding:0 18px;background:var(--coral);color:white}[data-weiv-scope="wF814F3C15C0B2B65"].live-examples, [data-weiv-scope="wF814F3C15C0B2B65"] .live-examples {display:flex;gap:6px;align-items:center;margin-top:10px;flex-wrap:wrap}[data-weiv-scope="wF814F3C15C0B2B65"].live-examples small, [data-weiv-scope="wF814F3C15C0B2B65"] .live-examples small {margin-right:4px;color:#8e9b98}[data-weiv-scope="wF814F3C15C0B2B65"].live-examples button, [data-weiv-scope="wF814F3C15C0B2B65"] .live-examples button {border:1px solid #ffffff20;border-radius:14px;padding:5px 9px;background:transparent;color:#d9dfdd;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].grown-fragment, [data-weiv-scope="wF814F3C15C0B2B65"] .grown-fragment {display:grid;grid-template-columns:1fr 1.2fr;gap:20px;align-items:center;margin-bottom:18px;padding:16px 18px;border:1px solid #d8d8d0;border-radius:18px;background:#faf8f3}[data-weiv-scope="wF814F3C15C0B2B65"].grown-fragment span, [data-weiv-scope="wF814F3C15C0B2B65"] .grown-fragment span {color:#718077;font-size:8px;letter-spacing:.15em}[data-weiv-scope="wF814F3C15C0B2B65"].grown-fragment h2, [data-weiv-scope="wF814F3C15C0B2B65"] .grown-fragment h2 {margin:4px 0;font:600 18px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].grown-fragment p, [data-weiv-scope="wF814F3C15C0B2B65"] .grown-fragment p {margin:0;color:#758079;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].fragment-list, [data-weiv-scope="wF814F3C15C0B2B65"] .fragment-list {display:grid;grid-template-columns:repeat(3,1fr);gap:6px}[data-weiv-scope="wF814F3C15C0B2B65"].fragment-list button, [data-weiv-scope="wF814F3C15C0B2B65"] .fragment-list button {padding:9px;border:0;border-radius:10px;background:white;text-align:left}[data-weiv-scope="wF814F3C15C0B2B65"].fragment-list i, [data-weiv-scope="wF814F3C15C0B2B65"] .fragment-list i {float:left;width:6px;height:6px;margin:5px 7px 20px 0;border-radius:50%;background:var(--coral)}[data-weiv-scope="wF814F3C15C0B2B65"].fragment-list b, [data-weiv-scope="wF814F3C15C0B2B65"] .fragment-list b, [data-weiv-scope="wF814F3C15C0B2B65"].fragment-list small, [data-weiv-scope="wF814F3C15C0B2B65"] .fragment-list small {display:block}[data-weiv-scope="wF814F3C15C0B2B65"].fragment-list b, [data-weiv-scope="wF814F3C15C0B2B65"] .fragment-list b {font:600 11px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].fragment-list small, [data-weiv-scope="wF814F3C15C0B2B65"] .fragment-list small {color:#77817c;font-size:7px}\n  [data-weiv-scope="wF814F3C15C0B2B65"].map-card, [data-weiv-scope="wF814F3C15C0B2B65"] .map-card {overflow:hidden;border-radius:24px;background:#dce4dd;box-shadow:0 20px 70px #1b31251c}[data-weiv-scope="wF814F3C15C0B2B65"].map-copy, [data-weiv-scope="wF814F3C15C0B2B65"] .map-copy {display:flex;justify-content:space-between;padding:16px 20px;color:#516058;font-size:10px}[data-weiv-scope="wF814F3C15C0B2B65"].map-copy p, [data-weiv-scope="wF814F3C15C0B2B65"] .map-copy p {margin:0}[data-weiv-scope="wF814F3C15C0B2B65"].map-stage, [data-weiv-scope="wF814F3C15C0B2B65"] .map-stage {position:relative;height:400px;overflow:hidden;background:radial-gradient(circle at 15% 30%,#f9d8c3 0,transparent 28%),radial-gradient(circle at 77% 22%,#ccd8f3 0,transparent 26%),radial-gradient(circle at 52% 79%,#c6dec7 0,transparent 31%),linear-gradient(135deg,#dce3dc,#edf0e9)}[data-weiv-scope="wF814F3C15C0B2B65"].contour, [data-weiv-scope="wF814F3C15C0B2B65"] .contour {position:absolute;border:1px solid #5d706018;border-radius:48% 52% 63% 37%}[data-weiv-scope="wF814F3C15C0B2B65"].c1, [data-weiv-scope="wF814F3C15C0B2B65"] .c1 {inset:34px 12%;transform:rotate(-7deg)}[data-weiv-scope="wF814F3C15C0B2B65"].c2, [data-weiv-scope="wF814F3C15C0B2B65"] .c2 {inset:78px 25%;transform:rotate(13deg)}[data-weiv-scope="wF814F3C15C0B2B65"].c3, [data-weiv-scope="wF814F3C15C0B2B65"] .c3 {width:330px;height:330px;left:36%;top:18px}[data-weiv-scope="wF814F3C15C0B2B65"].island, [data-weiv-scope="wF814F3C15C0B2B65"] .island {position:absolute;color:#44554d24;font:600 72px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].island small, [data-weiv-scope="wF814F3C15C0B2B65"] .island small {display:block;font:600 10px Inter;color:#52605866;letter-spacing:.15em}[data-weiv-scope="wF814F3C15C0B2B65"].tokyo, [data-weiv-scope="wF814F3C15C0B2B65"] .tokyo {right:10%;top:35%}[data-weiv-scope="wF814F3C15C0B2B65"].hakone, [data-weiv-scope="wF814F3C15C0B2B65"] .hakone {left:12%;bottom:9%;font-size:54px}[data-weiv-scope="wF814F3C15C0B2B65"].ribbon, [data-weiv-scope="wF814F3C15C0B2B65"] .ribbon {position:absolute;height:2px;transform-origin:left;background:linear-gradient(90deg,transparent,#ffffffad,transparent);filter:blur(.2px)}[data-weiv-scope="wF814F3C15C0B2B65"].r1, [data-weiv-scope="wF814F3C15C0B2B65"] .r1 {width:53%;left:20%;top:43%;transform:rotate(-10deg)}[data-weiv-scope="wF814F3C15C0B2B65"].r2, [data-weiv-scope="wF814F3C15C0B2B65"] .r2 {width:42%;left:32%;top:56%;transform:rotate(26deg)}[data-weiv-scope="wF814F3C15C0B2B65"].r3, [data-weiv-scope="wF814F3C15C0B2B65"] .r3 {width:35%;left:30%;top:66%;transform:rotate(-28deg)}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin {position:absolute;width:170px;padding:10px 12px;border:0;border-radius:14px;color:#34423d;background:#ffffffe5;text-align:left;box-shadow:0 12px 36px #1831221c;transition:.2s}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin:hover, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin:hover, [data-weiv-scope="wF814F3C15C0B2B65"].world-pin.active, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.active {transform:translateY(-5px) scale(1.03);box-shadow:0 18px 45px #18312233}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin>i, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin>i {float:left;width:11px;height:11px;margin:5px 9px 22px 0;border:3px solid white;border-radius:50%;background:var(--coral);box-shadow:0 0 0 2px var(--coral)}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin b, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin b, [data-weiv-scope="wF814F3C15C0B2B65"].world-pin small, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin small {display:block}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin b, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin b {font:600 16px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin small, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin small {overflow:hidden;color:#718078;font-size:9px;white-space:nowrap;text-overflow:ellipsis}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin.lantern-drift, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.lantern-drift {left:14%;top:24%}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin.electric-quiet, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.electric-quiet {right:15%;top:16%}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin.mountain-breath, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.mountain-breath {left:43%;bottom:12%}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin.electric-quiet>i, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.electric-quiet>i {background:var(--blue);box-shadow:0 0 0 2px var(--blue)}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin.mountain-breath>i, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.mountain-breath>i {background:var(--green);box-shadow:0 0 0 2px var(--green)}[data-weiv-scope="wF814F3C15C0B2B65"].map-legend, [data-weiv-scope="wF814F3C15C0B2B65"] .map-legend {position:absolute;right:18px;bottom:14px;display:flex;gap:15px;padding:7px 10px;border-radius:12px;background:#f7f8f5a8;font-size:8px;color:#68756e}[data-weiv-scope="wF814F3C15C0B2B65"].map-legend i, [data-weiv-scope="wF814F3C15C0B2B65"] .map-legend i {display:inline-block;width:5px;height:5px;margin-right:5px;border-radius:50%;background:var(--coral)}[data-weiv-scope="wF814F3C15C0B2B65"].map-legend span:nth-child(2) i, [data-weiv-scope="wF814F3C15C0B2B65"] .map-legend span:nth-child(2) i {background:var(--blue)}[data-weiv-scope="wF814F3C15C0B2B65"].map-legend span:nth-child(3) i, [data-weiv-scope="wF814F3C15C0B2B65"] .map-legend span:nth-child(3) i {background:var(--green)}\n  [data-weiv-scope="wF814F3C15C0B2B65"].signal-stream, [data-weiv-scope="wF814F3C15C0B2B65"] .signal-stream, [data-weiv-scope="wF814F3C15C0B2B65"].world-section, [data-weiv-scope="wF814F3C15C0B2B65"] .world-section, [data-weiv-scope="wF814F3C15C0B2B65"].ribbon-workspace, [data-weiv-scope="wF814F3C15C0B2B65"] .ribbon-workspace {margin-top:54px}[data-weiv-scope="wF814F3C15C0B2B65"].section-title, [data-weiv-scope="wF814F3C15C0B2B65"] .section-title {display:flex;align-items:end;justify-content:space-between;margin-bottom:18px}[data-weiv-scope="wF814F3C15C0B2B65"].section-title h2, [data-weiv-scope="wF814F3C15C0B2B65"] .section-title h2 {margin:3px 0 0;font:500 28px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].section-title p, [data-weiv-scope="wF814F3C15C0B2B65"] .section-title p {max-width:360px;margin:0;color:#6e7973;font-size:11px}[data-weiv-scope="wF814F3C15C0B2B65"].section-title button, [data-weiv-scope="wF814F3C15C0B2B65"] .section-title button, [data-weiv-scope="wF814F3C15C0B2B65"].signal-stream>button, [data-weiv-scope="wF814F3C15C0B2B65"] .signal-stream>button {border:1px solid #bdc6bf;border-radius:20px;padding:8px 13px;background:transparent;color:#42564d}[data-weiv-scope="wF814F3C15C0B2B65"].chips, [data-weiv-scope="wF814F3C15C0B2B65"] .chips {display:flex;gap:8px;overflow:auto;padding-bottom:5px}[data-weiv-scope="wF814F3C15C0B2B65"].signal, [data-weiv-scope="wF814F3C15C0B2B65"] .signal {border:0;border-radius:22px;padding:10px 14px;background:#fff;white-space:nowrap}[data-weiv-scope="wF814F3C15C0B2B65"].signal small, [data-weiv-scope="wF814F3C15C0B2B65"] .signal small {margin-right:8px;color:#9b6e62;font-size:8px;text-transform:uppercase}[data-weiv-scope="wF814F3C15C0B2B65"].signal.mood, [data-weiv-scope="wF814F3C15C0B2B65"] .signal.mood {background:#ffe4dc}[data-weiv-scope="wF814F3C15C0B2B65"].signal.fascination, [data-weiv-scope="wF814F3C15C0B2B65"] .signal.fascination {background:#e1e7fa}[data-weiv-scope="wF814F3C15C0B2B65"].signal.rhythm, [data-weiv-scope="wF814F3C15C0B2B65"] .signal.rhythm {background:#deeadf}[data-weiv-scope="wF814F3C15C0B2B65"].signal.constraint, [data-weiv-scope="wF814F3C15C0B2B65"] .signal.constraint {background:#ece5cf}\n  [data-weiv-scope="wF814F3C15C0B2B65"].world-grid, [data-weiv-scope="wF814F3C15C0B2B65"] .world-grid {display:grid;grid-template-columns:repeat(3,1fr);gap:14px}[data-weiv-scope="wF814F3C15C0B2B65"].world-card, [data-weiv-scope="wF814F3C15C0B2B65"] .world-card {padding:18px;border:1px solid #d7d7cf;border-radius:18px;background:#f9f7f2;transition:.2s}[data-weiv-scope="wF814F3C15C0B2B65"].world-card:hover, [data-weiv-scope="wF814F3C15C0B2B65"] .world-card:hover, [data-weiv-scope="wF814F3C15C0B2B65"].world-card.selected, [data-weiv-scope="wF814F3C15C0B2B65"] .world-card.selected {border-color:#6f8176;transform:translateY(-3px);box-shadow:0 16px 40px #23312912}[data-weiv-scope="wF814F3C15C0B2B65"].world-top, [data-weiv-scope="wF814F3C15C0B2B65"] .world-top {display:flex;justify-content:space-between;color:#78837e;font-size:9px;text-transform:uppercase}[data-weiv-scope="wF814F3C15C0B2B65"].world-top b, [data-weiv-scope="wF814F3C15C0B2B65"] .world-top b {color:#4a6358}[data-weiv-scope="wF814F3C15C0B2B65"].orb, [data-weiv-scope="wF814F3C15C0B2B65"] .orb {position:relative;height:65px;margin:14px 0;background:radial-gradient(ellipse at center,#ff725e4d,transparent 67%)}[data-weiv-scope="wF814F3C15C0B2B65"].orb i, [data-weiv-scope="wF814F3C15C0B2B65"] .orb i {position:absolute;left:35%;top:17px;width:65px;height:27px;border:1px solid #ff725e;border-radius:50%;transform:rotate(-12deg)}[data-weiv-scope="wF814F3C15C0B2B65"].orb.electric-quiet, [data-weiv-scope="wF814F3C15C0B2B65"] .orb.electric-quiet {background:radial-gradient(ellipse at center,#6b8cff4d,transparent 67%)}[data-weiv-scope="wF814F3C15C0B2B65"].orb.electric-quiet i, [data-weiv-scope="wF814F3C15C0B2B65"] .orb.electric-quiet i {border-color:var(--blue);transform:rotate(15deg)}[data-weiv-scope="wF814F3C15C0B2B65"].orb.mountain-breath, [data-weiv-scope="wF814F3C15C0B2B65"] .orb.mountain-breath {background:radial-gradient(ellipse at center,#75a77d4d,transparent 67%)}[data-weiv-scope="wF814F3C15C0B2B65"].orb.mountain-breath i, [data-weiv-scope="wF814F3C15C0B2B65"] .orb.mountain-breath i {border-color:var(--green);transform:rotate(-3deg)}[data-weiv-scope="wF814F3C15C0B2B65"].world-card h3, [data-weiv-scope="wF814F3C15C0B2B65"] .world-card h3 {margin:0;font:600 23px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].world-card>p, [data-weiv-scope="wF814F3C15C0B2B65"] .world-card>p {min-height:42px;color:#69736e;font-size:11px}[data-weiv-scope="wF814F3C15C0B2B65"].echoes, [data-weiv-scope="wF814F3C15C0B2B65"] .echoes {min-height:30px;color:#88928d;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].gravity, [data-weiv-scope="wF814F3C15C0B2B65"] .gravity {display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:12px}[data-weiv-scope="wF814F3C15C0B2B65"].gravity button, [data-weiv-scope="wF814F3C15C0B2B65"] .gravity button {border:1px solid #d4d8d2;border-radius:13px;padding:6px;background:transparent;color:#53655c;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].gravity b, [data-weiv-scope="wF814F3C15C0B2B65"] .gravity b {grid-column:1/-1;color:#78837e;font-size:8px;text-align:center}[data-weiv-scope="wF814F3C15C0B2B65"].weave, [data-weiv-scope="wF814F3C15C0B2B65"] .weave {display:flex;justify-content:space-between;align-items:center;gap:18px;margin-top:12px;padding:15px 18px;border-radius:16px;background:#e4e8df}[data-weiv-scope="wF814F3C15C0B2B65"].weave>div, [data-weiv-scope="wF814F3C15C0B2B65"] .weave>div {display:flex;gap:8px;align-items:center;flex-wrap:wrap}[data-weiv-scope="wF814F3C15C0B2B65"].weave span, [data-weiv-scope="wF814F3C15C0B2B65"] .weave span {width:100%;color:#718077;font-size:8px;letter-spacing:.14em}[data-weiv-scope="wF814F3C15C0B2B65"].weave b, [data-weiv-scope="wF814F3C15C0B2B65"] .weave b {font:600 13px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].weave i, [data-weiv-scope="wF814F3C15C0B2B65"] .weave i {color:#8d9891}[data-weiv-scope="wF814F3C15C0B2B65"].weave>button, [data-weiv-scope="wF814F3C15C0B2B65"] .weave>button {white-space:nowrap;border:0;border-radius:18px;padding:8px 12px;background:var(--night);color:white;font-size:9px}\n  [data-weiv-scope="wF814F3C15C0B2B65"].ribbon-workspace, [data-weiv-scope="wF814F3C15C0B2B65"] .ribbon-workspace {display:grid;grid-template-columns:minmax(0,1.6fr) minmax(270px,.7fr);gap:18px}[data-weiv-scope="wF814F3C15C0B2B65"].journey-ribbon, [data-weiv-scope="wF814F3C15C0B2B65"] .journey-ribbon, [data-weiv-scope="wF814F3C15C0B2B65"].simulation, [data-weiv-scope="wF814F3C15C0B2B65"] .simulation, [data-weiv-scope="wF814F3C15C0B2B65"].scout-glimpse, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-glimpse {border-radius:20px;background:#fff}[data-weiv-scope="wF814F3C15C0B2B65"].journey-ribbon, [data-weiv-scope="wF814F3C15C0B2B65"] .journey-ribbon {padding:22px}[data-weiv-scope="wF814F3C15C0B2B65"].days, [data-weiv-scope="wF814F3C15C0B2B65"] .days {display:grid}[data-weiv-scope="wF814F3C15C0B2B65"].day, [data-weiv-scope="wF814F3C15C0B2B65"] .day {display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:start;padding:14px 8px;border:0;border-top:1px solid #e6e5df;background:transparent;text-align:left}[data-weiv-scope="wF814F3C15C0B2B65"].day:hover, [data-weiv-scope="wF814F3C15C0B2B65"] .day:hover, [data-weiv-scope="wF814F3C15C0B2B65"].day.active, [data-weiv-scope="wF814F3C15C0B2B65"] .day.active {background:#f6f4ee}[data-weiv-scope="wF814F3C15C0B2B65"].day>i, [data-weiv-scope="wF814F3C15C0B2B65"] .day>i {display:grid;place-items:center;width:31px;height:31px;border:1px solid #cdd4ce;border-radius:50%;font-style:normal;font-size:10px}[data-weiv-scope="wF814F3C15C0B2B65"].day.active>i, [data-weiv-scope="wF814F3C15C0B2B65"] .day.active>i {color:#fff;background:var(--night)}[data-weiv-scope="wF814F3C15C0B2B65"].day small, [data-weiv-scope="wF814F3C15C0B2B65"] .day small, [data-weiv-scope="wF814F3C15C0B2B65"].day b, [data-weiv-scope="wF814F3C15C0B2B65"] .day b, [data-weiv-scope="wF814F3C15C0B2B65"].day p, [data-weiv-scope="wF814F3C15C0B2B65"] .day p {display:block}[data-weiv-scope="wF814F3C15C0B2B65"].day small, [data-weiv-scope="wF814F3C15C0B2B65"] .day small {color:#89928e;font-size:8px;text-transform:uppercase}[data-weiv-scope="wF814F3C15C0B2B65"].day b, [data-weiv-scope="wF814F3C15C0B2B65"] .day b {font:600 15px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].day p, [data-weiv-scope="wF814F3C15C0B2B65"] .day p {margin:2px 0;color:#69736e;font-size:10px}[data-weiv-scope="wF814F3C15C0B2B65"].day>span, [data-weiv-scope="wF814F3C15C0B2B65"] .day>span {padding:3px 7px;border-radius:10px;background:#e8eee9;color:#637268;font-size:8px}[data-weiv-scope="wF814F3C15C0B2B65"].ribbon-workspace aside, [data-weiv-scope="wF814F3C15C0B2B65"] .ribbon-workspace aside {display:grid;gap:18px;align-content:start}[data-weiv-scope="wF814F3C15C0B2B65"].simulation, [data-weiv-scope="wF814F3C15C0B2B65"] .simulation, [data-weiv-scope="wF814F3C15C0B2B65"].scout-glimpse, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-glimpse {padding:22px}[data-weiv-scope="wF814F3C15C0B2B65"].simulation h3, [data-weiv-scope="wF814F3C15C0B2B65"] .simulation h3, [data-weiv-scope="wF814F3C15C0B2B65"].scout-glimpse h3, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-glimpse h3 {margin:5px 0;font:600 22px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].weather-shape, [data-weiv-scope="wF814F3C15C0B2B65"] .weather-shape {position:relative;margin:18px 0;padding:18px;border-radius:15px;background:linear-gradient(145deg,#16232e,#34465b);color:white}[data-weiv-scope="wF814F3C15C0B2B65"].weather-shape i, [data-weiv-scope="wF814F3C15C0B2B65"] .weather-shape i {position:absolute;right:16px;top:12px;width:52px;height:27px;border-radius:50%;background:#ffffff18;box-shadow:-24px 16px 0 #ffffff0d}[data-weiv-scope="wF814F3C15C0B2B65"].weather-shape b, [data-weiv-scope="wF814F3C15C0B2B65"] .weather-shape b, [data-weiv-scope="wF814F3C15C0B2B65"].weather-shape small, [data-weiv-scope="wF814F3C15C0B2B65"] .weather-shape small {display:block;position:relative}[data-weiv-scope="wF814F3C15C0B2B65"].weather-shape b, [data-weiv-scope="wF814F3C15C0B2B65"] .weather-shape b {font:600 16px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].weather-shape small, [data-weiv-scope="wF814F3C15C0B2B65"] .weather-shape small {color:#aebbc4;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].simulation>p, [data-weiv-scope="wF814F3C15C0B2B65"] .simulation>p {min-height:62px;color:#627069;font:italic 13px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].simulation>button, [data-weiv-scope="wF814F3C15C0B2B65"] .simulation>button, [data-weiv-scope="wF814F3C15C0B2B65"].scout-glimpse>button, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-glimpse>button {border:0;background:transparent;color:#425d50;font-size:10px}[data-weiv-scope="wF814F3C15C0B2B65"].scout-glimpse article, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-glimpse article {display:flex;gap:9px;padding:10px 0;border-top:1px solid #e9e8e2}[data-weiv-scope="wF814F3C15C0B2B65"].scout-glimpse article>i, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-glimpse article>i, [data-weiv-scope="wF814F3C15C0B2B65"].scout-grid article>i, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-grid article>i {display:grid;place-items:center;flex:0 0 30px;height:30px;border-radius:50%;color:#fff;font-style:normal}[data-weiv-scope="wF814F3C15C0B2B65"].scout-glimpse b, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-glimpse b {font-size:10px}[data-weiv-scope="wF814F3C15C0B2B65"].scout-glimpse p, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-glimpse p {margin:1px 0;color:#748078;font-size:9px}\n  [data-weiv-scope="wF814F3C15C0B2B65"].subview, [data-weiv-scope="wF814F3C15C0B2B65"] .subview {padding-top:70px}[data-weiv-scope="wF814F3C15C0B2B65"].subview>h1, [data-weiv-scope="wF814F3C15C0B2B65"] .subview>h1 {max-width:800px}[data-weiv-scope="wF814F3C15C0B2B65"].subview .lede, [data-weiv-scope="wF814F3C15C0B2B65"] .subview .lede {max-width:700px;margin:15px 0 38px;font-size:18px}[data-weiv-scope="wF814F3C15C0B2B65"].signal-wall, [data-weiv-scope="wF814F3C15C0B2B65"] .signal-wall, [data-weiv-scope="wF814F3C15C0B2B65"].scout-grid, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-grid {display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px}[data-weiv-scope="wF814F3C15C0B2B65"].signal-wall article, [data-weiv-scope="wF814F3C15C0B2B65"] .signal-wall article {min-height:160px;padding:22px;border-radius:18px;white-space:normal}[data-weiv-scope="wF814F3C15C0B2B65"].signal-wall article b, [data-weiv-scope="wF814F3C15C0B2B65"] .signal-wall article b {display:block;margin:24px 0 8px;font:600 21px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].signal-wall article p, [data-weiv-scope="wF814F3C15C0B2B65"] .signal-wall article p {font-size:10px;color:#69736e}[data-weiv-scope="wF814F3C15C0B2B65"].primary, [data-weiv-scope="wF814F3C15C0B2B65"] .primary {border:0!important;border-radius:22px!important;padding:11px 17px!important;background:var(--night)!important;color:white!important}[data-weiv-scope="wF814F3C15C0B2B65"].scout-grid article, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-grid article {min-height:275px;padding:25px;border:1px solid #d8dad4;border-radius:20px;background:#fff}[data-weiv-scope="wF814F3C15C0B2B65"].scout-grid article>span, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-grid article>span {float:right;color:#7e8983;font-size:9px;text-transform:uppercase}[data-weiv-scope="wF814F3C15C0B2B65"].scout-grid h2, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-grid h2 {clear:both;padding-top:24px;font:600 26px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].scout-grid p, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-grid p {color:#68736e}[data-weiv-scope="wF814F3C15C0B2B65"].scout-grid small, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-grid small {display:block;margin-top:24px;color:#4d6659}[data-weiv-scope="wF814F3C15C0B2B65"].sources, [data-weiv-scope="wF814F3C15C0B2B65"] .sources, [data-weiv-scope="wF814F3C15C0B2B65"].story, [data-weiv-scope="wF814F3C15C0B2B65"] .story, [data-weiv-scope="wF814F3C15C0B2B65"].saved-list, [data-weiv-scope="wF814F3C15C0B2B65"] .saved-list {max-width:850px;margin-top:40px;padding:22px;border-radius:18px;background:#fff}[data-weiv-scope="wF814F3C15C0B2B65"].sources h2, [data-weiv-scope="wF814F3C15C0B2B65"] .sources h2 {font:600 24px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].sources article, [data-weiv-scope="wF814F3C15C0B2B65"] .sources article {display:grid;grid-template-columns:10px 1fr auto;gap:12px;align-items:start;padding:13px 0;border-top:1px solid #ecebe5}[data-weiv-scope="wF814F3C15C0B2B65"].sources p, [data-weiv-scope="wF814F3C15C0B2B65"] .sources p {margin:2px 0;color:#748078;font-size:10px}[data-weiv-scope="wF814F3C15C0B2B65"].sources a, [data-weiv-scope="wF814F3C15C0B2B65"] .sources a {color:#53655d;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].source-dot, [data-weiv-scope="wF814F3C15C0B2B65"] .source-dot {width:8px;height:8px;margin-top:5px;border-radius:50%;background:#aaa}[data-weiv-scope="wF814F3C15C0B2B65"].source-dot.live, [data-weiv-scope="wF814F3C15C0B2B65"] .source-dot.live {background:#58a76c}[data-weiv-scope="wF814F3C15C0B2B65"].source-dot.cached, [data-weiv-scope="wF814F3C15C0B2B65"] .source-dot.cached {background:#d4ab55}[data-weiv-scope="wF814F3C15C0B2B65"].memory-stats, [data-weiv-scope="wF814F3C15C0B2B65"] .memory-stats {display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:850px}[data-weiv-scope="wF814F3C15C0B2B65"].memory-stats article, [data-weiv-scope="wF814F3C15C0B2B65"] .memory-stats article {padding:24px;border-radius:18px;background:#fff}[data-weiv-scope="wF814F3C15C0B2B65"].memory-stats b, [data-weiv-scope="wF814F3C15C0B2B65"] .memory-stats b {display:block;font:500 42px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].memory-stats span, [data-weiv-scope="wF814F3C15C0B2B65"] .memory-stats span {color:#748078}[data-weiv-scope="wF814F3C15C0B2B65"].story article, [data-weiv-scope="wF814F3C15C0B2B65"] .story article, [data-weiv-scope="wF814F3C15C0B2B65"].saved-list article, [data-weiv-scope="wF814F3C15C0B2B65"] .saved-list article {display:flex;gap:14px;padding:12px 0;border-top:1px solid #ecebe5}[data-weiv-scope="wF814F3C15C0B2B65"].story article>i, [data-weiv-scope="wF814F3C15C0B2B65"] .story article>i, [data-weiv-scope="wF814F3C15C0B2B65"].saved-list article>span, [data-weiv-scope="wF814F3C15C0B2B65"] .saved-list article>span {display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#e6ece7;font-style:normal}[data-weiv-scope="wF814F3C15C0B2B65"].story b, [data-weiv-scope="wF814F3C15C0B2B65"] .story b, [data-weiv-scope="wF814F3C15C0B2B65"].saved-list b, [data-weiv-scope="wF814F3C15C0B2B65"] .saved-list b {font-size:11px}[data-weiv-scope="wF814F3C15C0B2B65"].story p, [data-weiv-scope="wF814F3C15C0B2B65"] .story p, [data-weiv-scope="wF814F3C15C0B2B65"].saved-list p, [data-weiv-scope="wF814F3C15C0B2B65"] .saved-list p {margin:2px 0;color:#748078;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].saved-list small, [data-weiv-scope="wF814F3C15C0B2B65"] .saved-list small {margin-left:auto;color:#89938d}\n  [data-weiv-scope="wF814F3C15C0B2B65"].modal-layer, [data-weiv-scope="wF814F3C15C0B2B65"] .modal-layer {position:fixed;inset:0;z-index:10;display:grid;place-items:center;padding:20px;background:#0f1720b8;backdrop-filter:blur(8px)}[data-weiv-scope="wF814F3C15C0B2B65"].modal, [data-weiv-scope="wF814F3C15C0B2B65"] .modal {width:min(560px,100%);padding:30px;border-radius:22px;background:#f7f4ed;box-shadow:0 28px 90px #0006}[data-weiv-scope="wF814F3C15C0B2B65"].modal h2, [data-weiv-scope="wF814F3C15C0B2B65"] .modal h2 {margin:6px 0 20px;font:500 31px Georgia}[data-weiv-scope="wF814F3C15C0B2B65"].kind-row, [data-weiv-scope="wF814F3C15C0B2B65"] .kind-row {display:flex;gap:6px;margin-bottom:13px}[data-weiv-scope="wF814F3C15C0B2B65"].kind-row button, [data-weiv-scope="wF814F3C15C0B2B65"] .kind-row button {border:1px solid #cdd1ca;border-radius:16px;padding:6px 10px;background:transparent;font-size:9px}[data-weiv-scope="wF814F3C15C0B2B65"].modal label, [data-weiv-scope="wF814F3C15C0B2B65"] .modal label {display:grid;gap:6px;color:#64716a;font-size:10px}[data-weiv-scope="wF814F3C15C0B2B65"].modal textarea, [data-weiv-scope="wF814F3C15C0B2B65"] .modal textarea, [data-weiv-scope="wF814F3C15C0B2B65"].modal input, [data-weiv-scope="wF814F3C15C0B2B65"] .modal input {width:100%;padding:11px;border:1px solid #cdd1ca;border-radius:10px;background:white;color:var(--ink)}[data-weiv-scope="wF814F3C15C0B2B65"].modal textarea, [data-weiv-scope="wF814F3C15C0B2B65"] .modal textarea {min-height:90px;resize:vertical}[data-weiv-scope="wF814F3C15C0B2B65"].modal-actions, [data-weiv-scope="wF814F3C15C0B2B65"] .modal-actions {display:flex;justify-content:flex-end;gap:8px;margin-top:20px}[data-weiv-scope="wF814F3C15C0B2B65"].modal-actions button, [data-weiv-scope="wF814F3C15C0B2B65"] .modal-actions button {border:1px solid #cdd1ca;border-radius:20px;padding:9px 14px;background:transparent}[data-weiv-scope="wF814F3C15C0B2B65"].form-grid, [data-weiv-scope="wF814F3C15C0B2B65"] .form-grid {display:grid;grid-template-columns:1fr 1fr;gap:12px}[data-weiv-scope="wF814F3C15C0B2B65"].form-grid .wide, [data-weiv-scope="wF814F3C15C0B2B65"] .form-grid .wide {grid-column:1/-1}\n  @keyframes breathe{50%{transform:scale(.78);opacity:.45}}\n  @media(max-width:980px){[data-weiv-scope="wF814F3C15C0B2B65"].rail, [data-weiv-scope="wF814F3C15C0B2B65"] .rail {position:static;width:auto;height:auto;padding:15px 18px;display:flex;flex-direction:row;align-items:center}[data-weiv-scope="wF814F3C15C0B2B65"].brand, [data-weiv-scope="wF814F3C15C0B2B65"] .brand {margin:0 auto 0 0}[data-weiv-scope="wF814F3C15C0B2B65"].rail nav, [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav {display:flex}[data-weiv-scope="wF814F3C15C0B2B65"].rail nav button, [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav button {font-size:0}[data-weiv-scope="wF814F3C15C0B2B65"].rail nav button span, [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav button span {width:auto;font-size:16px}[data-weiv-scope="wF814F3C15C0B2B65"].new-atlas, [data-weiv-scope="wF814F3C15C0B2B65"] .new-atlas {margin:0 0 0 8px}[data-weiv-scope="wF814F3C15C0B2B65"].rail-foot, [data-weiv-scope="wF814F3C15C0B2B65"] .rail-foot {display:none}[data-weiv-scope="wF814F3C15C0B2B65"]main, [data-weiv-scope="wF814F3C15C0B2B65"] main {margin:0}[data-weiv-scope="wF814F3C15C0B2B65"].world-grid, [data-weiv-scope="wF814F3C15C0B2B65"] .world-grid, [data-weiv-scope="wF814F3C15C0B2B65"].signal-wall, [data-weiv-scope="wF814F3C15C0B2B65"] .signal-wall, [data-weiv-scope="wF814F3C15C0B2B65"].scout-grid, [data-weiv-scope="wF814F3C15C0B2B65"] .scout-grid {grid-template-columns:1fr}[data-weiv-scope="wF814F3C15C0B2B65"].ribbon-workspace, [data-weiv-scope="wF814F3C15C0B2B65"] .ribbon-workspace, [data-weiv-scope="wF814F3C15C0B2B65"].grown-fragment, [data-weiv-scope="wF814F3C15C0B2B65"] .grown-fragment {grid-template-columns:1fr}[data-weiv-scope="wF814F3C15C0B2B65"].atlas-view, [data-weiv-scope="wF814F3C15C0B2B65"] .atlas-view, [data-weiv-scope="wF814F3C15C0B2B65"].subview, [data-weiv-scope="wF814F3C15C0B2B65"] .subview {padding:30px 22px 70px}}\n  @media(max-width:650px){[data-weiv-scope="wF814F3C15C0B2B65"]header, [data-weiv-scope="wF814F3C15C0B2B65"] header {padding:0 18px}[data-weiv-scope="wF814F3C15C0B2B65"].intro, [data-weiv-scope="wF814F3C15C0B2B65"] .intro {display:block}[data-weiv-scope="wF814F3C15C0B2B65"].date-orbit, [data-weiv-scope="wF814F3C15C0B2B65"] .date-orbit {width:auto;margin-top:20px}[data-weiv-scope="wF814F3C15C0B2B65"].desire-input, [data-weiv-scope="wF814F3C15C0B2B65"] .desire-input {grid-template-columns:1fr}[data-weiv-scope="wF814F3C15C0B2B65"].desire-input button, [data-weiv-scope="wF814F3C15C0B2B65"] .desire-input button {padding:12px}[data-weiv-scope="wF814F3C15C0B2B65"].fragment-list, [data-weiv-scope="wF814F3C15C0B2B65"] .fragment-list {grid-template-columns:1fr}[data-weiv-scope="wF814F3C15C0B2B65"].map-stage, [data-weiv-scope="wF814F3C15C0B2B65"] .map-stage {height:470px}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin {width:145px}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin.lantern-drift, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.lantern-drift {left:5%}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin.electric-quiet, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.electric-quiet {right:4%;top:24%}[data-weiv-scope="wF814F3C15C0B2B65"].world-pin.mountain-breath, [data-weiv-scope="wF814F3C15C0B2B65"] .world-pin.mountain-breath {left:28%;bottom:13%}[data-weiv-scope="wF814F3C15C0B2B65"].map-legend, [data-weiv-scope="wF814F3C15C0B2B65"] .map-legend {display:none}[data-weiv-scope="wF814F3C15C0B2B65"].section-title, [data-weiv-scope="wF814F3C15C0B2B65"] .section-title, [data-weiv-scope="wF814F3C15C0B2B65"].weave, [data-weiv-scope="wF814F3C15C0B2B65"] .weave {display:block}[data-weiv-scope="wF814F3C15C0B2B65"].weave>button, [data-weiv-scope="wF814F3C15C0B2B65"] .weave>button {margin-top:12px}[data-weiv-scope="wF814F3C15C0B2B65"].section-title>p, [data-weiv-scope="wF814F3C15C0B2B65"] .section-title>p {margin-top:8px}[data-weiv-scope="wF814F3C15C0B2B65"].form-grid, [data-weiv-scope="wF814F3C15C0B2B65"] .form-grid {grid-template-columns:1fr}[data-weiv-scope="wF814F3C15C0B2B65"].form-grid .wide, [data-weiv-scope="wF814F3C15C0B2B65"] .form-grid .wide {grid-column:auto}[data-weiv-scope="wF814F3C15C0B2B65"].rail nav button:nth-child(4), [data-weiv-scope="wF814F3C15C0B2B65"] .rail nav button:nth-child(4) {display:none}}\n';

export const trackedStateGraph = { roots: [], paths: [], regions: [] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_367 = document.createElement('div');
  refs[367] = __ref_367;
  __ref_367.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_367.setAttribute('class', 'app-shell');
  const __ref_1 = document.createElement('span');
  refs[1] = __ref_1;
  __ref_1.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_1.setAttribute('class', 'bootstrap');
  const __ref_0 = document.createTextNode('');
  refs[0] = __ref_0;
  __ref_1.append(__ref_0);
  __ref_367.append(__ref_1);
  const __ref_27 = document.createElement('aside');
  refs[27] = __ref_27;
  __ref_27.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_27.setAttribute('class', 'rail');
  const __ref_6 = document.createElement('div');
  refs[6] = __ref_6;
  __ref_6.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_6.setAttribute('class', 'brand');
  const __ref_2 = document.createElement('i');
  refs[2] = __ref_2;
  __ref_2.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_2.append(document.createTextNode('r'));
  __ref_6.append(__ref_2);
  const __ref_5 = document.createElement('div');
  refs[5] = __ref_5;
  __ref_5.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_3 = document.createElement('b');
  refs[3] = __ref_3;
  __ref_3.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_3.append(document.createTextNode('roam'));
  __ref_5.append(__ref_3);
  const __ref_4 = document.createElement('small');
  refs[4] = __ref_4;
  __ref_4.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_4.append(document.createTextNode('living journey atlas'));
  __ref_5.append(__ref_4);
  __ref_6.append(__ref_5);
  __ref_27.append(__ref_6);
  const __ref_15 = document.createElement('nav');
  refs[15] = __ref_15;
  __ref_15.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_15.setAttribute('aria-label', 'Atlas navigation');
  const __ref_8 = document.createElement('button');
  refs[8] = __ref_8;
  __ref_8.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_8.addEventListener('click', (event) => {
    const resolved = instance.refresh().showAtlas;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_7 = document.createElement('span');
  refs[7] = __ref_7;
  __ref_7.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_7.append(document.createTextNode('✦'));
  __ref_8.append(__ref_7);
  __ref_8.append(document.createTextNode('Play'));
  __ref_15.append(__ref_8);
  const __ref_10 = document.createElement('button');
  refs[10] = __ref_10;
  __ref_10.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_10.addEventListener('click', (event) => {
    const resolved = instance.refresh().showSignals;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_9 = document.createElement('span');
  refs[9] = __ref_9;
  __ref_9.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_9.append(document.createTextNode('⌁'));
  __ref_10.append(__ref_9);
  __ref_10.append(document.createTextNode('Desires'));
  __ref_15.append(__ref_10);
  const __ref_12 = document.createElement('button');
  refs[12] = __ref_12;
  __ref_12.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_12.addEventListener('click', (event) => {
    const resolved = instance.refresh().showScouts;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_11 = document.createElement('span');
  refs[11] = __ref_11;
  __ref_11.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_11.append(document.createTextNode('◉'));
  __ref_12.append(__ref_11);
  __ref_12.append(document.createTextNode('Scouts'));
  __ref_15.append(__ref_12);
  const __ref_14 = document.createElement('button');
  refs[14] = __ref_14;
  __ref_14.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_14.addEventListener('click', (event) => {
    const resolved = instance.refresh().showMemory;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_13 = document.createElement('span');
  refs[13] = __ref_13;
  __ref_13.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_13.append(document.createTextNode('◌'));
  __ref_14.append(__ref_13);
  __ref_14.append(document.createTextNode('Saved trails'));
  __ref_15.append(__ref_14);
  __ref_27.append(__ref_15);
  const __ref_16 = document.createElement('button');
  refs[16] = __ref_16;
  __ref_16.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_16.setAttribute('class', 'new-atlas');
  __ref_16.addEventListener('click', (event) => {
    const resolved = instance.refresh().openNew;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  __ref_16.append(document.createTextNode('＋ open another atlas'));
  __ref_27.append(__ref_16);
  const __ref_26 = document.createElement('div');
  refs[26] = __ref_26;
  __ref_26.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_26.setAttribute('class', 'rail-foot');
  const __ref_22 = document.createElement('div');
  refs[22] = __ref_22;
  __ref_22.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_22.setAttribute('class', 'faces');
  const __ref_17 = document.createComment('for:start');
  const __ref_18 = document.createComment('for:end');
  refs[17] = __ref_17;
  refs[18] = __ref_18;
  refs[19] = [];
  __ref_22.append(__ref_17);
  __ref_22.append(__ref_18);
  __ref_26.append(__ref_22);
  const __ref_24 = document.createElement('p');
  refs[24] = __ref_24;
  __ref_24.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_23 = document.createTextNode('');
  refs[23] = __ref_23;
  __ref_24.append(__ref_23);
  __ref_24.append(document.createTextNode(' imaginations in motion'));
  __ref_26.append(__ref_24);
  const __ref_25 = document.createElement('small');
  refs[25] = __ref_25;
  __ref_25.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_25.append(document.createTextNode('Built with Weiv · grounded by Harngine'));
  __ref_26.append(__ref_25);
  __ref_27.append(__ref_26);
  __ref_367.append(__ref_27);
  const __ref_329 = document.createElement('main');
  refs[329] = __ref_329;
  __ref_329.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_32 = document.createElement('header');
  refs[32] = __ref_32;
  __ref_32.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_30 = document.createElement('div');
  refs[30] = __ref_30;
  __ref_30.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  const __ref_28 = document.createElement('span');
  refs[28] = __ref_28;
  __ref_28.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_28.setAttribute('class', 'pulse-dot');
  __ref_30.append(__ref_28);
  const __ref_29 = document.createTextNode('');
  refs[29] = __ref_29;
  __ref_30.append(__ref_29);
  __ref_32.append(__ref_30);
  const __ref_31 = document.createElement('button');
  refs[31] = __ref_31;
  __ref_31.setAttribute('data-weiv-scope', 'wF814F3C15C0B2B65');
  __ref_31.addEventListener('click', (event) => {
    const resolved = instance.refresh().refreshAtlas;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  __ref_31.append(document.createTextNode('↻ check the world'));
  __ref_32.append(__ref_31);
  __ref_329.append(__ref_32);
  const __ref_33 = document.createComment('if:start');
  const __ref_34 = document.createComment('if:end');
  refs[33] = __ref_33;
  refs[34] = __ref_34;
  refs[35] = undefined;
  __ref_329.append(__ref_33);
  __ref_329.append(__ref_34);
  const __ref_38 = document.createComment('if:start');
  const __ref_39 = document.createComment('if:end');
  refs[38] = __ref_38;
  refs[39] = __ref_39;
  refs[40] = undefined;
  __ref_329.append(__ref_38);
  __ref_329.append(__ref_39);
  const __ref_44 = document.createComment('if:start');
  const __ref_45 = document.createComment('if:end');
  refs[44] = __ref_44;
  refs[45] = __ref_45;
  refs[46] = undefined;
  __ref_329.append(__ref_44);
  __ref_329.append(__ref_45);
  const __ref_228 = document.createComment('if:start');
  const __ref_229 = document.createComment('if:end');
  refs[228] = __ref_228;
  refs[229] = __ref_229;
  refs[230] = undefined;
  __ref_329.append(__ref_228);
  __ref_329.append(__ref_229);
  const __ref_248 = document.createComment('if:start');
  const __ref_249 = document.createComment('if:end');
  refs[248] = __ref_248;
  refs[249] = __ref_249;
  refs[250] = undefined;
  __ref_329.append(__ref_248);
  __ref_329.append(__ref_249);
  const __ref_284 = document.createComment('if:start');
  const __ref_285 = document.createComment('if:end');
  refs[284] = __ref_284;
  refs[285] = __ref_285;
  refs[286] = undefined;
  __ref_329.append(__ref_284);
  __ref_329.append(__ref_285);
  __ref_367.append(__ref_329);
  const __ref_330 = document.createComment('if:start');
  const __ref_331 = document.createComment('if:end');
  refs[330] = __ref_330;
  refs[331] = __ref_331;
  refs[332] = undefined;
  __ref_367.append(__ref_330);
  __ref_367.append(__ref_331);
  const __ref_348 = document.createComment('if:start');
  const __ref_349 = document.createComment('if:end');
  refs[348] = __ref_348;
  refs[349] = __ref_349;
  refs[350] = undefined;
  __ref_367.append(__ref_348);
  __ref_367.append(__ref_349);
  fragment.append(__ref_367);
  return fragment;
}

function updateRegion_text_0(instance, scope, refs) {
  const __next_text_0 = String(scope.boot() ?? '');
  if (refs[0].data !== __next_text_0) {
    refs[0].data = __next_text_0;
  }
}
function updateRegion_attribute_8_class(instance, scope, refs) {
  const __value_8_class = scope.navClass('atlas');
  if (__value_8_class === false || __value_8_class === null || __value_8_class === undefined) {
    if (refs[8].hasAttribute('class')) {
      refs[8].removeAttribute('class');
    }
  } else if (__value_8_class === true) {
    if (!refs[8].hasAttribute('class')) {
      refs[8].setAttribute('class', '');
    }
  } else {
    refs[8].setAttribute('class', String(__value_8_class));
  }
}
function updateRegion_attribute_10_class(instance, scope, refs) {
  const __value_10_class = scope.navClass('signals');
  if (__value_10_class === false || __value_10_class === null || __value_10_class === undefined) {
    if (refs[10].hasAttribute('class')) {
      refs[10].removeAttribute('class');
    }
  } else if (__value_10_class === true) {
    if (!refs[10].hasAttribute('class')) {
      refs[10].setAttribute('class', '');
    }
  } else {
    refs[10].setAttribute('class', String(__value_10_class));
  }
}
function updateRegion_attribute_12_class(instance, scope, refs) {
  const __value_12_class = scope.navClass('scouts');
  if (__value_12_class === false || __value_12_class === null || __value_12_class === undefined) {
    if (refs[12].hasAttribute('class')) {
      refs[12].removeAttribute('class');
    }
  } else if (__value_12_class === true) {
    if (!refs[12].hasAttribute('class')) {
      refs[12].setAttribute('class', '');
    }
  } else {
    refs[12].setAttribute('class', String(__value_12_class));
  }
}
function updateRegion_attribute_14_class(instance, scope, refs) {
  const __value_14_class = scope.navClass('memory');
  if (__value_14_class === false || __value_14_class === null || __value_14_class === undefined) {
    if (refs[14].hasAttribute('class')) {
      refs[14].removeAttribute('class');
    }
  } else if (__value_14_class === true) {
    if (!refs[14].hasAttribute('class')) {
      refs[14].setAttribute('class', '');
    }
  } else {
    refs[14].setAttribute('class', String(__value_14_class));
  }
}
function updateRegion_loop_17(instance, scope, refs) {
  updateForLoop_17(instance, scope);
}
function updateRegion_text_20(instance, scope, refs) {
  const __next_text_20 = String(scope.traveler.initials ?? '');
  if (refs[20].data !== __next_text_20) {
    refs[20].data = __next_text_20;
  }
}
function updateRegion_text_23(instance, scope, refs) {
  const __next_text_23 = String(scope.travelers.length ?? '');
  if (refs[23].data !== __next_text_23) {
    refs[23].data = __next_text_23;
  }
}
function updateRegion_text_29(instance, scope, refs) {
  const __next_text_29 = String((scope.busy ? 'scouts are listening…' : scope.statusLine()) ?? '');
  if (refs[29].data !== __next_text_29) {
    refs[29].data = __next_text_29;
  }
}
function updateRegion_attribute_31_disabled(instance, scope, refs) {
  const __value_31_disabled = scope.busy;
  const __next_31_disabled = Boolean(__value_31_disabled);
  if (refs[31].disabled !== __next_31_disabled) {
    refs[31].disabled = __next_31_disabled;
  }
  const __has_attr_31_disabled = refs[31].hasAttribute('disabled');
  if (__next_31_disabled) {
    if (!__has_attr_31_disabled) {
      refs[31].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_31_disabled) {
      refs[31].removeAttribute('disabled');
    }
  }
}
function updateRegion_conditional_33(instance, scope, refs) {
  updateConditional_33(instance, scope);
}
function updateRegion_text_36(instance, scope, refs) {
  const __next_text_36 = String(scope.errorMessage ?? '');
  if (refs[36].data !== __next_text_36) {
    refs[36].data = __next_text_36;
  }
}
function updateRegion_conditional_38(instance, scope, refs) {
  updateConditional_38(instance, scope);
}
function updateRegion_conditional_44(instance, scope, refs) {
  updateConditional_44(instance, scope);
}
function updateRegion_text_47(instance, scope, refs) {
  const __next_text_47 = String(scope.data.brief.origin ?? '');
  if (refs[47].data !== __next_text_47) {
    refs[47].data = __next_text_47;
  }
}
function updateRegion_text_53(instance, scope, refs) {
  const __next_text_53 = String(scope.shortDate(scope.data.brief.startDate) ?? '');
  if (refs[53].data !== __next_text_53) {
    refs[53].data = __next_text_53;
  }
}
function updateRegion_text_54(instance, scope, refs) {
  const __next_text_54 = String(scope.shortDate(scope.data.brief.endDate) ?? '');
  if (refs[54].data !== __next_text_54) {
    refs[54].data = __next_text_54;
  }
}
function updateRegion_text_56(instance, scope, refs) {
  const __next_text_56 = String(scope.weatherWhisper() ?? '');
  if (refs[56].data !== __next_text_56) {
    refs[56].data = __next_text_56;
  }
}
function updateRegion_attribute_63_value(instance, scope, refs) {
  const __value_63_value = scope.quickDesire;
  const __next_63_value = __value_63_value ?? '';
  const __next_string_63_value = String(__next_63_value);
  if (refs[63].value !== __next_string_63_value) {
    refs[63].value = __next_string_63_value;
  }
  refs[63].setAttribute('value', __next_string_63_value);
}
function updateRegion_attribute_64_disabled(instance, scope, refs) {
  const __value_64_disabled = scope.busy;
  const __next_64_disabled = Boolean(__value_64_disabled);
  if (refs[64].disabled !== __next_64_disabled) {
    refs[64].disabled = __next_64_disabled;
  }
  const __has_attr_64_disabled = refs[64].hasAttribute('disabled');
  if (__next_64_disabled) {
    if (!__has_attr_64_disabled) {
      refs[64].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_64_disabled) {
      refs[64].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_74(instance, scope, refs) {
  const __next_text_74 = String(scope.latestDesire() ?? '');
  if (refs[74].data !== __next_text_74) {
    refs[74].data = __next_text_74;
  }
}
function updateRegion_loop_78(instance, scope, refs) {
  updateForLoop_78(instance, scope);
}
function updateRegion_text_82(instance, scope, refs) {
  const __next_text_82 = String(scope.world.title ?? '');
  if (refs[82].data !== __next_text_82) {
    refs[82].data = __next_text_82;
  }
}
function updateRegion_text_84(instance, scope, refs) {
  const __next_text_84 = String(scope.world.days[0].title ?? '');
  if (refs[84].data !== __next_text_84) {
    refs[84].data = __next_text_84;
  }
}
function updateRegion_text_85(instance, scope, refs) {
  const __next_text_85 = String(scope.world.days[0].place ?? '');
  if (refs[85].data !== __next_text_85) {
    refs[85].data = __next_text_85;
  }
}
function updateRegion_loop_103(instance, scope, refs) {
  updateForLoop_103(instance, scope);
}
function updateRegion_attribute_111_class(instance, scope, refs) {
  const __value_111_class = scope.pinClass(scope.world);
  if (
    __value_111_class === false ||
    __value_111_class === null ||
    __value_111_class === undefined
  ) {
    if (refs[111].hasAttribute('class')) {
      refs[111].removeAttribute('class');
    }
  } else if (__value_111_class === true) {
    if (!refs[111].hasAttribute('class')) {
      refs[111].setAttribute('class', '');
    }
  } else {
    refs[111].setAttribute('class', String(__value_111_class));
  }
}
function updateRegion_text_107(instance, scope, refs) {
  const __next_text_107 = String(scope.world.title ?? '');
  if (refs[107].data !== __next_text_107) {
    refs[107].data = __next_text_107;
  }
}
function updateRegion_text_109(instance, scope, refs) {
  const __next_text_109 = String(scope.world.atmosphere ?? '');
  if (refs[109].data !== __next_text_109) {
    refs[109].data = __next_text_109;
  }
}
function updateRegion_loop_126(instance, scope, refs) {
  updateForLoop_126(instance, scope);
}
function updateRegion_attribute_132_class(instance, scope, refs) {
  const __value_132_class = scope.signalClass(scope.signal);
  if (
    __value_132_class === false ||
    __value_132_class === null ||
    __value_132_class === undefined
  ) {
    if (refs[132].hasAttribute('class')) {
      refs[132].removeAttribute('class');
    }
  } else if (__value_132_class === true) {
    if (!refs[132].hasAttribute('class')) {
      refs[132].setAttribute('class', '');
    }
  } else {
    refs[132].setAttribute('class', String(__value_132_class));
  }
}
function updateRegion_text_129(instance, scope, refs) {
  const __next_text_129 = String(scope.signal.kind ?? '');
  if (refs[129].data !== __next_text_129) {
    refs[129].data = __next_text_129;
  }
}
function updateRegion_text_131(instance, scope, refs) {
  const __next_text_131 = String(scope.signal.text ?? '');
  if (refs[131].data !== __next_text_131) {
    refs[131].data = __next_text_131;
  }
}
function updateRegion_loop_140(instance, scope, refs) {
  updateForLoop_140(instance, scope);
}
function updateRegion_attribute_161_class(instance, scope, refs) {
  const __value_161_class = scope.worldClass(scope.world);
  if (
    __value_161_class === false ||
    __value_161_class === null ||
    __value_161_class === undefined
  ) {
    if (refs[161].hasAttribute('class')) {
      refs[161].removeAttribute('class');
    }
  } else if (__value_161_class === true) {
    if (!refs[161].hasAttribute('class')) {
      refs[161].setAttribute('class', '');
    }
  } else {
    refs[161].setAttribute('class', String(__value_161_class));
  }
}
function updateRegion_text_143(instance, scope, refs) {
  const __next_text_143 = String(scope.world.label ?? '');
  if (refs[143].data !== __next_text_143) {
    refs[143].data = __next_text_143;
  }
}
function updateRegion_text_145(instance, scope, refs) {
  const __next_text_145 = String(scope.world.fit ?? '');
  if (refs[145].data !== __next_text_145) {
    refs[145].data = __next_text_145;
  }
}
function updateRegion_attribute_149_class(instance, scope, refs) {
  const __value_149_class = 'orb ' + scope.world.id;
  if (
    __value_149_class === false ||
    __value_149_class === null ||
    __value_149_class === undefined
  ) {
    if (refs[149].hasAttribute('class')) {
      refs[149].removeAttribute('class');
    }
  } else if (__value_149_class === true) {
    if (!refs[149].hasAttribute('class')) {
      refs[149].setAttribute('class', '');
    }
  } else {
    refs[149].setAttribute('class', String(__value_149_class));
  }
}
function updateRegion_text_150(instance, scope, refs) {
  const __next_text_150 = String(scope.world.title ?? '');
  if (refs[150].data !== __next_text_150) {
    refs[150].data = __next_text_150;
  }
}
function updateRegion_text_152(instance, scope, refs) {
  const __next_text_152 = String(scope.world.summary ?? '');
  if (refs[152].data !== __next_text_152) {
    refs[152].data = __next_text_152;
  }
}
function updateRegion_text_154(instance, scope, refs) {
  const __next_text_154 = String(scope.echoLine(scope.world) ?? '');
  if (refs[154].data !== __next_text_154) {
    refs[154].data = __next_text_154;
  }
}
function updateRegion_attribute_156_disabled(instance, scope, refs) {
  const __value_156_disabled = scope.busy;
  const __next_156_disabled = Boolean(__value_156_disabled);
  if (refs[156].disabled !== __next_156_disabled) {
    refs[156].disabled = __next_156_disabled;
  }
  const __has_attr_156_disabled = refs[156].hasAttribute('disabled');
  if (__next_156_disabled) {
    if (!__has_attr_156_disabled) {
      refs[156].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_156_disabled) {
      refs[156].removeAttribute('disabled');
    }
  }
}
function updateRegion_attribute_157_disabled(instance, scope, refs) {
  const __value_157_disabled = scope.busy;
  const __next_157_disabled = Boolean(__value_157_disabled);
  if (refs[157].disabled !== __next_157_disabled) {
    refs[157].disabled = __next_157_disabled;
  }
  const __has_attr_157_disabled = refs[157].hasAttribute('disabled');
  if (__next_157_disabled) {
    if (!__has_attr_157_disabled) {
      refs[157].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_157_disabled) {
      refs[157].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_158(instance, scope, refs) {
  const __next_text_158 = String(scope.gravityLabel(scope.world.id) ?? '');
  if (refs[158].data !== __next_text_158) {
    refs[158].data = __next_text_158;
  }
}
function updateRegion_text_164(instance, scope, refs) {
  const __next_text_164 = String(scope.latestDesire() ?? '');
  if (refs[164].data !== __next_text_164) {
    refs[164].data = __next_text_164;
  }
}
function updateRegion_text_167(instance, scope, refs) {
  const __next_text_167 = String(scope.partnerDesire() ?? '');
  if (refs[167].data !== __next_text_167) {
    refs[167].data = __next_text_167;
  }
}
function updateRegion_attribute_170_disabled(instance, scope, refs) {
  const __value_170_disabled = scope.busy;
  const __next_170_disabled = Boolean(__value_170_disabled);
  if (refs[170].disabled !== __next_170_disabled) {
    refs[170].disabled = __next_170_disabled;
  }
  const __has_attr_170_disabled = refs[170].hasAttribute('disabled');
  if (__next_170_disabled) {
    if (!__has_attr_170_disabled) {
      refs[170].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_170_disabled) {
      refs[170].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_174(instance, scope, refs) {
  const __next_text_174 = String(scope.selected.title ?? '');
  if (refs[174].data !== __next_text_174) {
    refs[174].data = __next_text_174;
  }
}
function updateRegion_attribute_177_disabled(instance, scope, refs) {
  const __value_177_disabled = scope.busy;
  const __next_177_disabled = Boolean(__value_177_disabled);
  if (refs[177].disabled !== __next_177_disabled) {
    refs[177].disabled = __next_177_disabled;
  }
  const __has_attr_177_disabled = refs[177].hasAttribute('disabled');
  if (__next_177_disabled) {
    if (!__has_attr_177_disabled) {
      refs[177].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_177_disabled) {
      refs[177].removeAttribute('disabled');
    }
  }
}
function updateRegion_loop_179(instance, scope, refs) {
  updateForLoop_179(instance, scope);
}
function updateRegion_attribute_194_class(instance, scope, refs) {
  const __value_194_class = scope.dayClass(scope.day);
  if (
    __value_194_class === false ||
    __value_194_class === null ||
    __value_194_class === undefined
  ) {
    if (refs[194].hasAttribute('class')) {
      refs[194].removeAttribute('class');
    }
  } else if (__value_194_class === true) {
    if (!refs[194].hasAttribute('class')) {
      refs[194].setAttribute('class', '');
    }
  } else {
    refs[194].setAttribute('class', String(__value_194_class));
  }
}
function updateRegion_text_182(instance, scope, refs) {
  const __next_text_182 = String(scope.padDay(scope.day.day) ?? '');
  if (refs[182].data !== __next_text_182) {
    refs[182].data = __next_text_182;
  }
}
function updateRegion_text_184(instance, scope, refs) {
  const __next_text_184 = String(scope.day.place ?? '');
  if (refs[184].data !== __next_text_184) {
    refs[184].data = __next_text_184;
  }
}
function updateRegion_text_185(instance, scope, refs) {
  const __next_text_185 = String(scope.shortDate(scope.day.date) ?? '');
  if (refs[185].data !== __next_text_185) {
    refs[185].data = __next_text_185;
  }
}
function updateRegion_text_187(instance, scope, refs) {
  const __next_text_187 = String(scope.day.title ?? '');
  if (refs[187].data !== __next_text_187) {
    refs[187].data = __next_text_187;
  }
}
function updateRegion_text_189(instance, scope, refs) {
  const __next_text_189 = String(scope.day.texture ?? '');
  if (refs[189].data !== __next_text_189) {
    refs[189].data = __next_text_189;
  }
}
function updateRegion_text_192(instance, scope, refs) {
  const __next_text_192 = String(scope.day.pace ?? '');
  if (refs[192].data !== __next_text_192) {
    refs[192].data = __next_text_192;
  }
}
function updateRegion_text_200(instance, scope, refs) {
  const __next_text_200 = String(scope.simulated.title ?? '');
  if (refs[200].data !== __next_text_200) {
    refs[200].data = __next_text_200;
  }
}
function updateRegion_text_202(instance, scope, refs) {
  const __next_text_202 = String(scope.simulated.day ?? '');
  if (refs[202].data !== __next_text_202) {
    refs[202].data = __next_text_202;
  }
}
function updateRegion_text_203(instance, scope, refs) {
  const __next_text_203 = String(scope.simulated.place ?? '');
  if (refs[203].data !== __next_text_203) {
    refs[203].data = __next_text_203;
  }
}
function updateRegion_text_206(instance, scope, refs) {
  const __next_text_206 = String(scope.simulated.alternate ?? '');
  if (refs[206].data !== __next_text_206) {
    refs[206].data = __next_text_206;
  }
}
function updateRegion_loop_211(instance, scope, refs) {
  updateForLoop_211(instance, scope);
}
function updateRegion_attribute_215_style(instance, scope, refs) {
  const __value_215_style = scope.scoutStyle(scope.scout);
  if (
    __value_215_style === false ||
    __value_215_style === null ||
    __value_215_style === undefined
  ) {
    if (refs[215].hasAttribute('style')) {
      refs[215].removeAttribute('style');
    }
  } else if (__value_215_style === true) {
    if (!refs[215].hasAttribute('style')) {
      refs[215].setAttribute('style', '');
    }
  } else {
    refs[215].setAttribute('style', String(__value_215_style));
  }
}
function updateRegion_text_214(instance, scope, refs) {
  const __next_text_214 = String(scope.scout.name.slice(0, 1) ?? '');
  if (refs[214].data !== __next_text_214) {
    refs[214].data = __next_text_214;
  }
}
function updateRegion_text_216(instance, scope, refs) {
  const __next_text_216 = String(scope.scout.name ?? '');
  if (refs[216].data !== __next_text_216) {
    refs[216].data = __next_text_216;
  }
}
function updateRegion_text_217(instance, scope, refs) {
  const __next_text_217 = String(scope.scout.lens ?? '');
  if (refs[217].data !== __next_text_217) {
    refs[217].data = __next_text_217;
  }
}
function updateRegion_text_219(instance, scope, refs) {
  const __next_text_219 = String(scope.scout.changed ?? '');
  if (refs[219].data !== __next_text_219) {
    refs[219].data = __next_text_219;
  }
}
function updateRegion_conditional_228(instance, scope, refs) {
  updateConditional_228(instance, scope);
}
function updateRegion_loop_234(instance, scope, refs) {
  updateForLoop_234(instance, scope);
}
function updateRegion_attribute_244_class(instance, scope, refs) {
  const __value_244_class = scope.signalClass(scope.signal);
  if (
    __value_244_class === false ||
    __value_244_class === null ||
    __value_244_class === undefined
  ) {
    if (refs[244].hasAttribute('class')) {
      refs[244].removeAttribute('class');
    }
  } else if (__value_244_class === true) {
    if (!refs[244].hasAttribute('class')) {
      refs[244].setAttribute('class', '');
    }
  } else {
    refs[244].setAttribute('class', String(__value_244_class));
  }
}
function updateRegion_text_237(instance, scope, refs) {
  const __next_text_237 = String(scope.signal.kind ?? '');
  if (refs[237].data !== __next_text_237) {
    refs[237].data = __next_text_237;
  }
}
function updateRegion_text_238(instance, scope, refs) {
  const __next_text_238 = String(scope.authorName(scope.signal.author) ?? '');
  if (refs[238].data !== __next_text_238) {
    refs[238].data = __next_text_238;
  }
}
function updateRegion_text_240(instance, scope, refs) {
  const __next_text_240 = String(scope.signal.text ?? '');
  if (refs[240].data !== __next_text_240) {
    refs[240].data = __next_text_240;
  }
}
function updateRegion_text_242(instance, scope, refs) {
  const __next_text_242 = String(scope.worldEchoCount(scope.signal.text) ?? '');
  if (refs[242].data !== __next_text_242) {
    refs[242].data = __next_text_242;
  }
}
function updateRegion_conditional_248(instance, scope, refs) {
  updateConditional_248(instance, scope);
}
function updateRegion_loop_254(instance, scope, refs) {
  updateForLoop_254(instance, scope);
}
function updateRegion_attribute_258_style(instance, scope, refs) {
  const __value_258_style = scope.scoutStyle(scope.scout);
  if (
    __value_258_style === false ||
    __value_258_style === null ||
    __value_258_style === undefined
  ) {
    if (refs[258].hasAttribute('style')) {
      refs[258].removeAttribute('style');
    }
  } else if (__value_258_style === true) {
    if (!refs[258].hasAttribute('style')) {
      refs[258].setAttribute('style', '');
    }
  } else {
    refs[258].setAttribute('style', String(__value_258_style));
  }
}
function updateRegion_text_257(instance, scope, refs) {
  const __next_text_257 = String(scope.scout.name.slice(0, 1) ?? '');
  if (refs[257].data !== __next_text_257) {
    refs[257].data = __next_text_257;
  }
}
function updateRegion_text_259(instance, scope, refs) {
  const __next_text_259 = String(scope.scout.lens ?? '');
  if (refs[259].data !== __next_text_259) {
    refs[259].data = __next_text_259;
  }
}
function updateRegion_text_261(instance, scope, refs) {
  const __next_text_261 = String(scope.scout.name ?? '');
  if (refs[261].data !== __next_text_261) {
    refs[261].data = __next_text_261;
  }
}
function updateRegion_text_263(instance, scope, refs) {
  const __next_text_263 = String(scope.scout.note ?? '');
  if (refs[263].data !== __next_text_263) {
    refs[263].data = __next_text_263;
  }
}
function updateRegion_text_265(instance, scope, refs) {
  const __next_text_265 = String(scope.scout.changed ?? '');
  if (refs[265].data !== __next_text_265) {
    refs[265].data = __next_text_265;
  }
}
function updateRegion_loop_270(instance, scope, refs) {
  updateForLoop_270(instance, scope);
}
function updateRegion_attribute_273_class(instance, scope, refs) {
  const __value_273_class = scope.sourceClass(scope.source);
  if (
    __value_273_class === false ||
    __value_273_class === null ||
    __value_273_class === undefined
  ) {
    if (refs[273].hasAttribute('class')) {
      refs[273].removeAttribute('class');
    }
  } else if (__value_273_class === true) {
    if (!refs[273].hasAttribute('class')) {
      refs[273].setAttribute('class', '');
    }
  } else {
    refs[273].setAttribute('class', String(__value_273_class));
  }
}
function updateRegion_text_274(instance, scope, refs) {
  const __next_text_274 = String(scope.source.provider ?? '');
  if (refs[274].data !== __next_text_274) {
    refs[274].data = __next_text_274;
  }
}
function updateRegion_text_276(instance, scope, refs) {
  const __next_text_276 = String(scope.source.note ?? '');
  if (refs[276].data !== __next_text_276) {
    refs[276].data = __next_text_276;
  }
}
function updateRegion_attribute_280_href(instance, scope, refs) {
  const __value_280_href = scope.source.url;
  if (__value_280_href === false || __value_280_href === null || __value_280_href === undefined) {
    if (refs[280].hasAttribute('href')) {
      refs[280].removeAttribute('href');
    }
  } else if (__value_280_href === true) {
    if (!refs[280].hasAttribute('href')) {
      refs[280].setAttribute('href', '');
    }
  } else {
    refs[280].setAttribute('href', String(__value_280_href));
  }
}
function updateRegion_text_279(instance, scope, refs) {
  const __next_text_279 = String(scope.source.state ?? '');
  if (refs[279].data !== __next_text_279) {
    refs[279].data = __next_text_279;
  }
}
function updateRegion_conditional_284(instance, scope, refs) {
  updateConditional_284(instance, scope);
}
function updateRegion_text_290(instance, scope, refs) {
  const __next_text_290 = String(scope.savedTrails.length ?? '');
  if (refs[290].data !== __next_text_290) {
    refs[290].data = __next_text_290;
  }
}
function updateRegion_text_294(instance, scope, refs) {
  const __next_text_294 = String(scope.data.memory.previousPulses ?? '');
  if (refs[294].data !== __next_text_294) {
    refs[294].data = __next_text_294;
  }
}
function updateRegion_text_298(instance, scope, refs) {
  const __next_text_298 = String(scope.signals.length ?? '');
  if (refs[298].data !== __next_text_298) {
    refs[298].data = __next_text_298;
  }
}
function updateRegion_loop_303(instance, scope, refs) {
  updateForLoop_303(instance, scope);
}
function updateRegion_text_307(instance, scope, refs) {
  const __next_text_307 = String(scope.trail.title ?? '');
  if (refs[307].data !== __next_text_307) {
    refs[307].data = __next_text_307;
  }
}
function updateRegion_text_309(instance, scope, refs) {
  const __next_text_309 = String(scope.trail.desire ?? '');
  if (refs[309].data !== __next_text_309) {
    refs[309].data = __next_text_309;
  }
}
function updateRegion_text_312(instance, scope, refs) {
  const __next_text_312 = String(scope.savedDate(scope.trail.savedAt) ?? '');
  if (refs[312].data !== __next_text_312) {
    refs[312].data = __next_text_312;
  }
}
function updateRegion_loop_316(instance, scope, refs) {
  updateForLoop_316(instance, scope);
}
function updateRegion_text_319(instance, scope, refs) {
  const __next_text_319 = String(scope.storyIcon(scope.entry) ?? '');
  if (refs[319].data !== __next_text_319) {
    refs[319].data = __next_text_319;
  }
}
function updateRegion_text_321(instance, scope, refs) {
  const __next_text_321 = String(scope.entry.presentation.title ?? '');
  if (refs[321].data !== __next_text_321) {
    refs[321].data = __next_text_321;
  }
}
function updateRegion_text_323(instance, scope, refs) {
  const __next_text_323 = String((scope.entry.presentation.summary || scope.entry.type) ?? '');
  if (refs[323].data !== __next_text_323) {
    refs[323].data = __next_text_323;
  }
}
function updateRegion_conditional_330(instance, scope, refs) {
  updateConditional_330(instance, scope);
}
function updateRegion_text_340(instance, scope, refs) {
  const __next_text_340 = String(scope.draftKind ?? '');
  if (refs[340].data !== __next_text_340) {
    refs[340].data = __next_text_340;
  }
}
function updateRegion_attribute_341_value(instance, scope, refs) {
  const __value_341_value = scope.draftSignal;
  const __next_341_value = __value_341_value ?? '';
  const __next_string_341_value = String(__next_341_value);
  if (refs[341].value !== __next_string_341_value) {
    refs[341].value = __next_string_341_value;
  }
  refs[341].setAttribute('value', __next_string_341_value);
}
function updateRegion_attribute_344_disabled(instance, scope, refs) {
  const __value_344_disabled = scope.busy;
  const __next_344_disabled = Boolean(__value_344_disabled);
  if (refs[344].disabled !== __next_344_disabled) {
    refs[344].disabled = __next_344_disabled;
  }
  const __has_attr_344_disabled = refs[344].hasAttribute('disabled');
  if (__next_344_disabled) {
    if (!__has_attr_344_disabled) {
      refs[344].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_344_disabled) {
      refs[344].removeAttribute('disabled');
    }
  }
}
function updateRegion_conditional_348(instance, scope, refs) {
  updateConditional_348(instance, scope);
}
function updateRegion_attribute_353_value(instance, scope, refs) {
  const __value_353_value = scope.draftOrigin;
  const __next_353_value = __value_353_value ?? '';
  const __next_string_353_value = String(__next_353_value);
  if (refs[353].value !== __next_string_353_value) {
    refs[353].value = __next_string_353_value;
  }
  refs[353].setAttribute('value', __next_string_353_value);
}
function updateRegion_attribute_355_value(instance, scope, refs) {
  const __value_355_value = scope.draftStart;
  const __next_355_value = __value_355_value ?? '';
  const __next_string_355_value = String(__next_355_value);
  if (refs[355].value !== __next_string_355_value) {
    refs[355].value = __next_string_355_value;
  }
  refs[355].setAttribute('value', __next_string_355_value);
}
function updateRegion_attribute_357_value(instance, scope, refs) {
  const __value_357_value = scope.draftEnd;
  const __next_357_value = __value_357_value ?? '';
  const __next_string_357_value = String(__next_357_value);
  if (refs[357].value !== __next_string_357_value) {
    refs[357].value = __next_string_357_value;
  }
  refs[357].setAttribute('value', __next_string_357_value);
}
function updateRegion_attribute_359_value(instance, scope, refs) {
  const __value_359_value = scope.draftSparks;
  const __next_359_value = __value_359_value ?? '';
  const __next_string_359_value = String(__next_359_value);
  if (refs[359].value !== __next_string_359_value) {
    refs[359].value = __next_string_359_value;
  }
  refs[359].setAttribute('value', __next_string_359_value);
}
function updateRegion_attribute_363_disabled(instance, scope, refs) {
  const __value_363_disabled = scope.busy;
  const __next_363_disabled = Boolean(__value_363_disabled);
  if (refs[363].disabled !== __next_363_disabled) {
    refs[363].disabled = __next_363_disabled;
  }
  const __has_attr_363_disabled = refs[363].hasAttribute('disabled');
  if (__next_363_disabled) {
    if (!__has_attr_363_disabled) {
      refs[363].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_363_disabled) {
      refs[363].removeAttribute('disabled');
    }
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_text_0(instance, scope, refs);
  updateRegion_attribute_8_class(instance, scope, refs);
  updateRegion_attribute_10_class(instance, scope, refs);
  updateRegion_attribute_12_class(instance, scope, refs);
  updateRegion_attribute_14_class(instance, scope, refs);
  updateRegion_loop_17(instance, scope, refs);
  updateRegion_text_23(instance, scope, refs);
  updateRegion_text_29(instance, scope, refs);
  updateRegion_attribute_31_disabled(instance, scope, refs);
  updateRegion_conditional_33(instance, scope, refs);
  updateRegion_conditional_38(instance, scope, refs);
  updateRegion_conditional_44(instance, scope, refs);
  updateRegion_conditional_228(instance, scope, refs);
  updateRegion_conditional_248(instance, scope, refs);
  updateRegion_conditional_284(instance, scope, refs);
  updateRegion_conditional_330(instance, scope, refs);
  updateRegion_conditional_348(instance, scope, refs);
}

function updateDirtyRegions(instance, dirtyState, scope = instance.refresh()) {
  const refs = instance.refs;
  const normalizedDirtyState = normalizeDirtyState(dirtyState);
  const dirtySet = new Set(normalizedDirtyState.bindings);
  const dirtyPathSet = new Set(normalizedDirtyState.paths);
  const dirtyRegionSet = new Set();
  if (dirtyPathSet.size > 0 && trackedStateGraph && Array.isArray(trackedStateGraph.regions)) {
    for (const region of trackedStateGraph.regions) {
      if (!region || !Array.isArray(region.trackedPathIds)) continue;
      for (const pathId of region.trackedPathIds) {
        if (dirtyPathSet.has(pathId)) {
          dirtyRegionSet.add(region.regionId);
          break;
        }
      }
    }
  }
  if (
    dirtySet.has('boot') ||
    dirtySet.has('busy') ||
    dirtySet.has('initialized') ||
    dirtySet.has('load') ||
    dirtySet.has('showNew') ||
    dirtySet.has('showSignal') ||
    dirtyRegionSet.has(1)
  ) {
    updateRegion_text_0(instance, scope, refs);
  }
  if (dirtySet.has('navClass') || dirtySet.has('active') || dirtyRegionSet.has(2)) {
    updateRegion_attribute_8_class(instance, scope, refs);
  }
  if (
    dirtySet.has('navClass') ||
    dirtySet.has('active') ||
    dirtySet.has('signals') ||
    dirtyRegionSet.has(3)
  ) {
    updateRegion_attribute_10_class(instance, scope, refs);
  }
  if (
    dirtySet.has('navClass') ||
    dirtySet.has('active') ||
    dirtySet.has('scouts') ||
    dirtyRegionSet.has(4)
  ) {
    updateRegion_attribute_12_class(instance, scope, refs);
  }
  if (dirtySet.has('navClass') || dirtySet.has('active') || dirtyRegionSet.has(5)) {
    updateRegion_attribute_14_class(instance, scope, refs);
  }
  if (dirtySet.has('travelers') || dirtyRegionSet.has(6)) {
    updateRegion_loop_17(instance, scope, refs);
  }
  if (dirtySet.has('travelers') || dirtyRegionSet.has(7)) {
    updateRegion_text_23(instance, scope, refs);
  }
  if (
    dirtySet.has('busy') ||
    dirtySet.has('scouts') ||
    dirtySet.has('statusLine') ||
    dirtySet.has('data') ||
    dirtyRegionSet.has(8)
  ) {
    updateRegion_text_29(instance, scope, refs);
  }
  if (dirtySet.has('busy') || dirtyRegionSet.has(9)) {
    updateRegion_attribute_31_disabled(instance, scope, refs);
  }
  if (dirtySet.has('errorMessage') || dirtyRegionSet.has(10)) {
    updateRegion_conditional_33(instance, scope, refs);
  }
  if (dirtySet.has('data') || dirtyRegionSet.has(11)) {
    updateRegion_conditional_38(instance, scope, refs);
  }
  if (
    dirtySet.has('data') ||
    dirtySet.has('active') ||
    dirtySet.has('shortDate') ||
    dirtySet.has('weatherWhisper') ||
    dirtySet.has('quickDesire') ||
    dirtySet.has('busy') ||
    dirtySet.has('latestDesire') ||
    dirtySet.has('signals') ||
    dirtySet.has('worlds') ||
    dirtySet.has('pinClass') ||
    dirtySet.has('selected') ||
    dirtySet.has('signalClass') ||
    dirtySet.has('worldClass') ||
    dirtySet.has('echoLine') ||
    dirtySet.has('gravityLabel') ||
    dirtySet.has('reactionCount') ||
    dirtySet.has('partnerDesire') ||
    dirtySet.has('partnerSignal') ||
    dirtySet.has('dayClass') ||
    dirtySet.has('simulated') ||
    dirtySet.has('padDay') ||
    dirtySet.has('scouts') ||
    dirtySet.has('scoutStyle') ||
    dirtyRegionSet.has(12)
  ) {
    updateRegion_conditional_44(instance, scope, refs);
  }
  if (
    dirtySet.has('data') ||
    dirtySet.has('active') ||
    dirtySet.has('signals') ||
    dirtySet.has('signalClass') ||
    dirtySet.has('authorName') ||
    dirtySet.has('travelers') ||
    dirtySet.has('worldEchoCount') ||
    dirtySet.has('worlds') ||
    dirtyRegionSet.has(13)
  ) {
    updateRegion_conditional_228(instance, scope, refs);
  }
  if (
    dirtySet.has('data') ||
    dirtySet.has('active') ||
    dirtySet.has('scouts') ||
    dirtySet.has('scoutStyle') ||
    dirtySet.has('sources') ||
    dirtySet.has('sourceClass') ||
    dirtyRegionSet.has(14)
  ) {
    updateRegion_conditional_248(instance, scope, refs);
  }
  if (
    dirtySet.has('data') ||
    dirtySet.has('active') ||
    dirtySet.has('savedTrails') ||
    dirtySet.has('signals') ||
    dirtySet.has('savedDate') ||
    dirtySet.has('story') ||
    dirtySet.has('storyIcon') ||
    dirtyRegionSet.has(15)
  ) {
    updateRegion_conditional_284(instance, scope, refs);
  }
  if (
    dirtySet.has('showSignal') ||
    dirtySet.has('draftKind') ||
    dirtySet.has('draftSignal') ||
    dirtySet.has('busy') ||
    dirtyRegionSet.has(16)
  ) {
    updateRegion_conditional_330(instance, scope, refs);
  }
  if (
    dirtySet.has('showNew') ||
    dirtySet.has('draftOrigin') ||
    dirtySet.has('draftStart') ||
    dirtySet.has('draftEnd') ||
    dirtySet.has('draftSparks') ||
    dirtySet.has('busy') ||
    dirtyRegionSet.has(17)
  ) {
    updateRegion_conditional_348(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  const __records_19 = refs[19] ?? [];
  for (const record of __records_19) {
    if (record.handle && typeof record.handle.destroy === 'function') {
      record.handle.destroy();
    } else if (typeof record.destroy === 'function') {
      record.destroy();
    }
  }
  if (refs[35] === true) {
  } else {
  }
  if (refs[40] === true) {
  } else {
  }
  if (refs[46] === true) {
    const __records_80 = refs[80] ?? [];
    for (const record of __records_80) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_105 = refs[105] ?? [];
    for (const record of __records_105) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_128 = refs[128] ?? [];
    for (const record of __records_128) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_142 = refs[142] ?? [];
    for (const record of __records_142) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_181 = refs[181] ?? [];
    for (const record of __records_181) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_213 = refs[213] ?? [];
    for (const record of __records_213) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
  if (refs[230] === true) {
    const __records_236 = refs[236] ?? [];
    for (const record of __records_236) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
  if (refs[250] === true) {
    const __records_256 = refs[256] ?? [];
    for (const record of __records_256) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_272 = refs[272] ?? [];
    for (const record of __records_272) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
  if (refs[286] === true) {
    const __records_305 = refs[305] ?? [];
    for (const record of __records_305) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_318 = refs[318] ?? [];
    for (const record of __records_318) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
  if (refs[332] === true) {
  } else {
  }
  if (refs[350] === true) {
  } else {
  }
}

export function createInstance(props = {}, eventHandlers = {}, slots = {}) {
  const base = setup(props, eventHandlers);
  const instance = {
    scope: base.scope,
    refresh: base.refresh,
    setProps: base.setProps,
    setEventHandlers: base.setEventHandlers,
    setBoundaryRunner: base.setBoundaryRunner,
    subscribeImportedObservables: base.subscribeImportedObservables,
    slots,
    setSlots: (nextSlots = {}) => {
      instance.slots = nextSlots;
    },
    refs: [],
    destroyed: false,
    update: () => {},
    updateDirty: () => {},
    destroy: () => {},
  };
  instance.setBoundaryRunner((callback) => runOwnedBoundary(instance, callback));
  __weiv_registerTrackedSubscriber(instance);
  return instance;
}

export function mountIntoBoundary(start, end, props = {}, eventHandlers = {}, slots = {}) {
  const instance = createInstance(props, eventHandlers, slots);
  instance.setSlots = (nextSlots = {}) => {
    instance.slots = nextSlots;
  };
  const fragment = createDom(instance);
  replaceBetween(start, end, fragment);
  instance.update = () => updateDom(instance);
  instance.updateDirty = (dirtyBindings, scope) =>
    updateDirtyRegions(instance, dirtyBindings, scope);
  const __weiv_unsubscribeImportedObservables =
    typeof instance.subscribeImportedObservables === 'function'
      ? instance.subscribeImportedObservables(instance)
      : null;
  instance.destroy = () => {
    if (typeof __weiv_unsubscribeImportedObservables === 'function')
      __weiv_unsubscribeImportedObservables();
    __weiv_unregisterTrackedSubscriber(instance);
    instance.destroyed = true;
    destroyDom(instance);
    replaceBetween(start, end, document.createDocumentFragment());
  };
  instance.update();
  return {
    instance,
    update: instance.update,
    destroy: instance.destroy,
    setProps: instance.setProps,
    setEventHandlers: instance.setEventHandlers,
    setSlots: instance.setSlots,
    start,
    end,
  };
}

export function mount(target, props = {}, eventHandlers = {}, slots = {}) {
  const start = document.createComment('root:start');
  const end = document.createComment('root:end');
  target.replaceChildren(start, end);
  return mountIntoBoundary(start, end, props, eventHandlers, slots);
}
