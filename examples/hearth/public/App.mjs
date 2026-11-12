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
function createConditionalFragment_6(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_13 = document.createElement('div');
    refs[13] = __ref_13;
    __ref_13.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_13.setAttribute('class', 'season');
    const __ref_10 = document.createElement('span');
    refs[10] = __ref_10;
    __ref_10.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_9 = document.createTextNode('');
    refs[9] = __ref_9;
    __ref_10.append(__ref_9);
    __ref_10.append(document.createTextNode(' in Wellington'));
    __ref_13.append(__ref_10);
    const __ref_12 = document.createElement('b');
    refs[12] = __ref_12;
    __ref_12.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_11 = document.createTextNode('');
    refs[11] = __ref_11;
    __ref_12.append(__ref_11);
    __ref_13.append(__ref_12);
    fragment.append(__ref_13);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_6(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_6(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.world);
  if (refs[8] !== next) {
    const previous = refs[8];
    destroyConditionalBranch_6(instance, previous === true);
    refs[8] = next;
    replaceBetween(refs[6], refs[7], createConditionalFragment_6(instance, scope, next));
  }
  if (next) {
    updateRegion_text_9(instance, scope, refs);
    updateRegion_text_11(instance, scope, refs);
  } else {
  }
}

function createForEntry_14(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['person']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['person']: currentItem };
    updateRegion_attribute_18_class(instance, loopScope, entryRefs);
    updateRegion_text_17(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_18 = document.createElement('button');
  entryRefs[18] = __ref_18;
  __ref_18.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_18.addEventListener('click', (event) => {
    const resolved = loopScope.chooseViewer(loopScope.person.id);
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_17 = document.createTextNode('');
  entryRefs[17] = __ref_17;
  __ref_18.append(__ref_17);
  fragment.append(__ref_18);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_14(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.participants ?? [];
  const previous = refs[16] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[15]);
    } else {
      record = createForEntry_14(instance, scope, item, refs[15]);
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
  refs[16] = nextRecords;
}

function createConditionalFragment_43(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_47 = document.createElement('div');
    refs[47] = __ref_47;
    __ref_47.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_47.setAttribute('class', 'error');
    __ref_47.setAttribute('role', 'alert');
    const __ref_46 = document.createTextNode('');
    refs[46] = __ref_46;
    __ref_47.append(__ref_46);
    fragment.append(__ref_47);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_43(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_43(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.errorMessage);
  if (refs[45] !== next) {
    const previous = refs[45];
    destroyConditionalBranch_43(instance, previous === true);
    refs[45] = next;
    replaceBetween(refs[43], refs[44], createConditionalFragment_43(instance, scope, next));
  }
  if (next) {
    updateRegion_text_46(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_48(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_54 = document.createElement('div');
    refs[54] = __ref_54;
    __ref_54.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_54.setAttribute('class', 'pulse-result');
    const __ref_51 = document.createElement('b');
    refs[51] = __ref_51;
    __ref_51.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_51.append(document.createTextNode('The hearth answered'));
    __ref_54.append(__ref_51);
    const __ref_53 = document.createElement('span');
    refs[53] = __ref_53;
    __ref_53.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_52 = document.createTextNode('');
    refs[52] = __ref_52;
    __ref_53.append(__ref_52);
    __ref_54.append(__ref_53);
    fragment.append(__ref_54);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_48(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_48(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.pulseResult);
  if (refs[50] !== next) {
    const previous = refs[50];
    destroyConditionalBranch_48(instance, previous === true);
    refs[50] = next;
    replaceBetween(refs[48], refs[49], createConditionalFragment_48(instance, scope, next));
  }
  if (next) {
    updateRegion_text_52(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_55(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_60 = document.createElement('section');
    refs[60] = __ref_60;
    __ref_60.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_60.setAttribute('class', 'loading');
    const __ref_58 = document.createElement('i');
    refs[58] = __ref_58;
    __ref_58.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_60.append(__ref_58);
    const __ref_59 = document.createElement('p');
    refs[59] = __ref_59;
    __ref_59.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_59.append(document.createTextNode('Listening to the house…'));
    __ref_60.append(__ref_59);
    fragment.append(__ref_60);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_55(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_55(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.world);
  if (refs[57] !== next) {
    const previous = refs[57];
    destroyConditionalBranch_55(instance, previous === true);
    refs[57] = next;
    replaceBetween(refs[55], refs[56], createConditionalFragment_55(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_61(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_177 = document.createElement('div');
    refs[177] = __ref_177;
    __ref_177.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_177.setAttribute('class', 'home-view');
    const __ref_89 = document.createElement('section');
    refs[89] = __ref_89;
    __ref_89.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_89.setAttribute('class', 'hearthscape');
    const __ref_72 = document.createElement('div');
    refs[72] = __ref_72;
    __ref_72.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_72.setAttribute('class', 'sky-copy');
    const __ref_64 = document.createElement('small');
    refs[64] = __ref_64;
    __ref_64.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_64.append(document.createTextNode('Read the household weather'));
    __ref_72.append(__ref_64);
    const __ref_66 = document.createElement('h1');
    refs[66] = __ref_66;
    __ref_66.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_65 = document.createTextNode('');
    refs[65] = __ref_65;
    __ref_66.append(__ref_65);
    __ref_72.append(__ref_66);
    const __ref_68 = document.createElement('p');
    refs[68] = __ref_68;
    __ref_68.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_67 = document.createTextNode('');
    refs[67] = __ref_67;
    __ref_68.append(__ref_67);
    __ref_72.append(__ref_68);
    const __ref_69 = document.createElement('button');
    refs[69] = __ref_69;
    __ref_69.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_69.setAttribute('class', 'primary-pulse');
    __ref_69.addEventListener('click', (event) => {
      const resolved = scope.openPulse;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_69.append(document.createTextNode('Place your pulse · 30 seconds'));
    __ref_72.append(__ref_69);
    const __ref_71 = document.createElement('em');
    refs[71] = __ref_71;
    __ref_71.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_70 = document.createTextNode('');
    refs[70] = __ref_70;
    __ref_71.append(__ref_70);
    __ref_71.append(document.createTextNode(' voices are shaping this hearth'));
    __ref_72.append(__ref_71);
    __ref_89.append(__ref_72);
    const __ref_82 = document.createElement('div');
    refs[82] = __ref_82;
    __ref_82.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_82.setAttribute('class', 'living-orbit');
    const __ref_73 = document.createElement('i');
    refs[73] = __ref_73;
    __ref_73.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_73.setAttribute('class', 'ring one');
    __ref_82.append(__ref_73);
    const __ref_74 = document.createElement('i');
    refs[74] = __ref_74;
    __ref_74.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_74.setAttribute('class', 'ring two');
    __ref_82.append(__ref_74);
    const __ref_75 = document.createElement('i');
    refs[75] = __ref_75;
    __ref_75.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_75.setAttribute('class', 'ring three');
    __ref_82.append(__ref_75);
    const __ref_77 = document.createElement('div');
    refs[77] = __ref_77;
    __ref_77.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_77.setAttribute('class', 'ember');
    const __ref_76 = document.createElement('span');
    refs[76] = __ref_76;
    __ref_76.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_77.append(__ref_76);
    __ref_82.append(__ref_77);
    const __ref_78 = document.createElement('div');
    refs[78] = __ref_78;
    __ref_78.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_78.setAttribute('class', 'rain');
    __ref_82.append(__ref_78);
    const __ref_80 = document.createElement('b');
    refs[80] = __ref_80;
    __ref_80.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_79 = document.createTextNode('');
    refs[79] = __ref_79;
    __ref_80.append(__ref_79);
    __ref_82.append(__ref_80);
    const __ref_81 = document.createElement('small');
    refs[81] = __ref_81;
    __ref_81.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_81.append(document.createTextNode('the feeling of home'));
    __ref_82.append(__ref_81);
    __ref_89.append(__ref_82);
    const __ref_88 = document.createElement('div');
    refs[88] = __ref_88;
    __ref_88.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_88.setAttribute('class', 'outside');
    const __ref_84 = document.createElement('span');
    refs[84] = __ref_84;
    __ref_84.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_83 = document.createTextNode('');
    refs[83] = __ref_83;
    __ref_84.append(__ref_83);
    __ref_88.append(__ref_84);
    const __ref_86 = document.createElement('p');
    refs[86] = __ref_86;
    __ref_86.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_85 = document.createTextNode('');
    refs[85] = __ref_85;
    __ref_86.append(__ref_85);
    __ref_88.append(__ref_86);
    const __ref_87 = document.createElement('small');
    refs[87] = __ref_87;
    __ref_87.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_87.append(document.createTextNode('Outside · Open-Meteo'));
    __ref_88.append(__ref_87);
    __ref_89.append(__ref_88);
    __ref_177.append(__ref_89);
    const __ref_107 = document.createElement('section');
    refs[107] = __ref_107;
    __ref_107.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_107.setAttribute('class', 'play-loop');
    __ref_107.setAttribute('aria-label', 'How to take part');
    const __ref_94 = document.createElement('div');
    refs[94] = __ref_94;
    __ref_94.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_90 = document.createElement('b');
    refs[90] = __ref_90;
    __ref_90.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_90.append(document.createTextNode('1'));
    __ref_94.append(__ref_90);
    const __ref_93 = document.createElement('span');
    refs[93] = __ref_93;
    __ref_93.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_91 = document.createElement('strong');
    refs[91] = __ref_91;
    __ref_91.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_91.append(document.createTextNode('Place a pulse'));
    __ref_93.append(__ref_91);
    const __ref_92 = document.createElement('small');
    refs[92] = __ref_92;
    __ref_92.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_92.append(document.createTextNode('Energy, need, hope or atmosphere'));
    __ref_93.append(__ref_92);
    __ref_94.append(__ref_93);
    __ref_107.append(__ref_94);
    const __ref_95 = document.createElement('i');
    refs[95] = __ref_95;
    __ref_95.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_95.append(document.createTextNode('→'));
    __ref_107.append(__ref_95);
    const __ref_100 = document.createElement('div');
    refs[100] = __ref_100;
    __ref_100.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_96 = document.createElement('b');
    refs[96] = __ref_96;
    __ref_96.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_96.append(document.createTextNode('2'));
    __ref_100.append(__ref_96);
    const __ref_99 = document.createElement('span');
    refs[99] = __ref_99;
    __ref_99.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_97 = document.createElement('strong');
    refs[97] = __ref_97;
    __ref_97.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_97.append(document.createTextNode('Notice what changes'));
    __ref_99.append(__ref_97);
    const __ref_98 = document.createElement('small');
    refs[98] = __ref_98;
    __ref_98.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_98.append(document.createTextNode('The shared shape, never private words'));
    __ref_99.append(__ref_98);
    __ref_100.append(__ref_99);
    __ref_107.append(__ref_100);
    const __ref_101 = document.createElement('i');
    refs[101] = __ref_101;
    __ref_101.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_101.append(document.createTextNode('→'));
    __ref_107.append(__ref_101);
    const __ref_106 = document.createElement('div');
    refs[106] = __ref_106;
    __ref_106.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_102 = document.createElement('b');
    refs[102] = __ref_102;
    __ref_102.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_102.append(document.createTextNode('3'));
    __ref_106.append(__ref_102);
    const __ref_105 = document.createElement('span');
    refs[105] = __ref_105;
    __ref_105.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_103 = document.createElement('strong');
    refs[103] = __ref_103;
    __ref_103.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_103.append(document.createTextNode('Shape one small moment'));
    __ref_105.append(__ref_103);
    const __ref_104 = document.createElement('small');
    refs[104] = __ref_104;
    __ref_104.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_104.append(document.createTextNode('Warm, adapt or let a ritual pass'));
    __ref_105.append(__ref_104);
    __ref_106.append(__ref_105);
    __ref_107.append(__ref_106);
    __ref_177.append(__ref_107);
    const __ref_126 = document.createElement('section');
    refs[126] = __ref_126;
    __ref_126.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_126.setAttribute('class', 'perspectives');
    const __ref_112 = document.createElement('div');
    refs[112] = __ref_112;
    __ref_112.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_112.setAttribute('class', 'section-title');
    const __ref_110 = document.createElement('div');
    refs[110] = __ref_110;
    __ref_110.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_108 = document.createElement('small');
    refs[108] = __ref_108;
    __ref_108.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_108.append(document.createTextNode('Household weather'));
    __ref_110.append(__ref_108);
    const __ref_109 = document.createElement('h2');
    refs[109] = __ref_109;
    __ref_109.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_109.append(document.createTextNode('Two days, held together'));
    __ref_110.append(__ref_109);
    __ref_112.append(__ref_110);
    const __ref_111 = document.createElement('p');
    refs[111] = __ref_111;
    __ref_111.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_111.append(document.createTextNode('Difference is information, not a problem to solve.'));
    __ref_112.append(__ref_111);
    __ref_126.append(__ref_112);
    const __ref_125 = document.createElement('div');
    refs[125] = __ref_125;
    __ref_125.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_125.setAttribute('class', 'perspective-row');
    const __ref_113 = document.createComment('for:start');
    const __ref_114 = document.createComment('for:end');
    refs[113] = __ref_113;
    refs[114] = __ref_114;
    refs[115] = [];
    __ref_125.append(__ref_113);
    __ref_125.append(__ref_114);
    __ref_126.append(__ref_125);
    __ref_177.append(__ref_126);
    const __ref_127 = document.createComment('if:start');
    const __ref_128 = document.createComment('if:end');
    refs[127] = __ref_127;
    refs[128] = __ref_128;
    refs[129] = undefined;
    __ref_177.append(__ref_127);
    __ref_177.append(__ref_128);
    const __ref_164 = document.createElement('section');
    refs[164] = __ref_164;
    __ref_164.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_164.setAttribute('class', 'rhythms');
    const __ref_152 = document.createElement('div');
    refs[152] = __ref_152;
    __ref_152.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_152.setAttribute('class', 'section-title');
    const __ref_150 = document.createElement('div');
    refs[150] = __ref_150;
    __ref_150.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_148 = document.createElement('small');
    refs[148] = __ref_148;
    __ref_148.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_148.append(document.createTextNode('Rhythms taking shape'));
    __ref_150.append(__ref_148);
    const __ref_149 = document.createElement('h2');
    refs[149] = __ref_149;
    __ref_149.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_149.append(document.createTextNode('What the house is learning'));
    __ref_150.append(__ref_149);
    __ref_152.append(__ref_150);
    const __ref_151 = document.createElement('p');
    refs[151] = __ref_151;
    __ref_151.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_151.append(document.createTextNode('Patterns stay tentative until life repeats them.'));
    __ref_152.append(__ref_151);
    __ref_164.append(__ref_152);
    const __ref_163 = document.createElement('div');
    refs[163] = __ref_163;
    __ref_163.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_163.setAttribute('class', 'rhythm-grid');
    const __ref_153 = document.createComment('for:start');
    const __ref_154 = document.createComment('for:end');
    refs[153] = __ref_153;
    refs[154] = __ref_154;
    refs[155] = [];
    __ref_163.append(__ref_153);
    __ref_163.append(__ref_154);
    __ref_164.append(__ref_163);
    __ref_177.append(__ref_164);
    const __ref_176 = document.createElement('section');
    refs[176] = __ref_176;
    __ref_176.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_176.setAttribute('class', 'guided-example');
    const __ref_165 = document.createElement('small');
    refs[165] = __ref_165;
    __ref_165.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_165.append(document.createTextNode('Try it together · a privacy-safe example'));
    __ref_176.append(__ref_165);
    const __ref_166 = document.createElement('h2');
    refs[166] = __ref_166;
    __ref_166.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_166.append(document.createTextNode('Two pulses, one small opening'));
    __ref_176.append(__ref_166);
    const __ref_173 = document.createElement('div');
    refs[173] = __ref_173;
    __ref_173.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_168 = document.createElement('p');
    refs[168] = __ref_168;
    __ref_168.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_167 = document.createElement('b');
    refs[167] = __ref_167;
    __ref_167.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_167.append(document.createTextNode('Alex'));
    __ref_168.append(__ref_167);
    __ref_168.append(document.createTextNode(' shares “need: quieter”.'));
    __ref_173.append(__ref_168);
    const __ref_170 = document.createElement('p');
    refs[170] = __ref_170;
    __ref_170.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_169 = document.createElement('b');
    refs[169] = __ref_169;
    __ref_169.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_169.append(document.createTextNode('Sam'));
    __ref_170.append(__ref_169);
    __ref_170.append(document.createTextNode(' shares “hope: a little closeness”.'));
    __ref_173.append(__ref_170);
    const __ref_172 = document.createElement('p');
    refs[172] = __ref_172;
    __ref_172.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_171 = document.createElement('b');
    refs[171] = __ref_171;
    __ref_171.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_171.append(document.createTextNode('Hearth'));
    __ref_172.append(__ref_171);
    __ref_172.append(
      document.createTextNode(
        ' changes the shared weather and offers ten minutes of window tea—without revealing either person’s private note.',
      ),
    );
    __ref_173.append(__ref_172);
    __ref_176.append(__ref_173);
    const __ref_174 = document.createElement('button');
    refs[174] = __ref_174;
    __ref_174.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_174.addEventListener('click', (event) => {
      const resolved = scope.openPulse;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_174.append(document.createTextNode('Place the next pulse'));
    __ref_176.append(__ref_174);
    const __ref_175 = document.createElement('span');
    refs[175] = __ref_175;
    __ref_175.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_175.append(
      document.createTextNode(
        'Return when another voice arrives, the weather turns, or a ritual begins to feel familiar.',
      ),
    );
    __ref_176.append(__ref_175);
    __ref_177.append(__ref_176);
    fragment.append(__ref_177);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_61(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_115 = refs[115] ?? [];
    for (const record of __records_115) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    if (refs[129] === true) {
    } else {
    }
    const __records_155 = refs[155] ?? [];
    for (const record of __records_155) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_61(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.world && scope.active === 'home');
  if (refs[63] !== next) {
    const previous = refs[63];
    destroyConditionalBranch_61(instance, previous === true);
    refs[63] = next;
    replaceBetween(refs[61], refs[62], createConditionalFragment_61(instance, scope, next));
  }
  if (next) {
    updateRegion_text_65(instance, scope, refs);
    updateRegion_text_67(instance, scope, refs);
    updateRegion_text_70(instance, scope, refs);
    updateRegion_text_79(instance, scope, refs);
    updateRegion_text_83(instance, scope, refs);
    updateRegion_text_85(instance, scope, refs);
    updateRegion_loop_113(instance, scope, refs);
    updateRegion_conditional_127(instance, scope, refs);
    updateRegion_loop_153(instance, scope, refs);
  } else {
  }
}

function createForEntry_113(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['perspective']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['perspective']: currentItem };
    updateRegion_attribute_124_class(instance, loopScope, entryRefs);
    updateRegion_text_117(instance, loopScope, entryRefs);
    updateRegion_text_119(instance, loopScope, entryRefs);
    updateRegion_text_122(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_124 = document.createElement('article');
  entryRefs[124] = __ref_124;
  __ref_124.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_116 = document.createElement('i');
  entryRefs[116] = __ref_116;
  __ref_116.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_124.append(__ref_116);
  const __ref_121 = document.createElement('div');
  entryRefs[121] = __ref_121;
  __ref_121.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_118 = document.createElement('b');
  entryRefs[118] = __ref_118;
  __ref_118.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_117 = document.createTextNode('');
  entryRefs[117] = __ref_117;
  __ref_118.append(__ref_117);
  __ref_121.append(__ref_118);
  const __ref_120 = document.createElement('p');
  entryRefs[120] = __ref_120;
  __ref_120.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_119 = document.createTextNode('');
  entryRefs[119] = __ref_119;
  __ref_120.append(__ref_119);
  __ref_121.append(__ref_120);
  __ref_124.append(__ref_121);
  const __ref_123 = document.createElement('span');
  entryRefs[123] = __ref_123;
  __ref_123.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_122 = document.createTextNode('');
  entryRefs[122] = __ref_122;
  __ref_123.append(__ref_122);
  __ref_124.append(__ref_123);
  fragment.append(__ref_124);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_113(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.world.householdWeather.perspectives ?? [];
  const previous = refs[115] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[114]);
    } else {
      record = createForEntry_113(instance, scope, item, refs[114]);
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
  refs[115] = nextRecords;
}

function createConditionalFragment_127(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_147 = document.createElement('section');
    refs[147] = __ref_147;
    __ref_147.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_147.setAttribute('class', 'opening');
    const __ref_130 = document.createElement('div');
    refs[130] = __ref_130;
    __ref_130.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_130.setAttribute('class', 'opening-mark');
    __ref_130.append(document.createTextNode('✦'));
    __ref_147.append(__ref_130);
    const __ref_142 = document.createElement('div');
    refs[142] = __ref_142;
    __ref_142.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_142.setAttribute('class', 'opening-copy');
    const __ref_131 = document.createElement('small');
    refs[131] = __ref_131;
    __ref_131.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_131.append(document.createTextNode('A gentle opening'));
    __ref_142.append(__ref_131);
    const __ref_133 = document.createElement('h2');
    refs[133] = __ref_133;
    __ref_133.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_132 = document.createTextNode('');
    refs[132] = __ref_132;
    __ref_133.append(__ref_132);
    __ref_142.append(__ref_133);
    const __ref_135 = document.createElement('p');
    refs[135] = __ref_135;
    __ref_135.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_134 = document.createTextNode('');
    refs[134] = __ref_134;
    __ref_135.append(__ref_134);
    __ref_142.append(__ref_135);
    const __ref_137 = document.createElement('blockquote');
    refs[137] = __ref_137;
    __ref_137.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_136 = document.createTextNode('');
    refs[136] = __ref_136;
    __ref_137.append(__ref_136);
    __ref_142.append(__ref_137);
    const __ref_141 = document.createElement('details');
    refs[141] = __ref_141;
    __ref_141.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_138 = document.createElement('summary');
    refs[138] = __ref_138;
    __ref_138.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_138.append(document.createTextNode('Why am I seeing this?'));
    __ref_141.append(__ref_138);
    const __ref_140 = document.createElement('p');
    refs[140] = __ref_140;
    __ref_140.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_139 = document.createTextNode('');
    refs[139] = __ref_139;
    __ref_140.append(__ref_139);
    __ref_141.append(__ref_140);
    __ref_142.append(__ref_141);
    __ref_147.append(__ref_142);
    const __ref_146 = document.createElement('div');
    refs[146] = __ref_146;
    __ref_146.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_146.setAttribute('class', 'opening-actions');
    const __ref_143 = document.createElement('button');
    refs[143] = __ref_143;
    __ref_143.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_143.addEventListener('click', (event) => {
      const resolved = scope.dismissOpening;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_143.append(document.createTextNode('Let it pass'));
    __ref_146.append(__ref_143);
    const __ref_144 = document.createElement('button');
    refs[144] = __ref_144;
    __ref_144.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_144.setAttribute('class', 'warm');
    __ref_144.addEventListener('click', (event) => {
      const resolved = scope.keepRitual;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_144.append(document.createTextNode('Warm this into a ritual'));
    __ref_146.append(__ref_144);
    const __ref_145 = document.createElement('small');
    refs[145] = __ref_145;
    __ref_145.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_145.append(document.createTextNode('Nothing becomes a commitment.'));
    __ref_146.append(__ref_145);
    __ref_147.append(__ref_146);
    fragment.append(__ref_147);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_127(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_127(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.world.opening);
  if (refs[129] !== next) {
    const previous = refs[129];
    destroyConditionalBranch_127(instance, previous === true);
    refs[129] = next;
    replaceBetween(refs[127], refs[128], createConditionalFragment_127(instance, scope, next));
  }
  if (next) {
    updateRegion_text_132(instance, scope, refs);
    updateRegion_text_134(instance, scope, refs);
    updateRegion_text_136(instance, scope, refs);
    updateRegion_text_139(instance, scope, refs);
  } else {
  }
}

function createForEntry_153(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['rhythm']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['rhythm']: currentItem };
    updateRegion_text_156(instance, loopScope, entryRefs);
    updateRegion_text_158(instance, loopScope, entryRefs);
    updateRegion_text_160(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_162 = document.createElement('article');
  entryRefs[162] = __ref_162;
  __ref_162.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_157 = document.createElement('span');
  entryRefs[157] = __ref_157;
  __ref_157.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_156 = document.createTextNode('');
  entryRefs[156] = __ref_156;
  __ref_157.append(__ref_156);
  __ref_162.append(__ref_157);
  const __ref_159 = document.createElement('h3');
  entryRefs[159] = __ref_159;
  __ref_159.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_158 = document.createTextNode('');
  entryRefs[158] = __ref_158;
  __ref_159.append(__ref_158);
  __ref_162.append(__ref_159);
  const __ref_161 = document.createElement('p');
  entryRefs[161] = __ref_161;
  __ref_161.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_160 = document.createTextNode('');
  entryRefs[160] = __ref_160;
  __ref_161.append(__ref_160);
  __ref_162.append(__ref_161);
  fragment.append(__ref_162);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_153(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.world.rhythms ?? [];
  const previous = refs[155] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[154]);
    } else {
      record = createForEntry_153(instance, scope, item, refs[154]);
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
  refs[155] = nextRecords;
}

function createConditionalFragment_178(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_208 = document.createElement('div');
    refs[208] = __ref_208;
    __ref_208.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_208.setAttribute('class', 'garden-view');
    const __ref_184 = document.createElement('div');
    refs[184] = __ref_184;
    __ref_184.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_184.setAttribute('class', 'page-intro');
    const __ref_181 = document.createElement('small');
    refs[181] = __ref_181;
    __ref_181.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_181.append(document.createTextNode('Seasonal memory garden'));
    __ref_184.append(__ref_181);
    const __ref_182 = document.createElement('h1');
    refs[182] = __ref_182;
    __ref_182.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_182.append(document.createTextNode('The life that has gathered here.'));
    __ref_184.append(__ref_182);
    const __ref_183 = document.createElement('p');
    refs[183] = __ref_183;
    __ref_183.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_183.append(
      document.createTextNode(
        'Shared memories grow in the common garden. Private ones appear only through the lens that holds them.',
      ),
    );
    __ref_184.append(__ref_183);
    __ref_208.append(__ref_184);
    const __ref_207 = document.createElement('section');
    refs[207] = __ref_207;
    __ref_207.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_207.setAttribute('class', 'garden');
    const __ref_185 = document.createElement('div');
    refs[185] = __ref_185;
    __ref_185.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_185.setAttribute('class', 'garden-glow');
    __ref_207.append(__ref_185);
    const __ref_186 = document.createElement('div');
    refs[186] = __ref_186;
    __ref_186.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_186.setAttribute('class', 'ground');
    __ref_207.append(__ref_186);
    const __ref_187 = document.createComment('for:start');
    const __ref_188 = document.createComment('for:end');
    refs[187] = __ref_187;
    refs[188] = __ref_188;
    refs[189] = [];
    __ref_207.append(__ref_187);
    __ref_207.append(__ref_188);
    const __ref_194 = document.createComment('if:start');
    const __ref_195 = document.createComment('if:end');
    refs[194] = __ref_194;
    refs[195] = __ref_195;
    refs[196] = undefined;
    __ref_207.append(__ref_194);
    __ref_207.append(__ref_195);
    const __ref_206 = document.createElement('p');
    refs[206] = __ref_206;
    __ref_206.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_206.setAttribute('class', 'garden-caption');
    __ref_206.append(
      document.createTextNode(
        'Memories stay memories. They change the texture of what Hearth notices next.',
      ),
    );
    __ref_207.append(__ref_206);
    __ref_208.append(__ref_207);
    fragment.append(__ref_208);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_178(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_189 = refs[189] ?? [];
    for (const record of __records_189) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    if (refs[196] === true) {
    } else {
    }
  } else {
  }
}

function updateConditional_178(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.world && scope.active === 'garden');
  if (refs[180] !== next) {
    const previous = refs[180];
    destroyConditionalBranch_178(instance, previous === true);
    refs[180] = next;
    replaceBetween(refs[178], refs[179], createConditionalFragment_178(instance, scope, next));
  }
  if (next) {
    updateRegion_loop_187(instance, scope, refs);
    updateRegion_conditional_194(instance, scope, refs);
  } else {
  }
}

function createForEntry_187(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['bloom']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['bloom']: currentItem };
    updateRegion_attribute_193_class(instance, loopScope, entryRefs);
    updateRegion_text_191(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_193 = document.createElement('button');
  entryRefs[193] = __ref_193;
  __ref_193.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_193.setAttribute('aria-label', 'Memory bloom');
  __ref_193.addEventListener('click', (event) => {
    const resolved = loopScope.selectBloom(loopScope.bloom.id);
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_190 = document.createElement('i');
  entryRefs[190] = __ref_190;
  __ref_190.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_193.append(__ref_190);
  const __ref_192 = document.createElement('span');
  entryRefs[192] = __ref_192;
  __ref_192.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_191 = document.createTextNode('');
  entryRefs[191] = __ref_191;
  __ref_192.append(__ref_191);
  __ref_193.append(__ref_192);
  fragment.append(__ref_193);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_187(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.world.blooms ?? [];
  const previous = refs[189] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[188]);
    } else {
      record = createForEntry_187(instance, scope, item, refs[188]);
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
  refs[189] = nextRecords;
}

function createConditionalFragment_194(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_205 = document.createElement('article');
    refs[205] = __ref_205;
    __ref_205.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_205.setAttribute('class', 'memory-card');
    const __ref_198 = document.createElement('small');
    refs[198] = __ref_198;
    __ref_198.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_197 = document.createTextNode('');
    refs[197] = __ref_197;
    __ref_198.append(__ref_197);
    __ref_205.append(__ref_198);
    const __ref_200 = document.createElement('h2');
    refs[200] = __ref_200;
    __ref_200.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_199 = document.createTextNode('');
    refs[199] = __ref_199;
    __ref_200.append(__ref_199);
    __ref_205.append(__ref_200);
    const __ref_202 = document.createElement('p');
    refs[202] = __ref_202;
    __ref_202.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_201 = document.createTextNode('');
    refs[201] = __ref_201;
    __ref_202.append(__ref_201);
    __ref_205.append(__ref_202);
    const __ref_204 = document.createElement('span');
    refs[204] = __ref_204;
    __ref_204.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_203 = document.createTextNode('');
    refs[203] = __ref_203;
    __ref_204.append(__ref_203);
    __ref_205.append(__ref_204);
    fragment.append(__ref_205);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_194(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_194(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.selectedBloom);
  if (refs[196] !== next) {
    const previous = refs[196];
    destroyConditionalBranch_194(instance, previous === true);
    refs[196] = next;
    replaceBetween(refs[194], refs[195], createConditionalFragment_194(instance, scope, next));
  }
  if (next) {
    updateRegion_text_197(instance, scope, refs);
    updateRegion_text_199(instance, scope, refs);
    updateRegion_text_201(instance, scope, refs);
    updateRegion_text_203(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_209(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_231 = document.createElement('div');
    refs[231] = __ref_231;
    __ref_231.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_231.setAttribute('class', 'ritual-view');
    const __ref_215 = document.createElement('div');
    refs[215] = __ref_215;
    __ref_215.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_215.setAttribute('class', 'page-intro');
    const __ref_212 = document.createElement('small');
    refs[212] = __ref_212;
    __ref_212.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_212.append(document.createTextNode('Rituals'));
    __ref_215.append(__ref_212);
    const __ref_213 = document.createElement('h1');
    refs[213] = __ref_213;
    __ref_213.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_213.append(document.createTextNode('Small shapes that make this home ours.'));
    __ref_215.append(__ref_213);
    const __ref_214 = document.createElement('p');
    refs[214] = __ref_214;
    __ref_214.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_214.append(
      document.createTextNode(
        'Kept because they feel meaningful—not because anyone has to complete them.',
      ),
    );
    __ref_215.append(__ref_214);
    __ref_231.append(__ref_215);
    const __ref_230 = document.createElement('section');
    refs[230] = __ref_230;
    __ref_230.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_230.setAttribute('class', 'ritual-list');
    const __ref_216 = document.createComment('for:start');
    const __ref_217 = document.createComment('for:end');
    refs[216] = __ref_216;
    refs[217] = __ref_217;
    refs[218] = [];
    __ref_230.append(__ref_216);
    __ref_230.append(__ref_217);
    __ref_231.append(__ref_230);
    fragment.append(__ref_231);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_209(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_218 = refs[218] ?? [];
    for (const record of __records_218) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_209(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.world && scope.active === 'rituals');
  if (refs[211] !== next) {
    const previous = refs[211];
    destroyConditionalBranch_209(instance, previous === true);
    refs[211] = next;
    replaceBetween(refs[209], refs[210], createConditionalFragment_209(instance, scope, next));
  }
  if (next) {
    updateRegion_loop_216(instance, scope, refs);
  } else {
  }
}

function createForEntry_216(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['ritual']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['ritual']: currentItem };
    updateRegion_text_220(instance, loopScope, entryRefs);
    updateRegion_text_222(instance, loopScope, entryRefs);
    updateRegion_text_224(instance, loopScope, entryRefs);
    updateRegion_text_227(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_229 = document.createElement('article');
  entryRefs[229] = __ref_229;
  __ref_229.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_219 = document.createElement('div');
  entryRefs[219] = __ref_219;
  __ref_219.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_219.setAttribute('class', 'ritual-symbol');
  __ref_219.append(document.createTextNode('◌'));
  __ref_229.append(__ref_219);
  const __ref_226 = document.createElement('div');
  entryRefs[226] = __ref_226;
  __ref_226.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_221 = document.createElement('small');
  entryRefs[221] = __ref_221;
  __ref_221.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_220 = document.createTextNode('');
  entryRefs[220] = __ref_220;
  __ref_221.append(__ref_220);
  __ref_226.append(__ref_221);
  const __ref_223 = document.createElement('h2');
  entryRefs[223] = __ref_223;
  __ref_223.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_222 = document.createTextNode('');
  entryRefs[222] = __ref_222;
  __ref_223.append(__ref_222);
  __ref_226.append(__ref_223);
  const __ref_225 = document.createElement('p');
  entryRefs[225] = __ref_225;
  __ref_225.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_224 = document.createTextNode('');
  entryRefs[224] = __ref_224;
  __ref_225.append(__ref_224);
  __ref_226.append(__ref_225);
  __ref_229.append(__ref_226);
  const __ref_228 = document.createElement('span');
  entryRefs[228] = __ref_228;
  __ref_228.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_228.append(document.createTextNode('kept by '));
  const __ref_227 = document.createTextNode('');
  entryRefs[227] = __ref_227;
  __ref_228.append(__ref_227);
  __ref_229.append(__ref_228);
  fragment.append(__ref_229);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_216(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.world.rituals ?? [];
  const previous = refs[218] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[217]);
    } else {
      record = createForEntry_216(instance, scope, item, refs[217]);
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
  refs[218] = nextRecords;
}

function createConditionalFragment_232(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_271 = document.createElement('div');
    refs[271] = __ref_271;
    __ref_271.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_271.setAttribute('class', 'how-view');
    const __ref_239 = document.createElement('div');
    refs[239] = __ref_239;
    __ref_239.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_239.setAttribute('class', 'page-intro');
    const __ref_235 = document.createElement('small');
    refs[235] = __ref_235;
    __ref_235.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_235.append(document.createTextNode('How Hearth listens'));
    __ref_239.append(__ref_235);
    const __ref_237 = document.createElement('h1');
    refs[237] = __ref_237;
    __ref_237.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_237.append(document.createTextNode('Close enough to care.'));
    const __ref_236 = document.createElement('br');
    refs[236] = __ref_236;
    __ref_236.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_237.append(__ref_236);
    __ref_237.append(document.createTextNode('Quiet enough to trust.'));
    __ref_239.append(__ref_237);
    const __ref_238 = document.createElement('p');
    refs[238] = __ref_238;
    __ref_238.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_238.append(
      document.createTextNode(
        'Hearth keeps the household’s memory without turning private life into a feed, score, or optimisation problem.',
      ),
    );
    __ref_239.append(__ref_238);
    __ref_271.append(__ref_239);
    const __ref_256 = document.createElement('section');
    refs[256] = __ref_256;
    __ref_256.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_256.setAttribute('class', 'principles');
    const __ref_243 = document.createElement('article');
    refs[243] = __ref_243;
    __ref_243.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_240 = document.createElement('b');
    refs[240] = __ref_240;
    __ref_240.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_240.append(document.createTextNode('01'));
    __ref_243.append(__ref_240);
    const __ref_241 = document.createElement('h3');
    refs[241] = __ref_241;
    __ref_241.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_241.append(document.createTextNode('You choose the boundary'));
    __ref_243.append(__ref_241);
    const __ref_242 = document.createElement('p');
    refs[242] = __ref_242;
    __ref_242.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_242.append(
      document.createTextNode(
        'Every trace is private or shared when it is given. Private words never appear in another person’s lens.',
      ),
    );
    __ref_243.append(__ref_242);
    __ref_256.append(__ref_243);
    const __ref_247 = document.createElement('article');
    refs[247] = __ref_247;
    __ref_247.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_244 = document.createElement('b');
    refs[244] = __ref_244;
    __ref_244.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_244.append(document.createTextNode('02'));
    __ref_247.append(__ref_244);
    const __ref_245 = document.createElement('h3');
    refs[245] = __ref_245;
    __ref_245.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_245.append(document.createTextNode('Suggestions explain themselves'));
    __ref_247.append(__ref_245);
    const __ref_246 = document.createElement('p');
    refs[246] = __ref_246;
    __ref_246.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_246.append(
      document.createTextNode(
        'Every opening can say what it noticed, whose information it used, and why now.',
      ),
    );
    __ref_247.append(__ref_246);
    __ref_256.append(__ref_247);
    const __ref_251 = document.createElement('article');
    refs[251] = __ref_251;
    __ref_251.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_248 = document.createElement('b');
    refs[248] = __ref_248;
    __ref_248.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_248.append(document.createTextNode('03'));
    __ref_251.append(__ref_248);
    const __ref_249 = document.createElement('h3');
    refs[249] = __ref_249;
    __ref_249.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_249.append(document.createTextNode('Patterns remain humble'));
    __ref_251.append(__ref_249);
    const __ref_250 = document.createElement('p');
    refs[250] = __ref_250;
    __ref_250.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_250.append(
      document.createTextNode(
        'Hearth distinguishes a forming rhythm from a familiar one. It does not diagnose people or infer hidden motives.',
      ),
    );
    __ref_251.append(__ref_250);
    __ref_256.append(__ref_251);
    const __ref_255 = document.createElement('article');
    refs[255] = __ref_255;
    __ref_255.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_252 = document.createElement('b');
    refs[252] = __ref_252;
    __ref_252.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_252.append(document.createTextNode('04'));
    __ref_255.append(__ref_252);
    const __ref_253 = document.createElement('h3');
    refs[253] = __ref_253;
    __ref_253.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_253.append(document.createTextNode('The home survives absence'));
    __ref_255.append(__ref_253);
    const __ref_254 = document.createElement('p');
    refs[254] = __ref_254;
    __ref_254.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_254.append(
      document.createTextNode(
        'Observations and perspectives are durable. Returning later does not reset the household’s story.',
      ),
    );
    __ref_255.append(__ref_254);
    __ref_256.append(__ref_255);
    __ref_271.append(__ref_256);
    const __ref_270 = document.createElement('section');
    refs[270] = __ref_270;
    __ref_270.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_270.setAttribute('class', 'sources');
    const __ref_257 = document.createElement('h2');
    refs[257] = __ref_257;
    __ref_257.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_257.append(document.createTextNode('What shaped this view'));
    __ref_270.append(__ref_257);
    const __ref_258 = document.createComment('for:start');
    const __ref_259 = document.createComment('for:end');
    refs[258] = __ref_258;
    refs[259] = __ref_259;
    refs[260] = [];
    __ref_270.append(__ref_258);
    __ref_270.append(__ref_259);
    const __ref_269 = document.createElement('small');
    refs[269] = __ref_269;
    __ref_269.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_269.append(document.createTextNode('Last quietly observed '));
    const __ref_268 = document.createTextNode('');
    refs[268] = __ref_268;
    __ref_269.append(__ref_268);
    __ref_270.append(__ref_269);
    __ref_271.append(__ref_270);
    fragment.append(__ref_271);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_232(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_260 = refs[260] ?? [];
    for (const record of __records_260) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_232(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.world && scope.active === 'how');
  if (refs[234] !== next) {
    const previous = refs[234];
    destroyConditionalBranch_232(instance, previous === true);
    refs[234] = next;
    replaceBetween(refs[232], refs[233], createConditionalFragment_232(instance, scope, next));
  }
  if (next) {
    updateRegion_loop_258(instance, scope, refs);
    updateRegion_text_268(instance, scope, refs);
  } else {
  }
}

function createForEntry_258(instance, scope, item, reference) {
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
    updateRegion_text_262(instance, loopScope, entryRefs);
    updateRegion_text_264(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_267 = document.createElement('article');
  entryRefs[267] = __ref_267;
  __ref_267.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_261 = document.createElement('i');
  entryRefs[261] = __ref_261;
  __ref_261.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_267.append(__ref_261);
  const __ref_266 = document.createElement('div');
  entryRefs[266] = __ref_266;
  __ref_266.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_263 = document.createElement('b');
  entryRefs[263] = __ref_263;
  __ref_263.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_262 = document.createTextNode('');
  entryRefs[262] = __ref_262;
  __ref_263.append(__ref_262);
  __ref_266.append(__ref_263);
  const __ref_265 = document.createElement('p');
  entryRefs[265] = __ref_265;
  __ref_265.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_264 = document.createTextNode('');
  entryRefs[264] = __ref_264;
  __ref_265.append(__ref_264);
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

function updateForLoop_258(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.world.provenance.sources ?? [];
  const previous = refs[260] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[259]);
    } else {
      record = createForEntry_258(instance, scope, item, refs[259]);
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
  refs[260] = nextRecords;
}

function createConditionalFragment_273(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_318 = document.createElement('div');
    refs[318] = __ref_318;
    __ref_318.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_318.setAttribute('class', 'modal-layer');
    __ref_318.addEventListener('click', (event) => {
      const resolved = scope.closeFromBackdrop;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_317 = document.createElement('section');
    refs[317] = __ref_317;
    __ref_317.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_317.setAttribute('class', 'trace-card');
    __ref_317.setAttribute('role', 'dialog');
    __ref_317.setAttribute('aria-modal', 'true');
    __ref_317.setAttribute('aria-labelledby', 'trace-title');
    const __ref_276 = document.createElement('button');
    refs[276] = __ref_276;
    __ref_276.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_276.setAttribute('class', 'close');
    __ref_276.setAttribute('aria-label', 'Close');
    __ref_276.addEventListener('click', (event) => {
      const resolved = scope.closeTrace;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_276.append(document.createTextNode('×'));
    __ref_317.append(__ref_276);
    const __ref_277 = document.createElement('small');
    refs[277] = __ref_277;
    __ref_277.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_277.append(document.createTextNode('Step 1 of the shared loop'));
    __ref_317.append(__ref_277);
    const __ref_278 = document.createElement('h2');
    refs[278] = __ref_278;
    __ref_278.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_278.setAttribute('id', 'trace-title');
    __ref_278.append(document.createTextNode('Place your pulse'));
    __ref_317.append(__ref_278);
    const __ref_279 = document.createElement('p');
    refs[279] = __ref_279;
    __ref_279.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_279.append(
      document.createTextNode(
        'Choose a starting point, then decide who can hold it. One tap is enough.',
      ),
    );
    __ref_317.append(__ref_279);
    const __ref_294 = document.createElement('div');
    refs[294] = __ref_294;
    __ref_294.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_294.setAttribute('class', 'pulse-field');
    const __ref_280 = document.createElement('span');
    refs[280] = __ref_280;
    __ref_280.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_280.setAttribute('class', 'field-label');
    __ref_280.append(document.createTextNode('What are you bringing?'));
    __ref_294.append(__ref_280);
    const __ref_293 = document.createElement('div');
    refs[293] = __ref_293;
    __ref_293.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_293.setAttribute('class', 'pulse-picker');
    const __ref_283 = document.createElement('button');
    refs[283] = __ref_283;
    __ref_283.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_283.addEventListener('click', (event) => {
      const resolved = scope.chooseNeed;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_281 = document.createElement('b');
    refs[281] = __ref_281;
    __ref_281.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_281.append(document.createTextNode('Need'));
    __ref_283.append(__ref_281);
    const __ref_282 = document.createElement('span');
    refs[282] = __ref_282;
    __ref_282.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_282.append(document.createTextNode('a little quiet'));
    __ref_283.append(__ref_282);
    __ref_293.append(__ref_283);
    const __ref_286 = document.createElement('button');
    refs[286] = __ref_286;
    __ref_286.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_286.addEventListener('click', (event) => {
      const resolved = scope.chooseHope;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_284 = document.createElement('b');
    refs[284] = __ref_284;
    __ref_284.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_284.append(document.createTextNode('Hope'));
    __ref_286.append(__ref_284);
    const __ref_285 = document.createElement('span');
    refs[285] = __ref_285;
    __ref_285.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_285.append(document.createTextNode('some closeness'));
    __ref_286.append(__ref_285);
    __ref_293.append(__ref_286);
    const __ref_289 = document.createElement('button');
    refs[289] = __ref_289;
    __ref_289.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_289.addEventListener('click', (event) => {
      const resolved = scope.chooseWarmth;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_287 = document.createElement('b');
    refs[287] = __ref_287;
    __ref_287.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_287.append(document.createTextNode('Atmosphere'));
    __ref_289.append(__ref_287);
    const __ref_288 = document.createElement('span');
    refs[288] = __ref_288;
    __ref_288.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_288.append(document.createTextNode('bringing warmth'));
    __ref_289.append(__ref_288);
    __ref_293.append(__ref_289);
    const __ref_292 = document.createElement('button');
    refs[292] = __ref_292;
    __ref_292.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_292.addEventListener('click', (event) => {
      const resolved = scope.chooseSpace;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_290 = document.createElement('b');
    refs[290] = __ref_290;
    __ref_290.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_290.append(document.createTextNode('Space'));
    __ref_292.append(__ref_290);
    const __ref_291 = document.createElement('span');
    refs[291] = __ref_291;
    __ref_291.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_291.append(document.createTextNode('room to exhale'));
    __ref_292.append(__ref_291);
    __ref_293.append(__ref_292);
    __ref_294.append(__ref_293);
    __ref_317.append(__ref_294);
    const __ref_302 = document.createElement('div');
    refs[302] = __ref_302;
    __ref_302.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_302.setAttribute('class', 'pulse-field');
    const __ref_295 = document.createElement('span');
    refs[295] = __ref_295;
    __ref_295.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_295.setAttribute('class', 'field-label');
    __ref_295.append(document.createTextNode('Energy'));
    __ref_302.append(__ref_295);
    const __ref_301 = document.createElement('div');
    refs[301] = __ref_301;
    __ref_301.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_301.setAttribute('class', 'energy-picker');
    const __ref_296 = document.createElement('button');
    refs[296] = __ref_296;
    __ref_296.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_296.addEventListener('click', (event) => {
      const resolved = scope.chooseEnergy1;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_296.append(document.createTextNode('1'));
    __ref_301.append(__ref_296);
    const __ref_297 = document.createElement('button');
    refs[297] = __ref_297;
    __ref_297.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_297.addEventListener('click', (event) => {
      const resolved = scope.chooseEnergy2;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_297.append(document.createTextNode('2'));
    __ref_301.append(__ref_297);
    const __ref_298 = document.createElement('button');
    refs[298] = __ref_298;
    __ref_298.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_298.addEventListener('click', (event) => {
      const resolved = scope.chooseEnergy3;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_298.append(document.createTextNode('3'));
    __ref_301.append(__ref_298);
    const __ref_299 = document.createElement('button');
    refs[299] = __ref_299;
    __ref_299.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_299.addEventListener('click', (event) => {
      const resolved = scope.chooseEnergy4;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_299.append(document.createTextNode('4'));
    __ref_301.append(__ref_299);
    const __ref_300 = document.createElement('button');
    refs[300] = __ref_300;
    __ref_300.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_300.addEventListener('click', (event) => {
      const resolved = scope.chooseEnergy5;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_300.append(document.createTextNode('5'));
    __ref_301.append(__ref_300);
    __ref_302.append(__ref_301);
    __ref_317.append(__ref_302);
    const __ref_304 = document.createElement('label');
    refs[304] = __ref_304;
    __ref_304.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_304.append(document.createTextNode('Your words, if you want'));
    const __ref_303 = document.createElement('input');
    refs[303] = __ref_303;
    __ref_303.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_303.setAttribute('maxlength', '40');
    __ref_303.setAttribute('placeholder', 'Choose above or write your own');
    __ref_303.addEventListener('input', (event) => {
      const resolved = scope.updateFeeling;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_304.append(__ref_303);
    __ref_317.append(__ref_304);
    const __ref_306 = document.createElement('label');
    refs[306] = __ref_306;
    __ref_306.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_306.append(document.createTextNode('Anything else, if you want'));
    const __ref_305 = document.createElement('textarea');
    refs[305] = __ref_305;
    __ref_305.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_305.setAttribute('maxlength', '280');
    __ref_305.setAttribute('placeholder', 'A sentence the house can hold for you');
    __ref_305.addEventListener('input', (event) => {
      const resolved = scope.updateNote;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_306.append(__ref_305);
    __ref_317.append(__ref_306);
    const __ref_314 = document.createElement('fieldset');
    refs[314] = __ref_314;
    __ref_314.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    const __ref_307 = document.createElement('legend');
    refs[307] = __ref_307;
    __ref_307.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_307.append(document.createTextNode('Who can hold this?'));
    __ref_314.append(__ref_307);
    const __ref_310 = document.createElement('button');
    refs[310] = __ref_310;
    __ref_310.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_310.addEventListener('click', (event) => {
      const resolved = scope.chooseVisibility('private');
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_308 = document.createElement('b');
    refs[308] = __ref_308;
    __ref_308.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_308.append(document.createTextNode('Just me'));
    __ref_310.append(__ref_308);
    const __ref_309 = document.createElement('span');
    refs[309] = __ref_309;
    __ref_309.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_309.append(document.createTextNode('Shapes only my view'));
    __ref_310.append(__ref_309);
    __ref_314.append(__ref_310);
    const __ref_313 = document.createElement('button');
    refs[313] = __ref_313;
    __ref_313.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_313.addEventListener('click', (event) => {
      const resolved = scope.chooseVisibility('shared');
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_311 = document.createElement('b');
    refs[311] = __ref_311;
    __ref_311.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_311.append(document.createTextNode('Our household'));
    __ref_313.append(__ref_311);
    const __ref_312 = document.createElement('span');
    refs[312] = __ref_312;
    __ref_312.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_312.append(document.createTextNode('Can shape the shared weather'));
    __ref_313.append(__ref_312);
    __ref_314.append(__ref_313);
    __ref_317.append(__ref_314);
    const __ref_316 = document.createElement('button');
    refs[316] = __ref_316;
    __ref_316.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
    __ref_316.setAttribute('class', 'save');
    __ref_316.addEventListener('click', (event) => {
      const resolved = scope.saveTrace;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_315 = document.createTextNode('');
    refs[315] = __ref_315;
    __ref_316.append(__ref_315);
    __ref_317.append(__ref_316);
    __ref_318.append(__ref_317);
    fragment.append(__ref_318);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_273(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_273(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.showTrace);
  if (refs[275] !== next) {
    const previous = refs[275];
    destroyConditionalBranch_273(instance, previous === true);
    refs[275] = next;
    replaceBetween(refs[273], refs[274], createConditionalFragment_273(instance, scope, next));
  }
  if (next) {
    updateRegion_attribute_283_class(instance, scope, refs);
    updateRegion_attribute_286_class(instance, scope, refs);
    updateRegion_attribute_289_class(instance, scope, refs);
    updateRegion_attribute_292_class(instance, scope, refs);
    updateRegion_attribute_296_class(instance, scope, refs);
    updateRegion_attribute_297_class(instance, scope, refs);
    updateRegion_attribute_298_class(instance, scope, refs);
    updateRegion_attribute_299_class(instance, scope, refs);
    updateRegion_attribute_300_class(instance, scope, refs);
    updateRegion_attribute_303_value(instance, scope, refs);
    updateRegion_attribute_305_value(instance, scope, refs);
    updateRegion_attribute_310_class(instance, scope, refs);
    updateRegion_attribute_313_class(instance, scope, refs);
    updateRegion_attribute_316_disabled(instance, scope, refs);
    updateRegion_text_315(instance, scope, refs);
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
  let world = null;
  let participants = [];
  let viewer = 'alex';
  let active = 'home';
  let initialized = false;
  let busy = false;
  let errorMessage = '';
  let pulseResult = '';
  let showTrace = false;
  let draftEnergy = 3;
  let draftFeeling = '';
  let draftNote = '';
  let draftVisibility = 'private';
  let selectedBloom = null;
  function boot() {
    if (!initialized && typeof window !== 'undefined') {
      initialized = true;
      queueMicrotask(load);
      window.setInterval(() => {
        if (!busy && !showTrace) load();
      }, 5e3);
    }
    return '';
  }
  async function api(path, body) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'x-hearth-token': props.token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Hearth could not listen just now');
    return value;
  }
  function apply(next) {
    data = next;
    participants = next.participants || [];
    world = next.world;
    if (selectedBloom && world)
      selectedBloom = world.blooms.find((item) => item.id === selectedBloom.id) || null;
    errorMessage = '';
  }
  async function load(requestedViewer) {
    try {
      const next = await api('/api/state?viewer=' + (requestedViewer || viewer));
      queueMicrotask(() => apply(next));
    } catch (error) {
      queueMicrotask(() => {
        errorMessage = error instanceof Error ? error.message : 'Hearth could not listen just now';
      });
    }
  }
  function viewerName() {
    const person = participants.find((item) => item.id === viewer);
    return person ? person.name : 'Your';
  }
  function chooseViewer(id) {
    viewer = id;
    world = null;
    selectedBloom = null;
    void load(id);
  }
  function personClass(id) {
    return 'person ' + (id === viewer ? 'active' : '');
  }
  function navClass(name) {
    return name === active ? 'active' : '';
  }
  function showHome() {
    active = 'home';
  }
  function showGarden() {
    active = 'garden';
  }
  function showRituals() {
    active = 'rituals';
  }
  function showHow() {
    active = 'how';
  }
  function energyWord() {
    if (!world) return 'listening';
    const n = world.householdWeather.energy;
    return n < 2.5 ? 'low tide' : n > 3.8 ? 'bright current' : 'held weather';
  }
  function openPulse() {
    draftEnergy = 3;
    draftFeeling = '';
    draftNote = '';
    draftVisibility = 'shared';
    showTrace = true;
  }
  function closeTrace() {
    showTrace = false;
  }
  function closeFromBackdrop(event) {
    if (event.target === event.currentTarget) closeTrace();
  }
  function chooseEnergy1() {
    draftEnergy = 1;
  }
  function chooseEnergy2() {
    draftEnergy = 2;
  }
  function chooseEnergy3() {
    draftEnergy = 3;
  }
  function chooseEnergy4() {
    draftEnergy = 4;
  }
  function chooseEnergy5() {
    draftEnergy = 5;
  }
  function energyClass(level) {
    return level === draftEnergy ? 'active' : '';
  }
  function chooseNeed() {
    draftFeeling = 'need: a little quiet';
  }
  function chooseHope() {
    draftFeeling = 'hope: some closeness';
  }
  function chooseWarmth() {
    draftFeeling = 'bringing warmth';
  }
  function chooseSpace() {
    draftFeeling = 'need: room to exhale';
  }
  function pulseClass(feeling) {
    return feeling === draftFeeling ? 'active' : '';
  }
  function updateFeeling(event) {
    draftFeeling = event.currentTarget.value;
  }
  function updateNote(event) {
    draftNote = event.currentTarget.value;
  }
  function chooseVisibility(value) {
    draftVisibility = value;
  }
  function visibilityClass(value) {
    return value === draftVisibility ? 'active' : '';
  }
  async function refreshAfterPulse(id) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const next = await api('/api/state?viewer=' + id);
      if (next.world) {
        queueMicrotask(() => apply(next));
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
  }
  async function saveTrace() {
    if (busy || !draftFeeling) return;
    busy = true;
    const boundary = draftVisibility;
    try {
      await api('/api/check-in', {
        viewer,
        energy: draftEnergy,
        feeling: draftFeeling,
        note: draftNote,
        visibility: boundary,
      });
      showTrace = false;
      pulseResult =
        boundary === 'private'
          ? 'Only your lens shifted. No words or signal crossed the household boundary.'
          : 'Your pulse joined the shared shape. The ember and household weather are listening.';
      busy = false;
      void refreshAfterPulse(viewer);
    } catch (error) {
      queueMicrotask(() => {
        busy = false;
        errorMessage = error instanceof Error ? error.message : 'Could not hold this pulse';
      });
    }
  }
  async function keepRitual() {
    if (!world.opening || busy) return;
    busy = true;
    try {
      await api('/api/ritual', {
        viewer,
        openingId: world.opening.id,
      });
      const next = await api('/api/state?viewer=' + viewer);
      queueMicrotask(() => {
        apply(next);
        busy = false;
        active = 'rituals';
      });
    } catch (error) {
      queueMicrotask(() => {
        busy = false;
        errorMessage = error instanceof Error ? error.message : 'Could not keep this ritual';
      });
    }
  }
  async function dismissOpening() {
    if (!world.opening || busy) return;
    busy = true;
    try {
      await api('/api/dismiss', {
        viewer,
        openingId: world.opening.id,
      });
      const next = await api('/api/state?viewer=' + viewer);
      queueMicrotask(() => {
        apply(next);
        busy = false;
      });
    } catch (error) {
      queueMicrotask(() => {
        busy = false;
      });
    }
  }
  function bloomClass(bloom) {
    return (
      'bloom ' +
      bloom.id +
      ' ' +
      bloom.tone +
      (bloom.private ? ' private' : '') +
      (selectedBloom && selectedBloom.id === bloom.id ? ' selected' : '')
    );
  }
  function selectBloom(id) {
    selectedBloom = world.blooms.find((item) => item.id === id) || null;
  }
  function observedLabel() {
    return world
      ? new Date(world.provenance.observedAt).toLocaleString('en-NZ', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '';
  }
  props = __weiv_getTrackedRoot('props', props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    __weiv_scope.data = data;
    __weiv_scope.world = world;
    __weiv_scope.participants = participants;
    __weiv_scope.viewer = viewer;
    __weiv_scope.active = active;
    __weiv_scope.initialized = initialized;
    __weiv_scope.busy = busy;
    __weiv_scope.errorMessage = errorMessage;
    __weiv_scope.pulseResult = pulseResult;
    __weiv_scope.showTrace = showTrace;
    __weiv_scope.draftEnergy = draftEnergy;
    __weiv_scope.draftFeeling = draftFeeling;
    __weiv_scope.draftNote = draftNote;
    __weiv_scope.draftVisibility = draftVisibility;
    __weiv_scope.selectedBloom = selectedBloom;
    __weiv_scope.boot = boot;
    __weiv_scope.api = api;
    __weiv_scope.apply = apply;
    __weiv_scope.load = load;
    __weiv_scope.viewerName = viewerName;
    __weiv_scope.chooseViewer = chooseViewer;
    __weiv_scope.personClass = personClass;
    __weiv_scope.navClass = navClass;
    __weiv_scope.showHome = showHome;
    __weiv_scope.showGarden = showGarden;
    __weiv_scope.showRituals = showRituals;
    __weiv_scope.showHow = showHow;
    __weiv_scope.energyWord = energyWord;
    __weiv_scope.openPulse = openPulse;
    __weiv_scope.closeTrace = closeTrace;
    __weiv_scope.closeFromBackdrop = closeFromBackdrop;
    __weiv_scope.chooseEnergy1 = chooseEnergy1;
    __weiv_scope.chooseEnergy2 = chooseEnergy2;
    __weiv_scope.chooseEnergy3 = chooseEnergy3;
    __weiv_scope.chooseEnergy4 = chooseEnergy4;
    __weiv_scope.chooseEnergy5 = chooseEnergy5;
    __weiv_scope.energyClass = energyClass;
    __weiv_scope.chooseNeed = chooseNeed;
    __weiv_scope.chooseHope = chooseHope;
    __weiv_scope.chooseWarmth = chooseWarmth;
    __weiv_scope.chooseSpace = chooseSpace;
    __weiv_scope.pulseClass = pulseClass;
    __weiv_scope.updateFeeling = updateFeeling;
    __weiv_scope.updateNote = updateNote;
    __weiv_scope.chooseVisibility = chooseVisibility;
    __weiv_scope.visibilityClass = visibilityClass;
    __weiv_scope.refreshAfterPulse = refreshAfterPulse;
    __weiv_scope.saveTrace = saveTrace;
    __weiv_scope.keepRitual = keepRitual;
    __weiv_scope.dismissOpening = dismissOpening;
    __weiv_scope.bloomClass = bloomClass;
    __weiv_scope.selectBloom = selectBloom;
    __weiv_scope.observedLabel = observedLabel;
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

export const scopeId = 'w9891FC91AE0D1DF7';
export const css =
  '\n  [data-weiv-scope="w9891FC91AE0D1DF7"].shell, [data-weiv-scope="w9891FC91AE0D1DF7"] .shell {--cream:#f0eadb;--ink:#142018;--moss:#516b53;--sage:#9fb59a;--ember:#ee9a6b;--night:#101813;min-height:100vh;background:var(--night);color:var(--cream);font-family:Inter,ui-sans-serif,system-ui,sans-serif}[data-weiv-scope="w9891FC91AE0D1DF7"].boot, [data-weiv-scope="w9891FC91AE0D1DF7"] .boot {display:none}[data-weiv-scope="w9891FC91AE0D1DF7"]button, [data-weiv-scope="w9891FC91AE0D1DF7"] button, [data-weiv-scope="w9891FC91AE0D1DF7"]input, [data-weiv-scope="w9891FC91AE0D1DF7"] input, [data-weiv-scope="w9891FC91AE0D1DF7"]textarea, [data-weiv-scope="w9891FC91AE0D1DF7"] textarea {font:inherit}[data-weiv-scope="w9891FC91AE0D1DF7"]button, [data-weiv-scope="w9891FC91AE0D1DF7"] button {color:inherit}[data-weiv-scope="w9891FC91AE0D1DF7"]header, [data-weiv-scope="w9891FC91AE0D1DF7"] header {position:fixed;z-index:10;top:0;left:0;right:0;height:76px;display:grid;grid-template-columns:260px 1fr auto;align-items:center;border-bottom:1px solid rgba(240,234,219,.1);background:rgba(16,24,19,.88);backdrop-filter:blur(18px);padding:0 34px}[data-weiv-scope="w9891FC91AE0D1DF7"].brand, [data-weiv-scope="w9891FC91AE0D1DF7"] .brand {display:flex;gap:12px;align-items:center;border:0;background:none;text-align:left;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].brand>i, [data-weiv-scope="w9891FC91AE0D1DF7"] .brand>i {width:32px;height:32px;border-radius:50%;background:radial-gradient(circle at 55% 55%,#ffd0a7 0 8%,#d66e49 24%,#4b3321 50%,transparent 53%);box-shadow:0 0 24px #d9785055}[data-weiv-scope="w9891FC91AE0D1DF7"].brand span, [data-weiv-scope="w9891FC91AE0D1DF7"] .brand span {font-family:Georgia,serif;font-size:21px}[data-weiv-scope="w9891FC91AE0D1DF7"].brand small, [data-weiv-scope="w9891FC91AE0D1DF7"] .brand small {display:block;font:10px Inter,sans-serif;color:#94a497;letter-spacing:1px;text-transform:uppercase;margin-top:2px}[data-weiv-scope="w9891FC91AE0D1DF7"].season, [data-weiv-scope="w9891FC91AE0D1DF7"] .season {text-align:center}[data-weiv-scope="w9891FC91AE0D1DF7"].season span, [data-weiv-scope="w9891FC91AE0D1DF7"] .season span {font:16px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].season b, [data-weiv-scope="w9891FC91AE0D1DF7"] .season b {display:block;font-size:10px;color:#8fa091;font-weight:400;letter-spacing:.7px;margin-top:3px}[data-weiv-scope="w9891FC91AE0D1DF7"].people, [data-weiv-scope="w9891FC91AE0D1DF7"] .people {display:flex}[data-weiv-scope="w9891FC91AE0D1DF7"].person, [data-weiv-scope="w9891FC91AE0D1DF7"] .person {width:34px;height:34px;margin-left:-7px;border:2px solid #18251c;border-radius:50%;background:#516b53;font-size:11px;cursor:pointer;opacity:.55}[data-weiv-scope="w9891FC91AE0D1DF7"].person:first-child, [data-weiv-scope="w9891FC91AE0D1DF7"] .person:first-child {background:#a65f48}[data-weiv-scope="w9891FC91AE0D1DF7"].person.active, [data-weiv-scope="w9891FC91AE0D1DF7"] .person.active {opacity:1;transform:translateY(-2px);box-shadow:0 4px 14px #0006}[data-weiv-scope="w9891FC91AE0D1DF7"]aside, [data-weiv-scope="w9891FC91AE0D1DF7"] aside {position:fixed;top:76px;bottom:0;left:0;width:230px;border-right:1px solid rgba(240,234,219,.09);padding:34px 24px;display:flex;flex-direction:column;background:#121c16}[data-weiv-scope="w9891FC91AE0D1DF7"].home-name small, [data-weiv-scope="w9891FC91AE0D1DF7"] .home-name small, [data-weiv-scope="w9891FC91AE0D1DF7"].page-intro small, [data-weiv-scope="w9891FC91AE0D1DF7"] .page-intro small, [data-weiv-scope="w9891FC91AE0D1DF7"].section-title small, [data-weiv-scope="w9891FC91AE0D1DF7"] .section-title small, [data-weiv-scope="w9891FC91AE0D1DF7"].opening small, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening small, [data-weiv-scope="w9891FC91AE0D1DF7"].trace-card>small, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card>small {color:#9aab9c;text-transform:uppercase;letter-spacing:1.8px;font-size:9px}[data-weiv-scope="w9891FC91AE0D1DF7"].home-name h2, [data-weiv-scope="w9891FC91AE0D1DF7"] .home-name h2 {font:24px Georgia,serif;margin:8px 0 3px}[data-weiv-scope="w9891FC91AE0D1DF7"].home-name p, [data-weiv-scope="w9891FC91AE0D1DF7"] .home-name p {color:#77877a;font-size:11px;margin:0}[data-weiv-scope="w9891FC91AE0D1DF7"].shell nav, [data-weiv-scope="w9891FC91AE0D1DF7"] .shell nav {margin-top:48px;display:grid;gap:7px}[data-weiv-scope="w9891FC91AE0D1DF7"].shell nav button, [data-weiv-scope="w9891FC91AE0D1DF7"] .shell nav button {border:0;background:transparent;color:#859488;text-align:left;padding:11px 12px;border-radius:10px;font-size:12px;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].shell nav button span, [data-weiv-scope="w9891FC91AE0D1DF7"] .shell nav button span {display:inline-block;width:26px;color:#b8c6b7}[data-weiv-scope="w9891FC91AE0D1DF7"].shell nav button.active, [data-weiv-scope="w9891FC91AE0D1DF7"] .shell nav button.active, [data-weiv-scope="w9891FC91AE0D1DF7"].shell nav button:hover, [data-weiv-scope="w9891FC91AE0D1DF7"] .shell nav button:hover {background:#26362a;color:#f3edde}[data-weiv-scope="w9891FC91AE0D1DF7"].aside-bottom, [data-weiv-scope="w9891FC91AE0D1DF7"] .aside-bottom {margin-top:auto}[data-weiv-scope="w9891FC91AE0D1DF7"].aside-bottom p, [data-weiv-scope="w9891FC91AE0D1DF7"] .aside-bottom p {font-size:11px;color:#829185;line-height:1.6}[data-weiv-scope="w9891FC91AE0D1DF7"].aside-bottom b, [data-weiv-scope="w9891FC91AE0D1DF7"] .aside-bottom b {color:#d8ddcf}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-button, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-button {width:100%;border:1px solid #425645;border-radius:12px;background:#1d2a21;padding:12px;text-align:left;font-size:12px;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-button span, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-button span {float:right;color:#e9a57e}[data-weiv-scope="w9891FC91AE0D1DF7"]main, [data-weiv-scope="w9891FC91AE0D1DF7"] main {margin-left:230px;padding-top:76px;min-height:100vh}[data-weiv-scope="w9891FC91AE0D1DF7"].error, [data-weiv-scope="w9891FC91AE0D1DF7"] .error {margin:22px 40px 0;background:#8a4035;padding:12px 16px;border-radius:9px;font-size:12px}[data-weiv-scope="w9891FC91AE0D1DF7"].loading, [data-weiv-scope="w9891FC91AE0D1DF7"] .loading {min-height:calc(100vh - 76px);display:grid;place-content:center;text-align:center;color:#95a496}[data-weiv-scope="w9891FC91AE0D1DF7"].loading i, [data-weiv-scope="w9891FC91AE0D1DF7"] .loading i {width:50px;height:50px;border-radius:50%;margin:auto;background:radial-gradient(circle,#f1b383,#6e3f2a 30%,transparent 62%);animation:pulse 2s infinite}[data-weiv-scope="w9891FC91AE0D1DF7"].hearthscape, [data-weiv-scope="w9891FC91AE0D1DF7"] .hearthscape {min-height:540px;position:relative;display:grid;grid-template-columns:1fr 390px 1fr;align-items:center;padding:34px 6vw;background:radial-gradient(circle at 52% 48%,#71533930,transparent 24%),linear-gradient(150deg,#18281e,#0d1511 70%);overflow:hidden}[data-weiv-scope="w9891FC91AE0D1DF7"].hearthscape:before, [data-weiv-scope="w9891FC91AE0D1DF7"] .hearthscape:before {content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent 49.8%,rgba(240,234,219,.05) 50%,transparent 50.2%),linear-gradient(rgba(240,234,219,.025) 1px,transparent 1px);background-size:100% 100%,100% 48px;opacity:.5}[data-weiv-scope="w9891FC91AE0D1DF7"].sky-copy, [data-weiv-scope="w9891FC91AE0D1DF7"] .sky-copy, [data-weiv-scope="w9891FC91AE0D1DF7"].outside, [data-weiv-scope="w9891FC91AE0D1DF7"] .outside {position:relative;z-index:2;max-width:270px}[data-weiv-scope="w9891FC91AE0D1DF7"].sky-copy small, [data-weiv-scope="w9891FC91AE0D1DF7"] .sky-copy small {font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#94a496}[data-weiv-scope="w9891FC91AE0D1DF7"].sky-copy h1, [data-weiv-scope="w9891FC91AE0D1DF7"] .sky-copy h1 {font:42px/1.08 Georgia,serif;margin:14px 0}[data-weiv-scope="w9891FC91AE0D1DF7"].sky-copy p, [data-weiv-scope="w9891FC91AE0D1DF7"] .sky-copy p, [data-weiv-scope="w9891FC91AE0D1DF7"].outside p, [data-weiv-scope="w9891FC91AE0D1DF7"] .outside p {color:#a3afa4;font:14px/1.65 Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].outside, [data-weiv-scope="w9891FC91AE0D1DF7"] .outside {justify-self:end}[data-weiv-scope="w9891FC91AE0D1DF7"].outside span, [data-weiv-scope="w9891FC91AE0D1DF7"] .outside span {font:26px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].outside small, [data-weiv-scope="w9891FC91AE0D1DF7"] .outside small {color:#718176;font-size:9px;text-transform:uppercase;letter-spacing:1px}[data-weiv-scope="w9891FC91AE0D1DF7"].living-orbit, [data-weiv-scope="w9891FC91AE0D1DF7"] .living-orbit {position:relative;width:350px;height:350px;border-radius:50%;display:grid;place-content:center;text-align:center;background:radial-gradient(circle,rgba(240,173,113,calc(var(--warmth)*.6)) 0 4%,rgba(180,104,66,.18) 15%,rgba(91,119,86,.08) 42%,transparent 68%);filter:saturate(calc(.7 + var(--light)*.5))}[data-weiv-scope="w9891FC91AE0D1DF7"].ring, [data-weiv-scope="w9891FC91AE0D1DF7"] .ring {position:absolute;border:1px solid rgba(226,218,193,.13);border-radius:50%;inset:10%}[data-weiv-scope="w9891FC91AE0D1DF7"].ring.two, [data-weiv-scope="w9891FC91AE0D1DF7"] .ring.two {inset:22%;border-style:dashed;animation:turn 38s linear infinite}[data-weiv-scope="w9891FC91AE0D1DF7"].ring.three, [data-weiv-scope="w9891FC91AE0D1DF7"] .ring.three {inset:35%}[data-weiv-scope="w9891FC91AE0D1DF7"].ember, [data-weiv-scope="w9891FC91AE0D1DF7"] .ember {width:78px;height:78px;border-radius:50%;margin:auto;display:grid;place-content:center;background:radial-gradient(circle at 45% 58%,#ffcf96,#d36d47 35%,#512d20 68%,transparent 70%);box-shadow:0 0 60px #e6875266}[data-weiv-scope="w9891FC91AE0D1DF7"].ember span, [data-weiv-scope="w9891FC91AE0D1DF7"] .ember span {width:12px;height:23px;background:#ffe1b4;border-radius:60% 40% 65% 35%;filter:blur(2px);animation:pulse 2.2s infinite}[data-weiv-scope="w9891FC91AE0D1DF7"].living-orbit>b, [data-weiv-scope="w9891FC91AE0D1DF7"] .living-orbit>b {font:20px Georgia,serif;margin-top:13px}[data-weiv-scope="w9891FC91AE0D1DF7"].living-orbit>small, [data-weiv-scope="w9891FC91AE0D1DF7"] .living-orbit>small {font-size:8px;text-transform:uppercase;letter-spacing:1.4px;color:#93a197;margin-top:4px}[data-weiv-scope="w9891FC91AE0D1DF7"].rain, [data-weiv-scope="w9891FC91AE0D1DF7"] .rain {position:absolute;inset:8%;border-radius:50%;opacity:var(--rain);background:repeating-linear-gradient(112deg,transparent 0 19px,rgba(196,214,208,.23) 20px 21px,transparent 22px 34px);animation:drift 9s linear infinite}[data-weiv-scope="w9891FC91AE0D1DF7"].perspectives, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspectives, [data-weiv-scope="w9891FC91AE0D1DF7"].rhythms, [data-weiv-scope="w9891FC91AE0D1DF7"] .rhythms {padding:58px 6vw;background:#f0eadb;color:#162118}[data-weiv-scope="w9891FC91AE0D1DF7"].section-title, [data-weiv-scope="w9891FC91AE0D1DF7"] .section-title {display:flex;align-items:end;justify-content:space-between;margin-bottom:26px}[data-weiv-scope="w9891FC91AE0D1DF7"].section-title h2, [data-weiv-scope="w9891FC91AE0D1DF7"] .section-title h2 {font:31px Georgia,serif;margin:7px 0 0}[data-weiv-scope="w9891FC91AE0D1DF7"].section-title p, [data-weiv-scope="w9891FC91AE0D1DF7"] .section-title p {max-width:300px;color:#687468;font:13px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].perspective-row, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective-row {display:grid;grid-template-columns:repeat(2,1fr);gap:14px}[data-weiv-scope="w9891FC91AE0D1DF7"].perspective, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective {border:1px solid #cbd2c5;border-radius:18px;padding:19px;display:grid;grid-template-columns:55px 1fr auto;gap:15px;align-items:center;background:#f7f3e9}[data-weiv-scope="w9891FC91AE0D1DF7"].perspective>i, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective>i {width:48px;height:48px;border-radius:50%;background:radial-gradient(circle at 50% 60%,rgba(219,131,88,calc(var(--energy)/5)),#dbe3d3 62%)}[data-weiv-scope="w9891FC91AE0D1DF7"].perspective b, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective b {font:18px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].perspective p, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective p {margin:5px 0;color:#667267;font-size:12px}[data-weiv-scope="w9891FC91AE0D1DF7"].perspective>span, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective>span {font-size:9px;text-transform:uppercase;color:#819080}[data-weiv-scope="w9891FC91AE0D1DF7"].perspective.private, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective.private {background:#e9e5da;border-style:dashed}[data-weiv-scope="w9891FC91AE0D1DF7"].opening, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening {padding:48px 6vw;display:grid;grid-template-columns:80px 1fr auto;gap:28px;align-items:center;background:#26382c}[data-weiv-scope="w9891FC91AE0D1DF7"].opening-mark, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening-mark {width:68px;height:68px;border-radius:50%;display:grid;place-content:center;background:#e6aa7b;color:#543424;font-size:26px}[data-weiv-scope="w9891FC91AE0D1DF7"].opening h2, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening h2 {font:32px Georgia,serif;margin:8px 0}[data-weiv-scope="w9891FC91AE0D1DF7"].opening-copy>p, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening-copy>p {color:#b8c2b7;max-width:650px}[data-weiv-scope="w9891FC91AE0D1DF7"].opening blockquote, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening blockquote {font:17px/1.5 Georgia,serif;color:#f5e8d2;border-left:1px solid #e6aa7b;margin:18px 0 12px;padding-left:18px}[data-weiv-scope="w9891FC91AE0D1DF7"].opening details, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening details {font-size:10px;color:#90a093}[data-weiv-scope="w9891FC91AE0D1DF7"].opening-actions, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening-actions {display:grid;gap:8px;min-width:190px}[data-weiv-scope="w9891FC91AE0D1DF7"].opening-actions button, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening-actions button {border:1px solid #6a7e6d;background:transparent;border-radius:20px;padding:10px;cursor:pointer;font-size:11px}[data-weiv-scope="w9891FC91AE0D1DF7"].opening-actions .warm, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening-actions .warm {background:#e6aa7b;color:#3a271c;border-color:#e6aa7b}[data-weiv-scope="w9891FC91AE0D1DF7"].rhythms, [data-weiv-scope="w9891FC91AE0D1DF7"] .rhythms {background:#e7e3d7}[data-weiv-scope="w9891FC91AE0D1DF7"].rhythm-grid, [data-weiv-scope="w9891FC91AE0D1DF7"] .rhythm-grid {display:grid;grid-template-columns:repeat(2,1fr);gap:14px}[data-weiv-scope="w9891FC91AE0D1DF7"].rhythm-grid article, [data-weiv-scope="w9891FC91AE0D1DF7"] .rhythm-grid article {background:#f3eee3;border-radius:18px;padding:24px}[data-weiv-scope="w9891FC91AE0D1DF7"].rhythm-grid span, [data-weiv-scope="w9891FC91AE0D1DF7"] .rhythm-grid span {font-size:9px;text-transform:uppercase;color:#778576}[data-weiv-scope="w9891FC91AE0D1DF7"].rhythm-grid h3, [data-weiv-scope="w9891FC91AE0D1DF7"] .rhythm-grid h3 {font:22px Georgia,serif;margin:12px 0 7px}[data-weiv-scope="w9891FC91AE0D1DF7"].rhythm-grid p, [data-weiv-scope="w9891FC91AE0D1DF7"] .rhythm-grid p {font:14px/1.55 Georgia,serif;color:#59675b}[data-weiv-scope="w9891FC91AE0D1DF7"].page-intro, [data-weiv-scope="w9891FC91AE0D1DF7"] .page-intro {padding:65px 7vw 38px;background:#18251d}[data-weiv-scope="w9891FC91AE0D1DF7"].page-intro h1, [data-weiv-scope="w9891FC91AE0D1DF7"] .page-intro h1 {font:48px/1.05 Georgia,serif;margin:12px 0}[data-weiv-scope="w9891FC91AE0D1DF7"].page-intro p, [data-weiv-scope="w9891FC91AE0D1DF7"] .page-intro p {color:#9ba99d;font:15px Georgia,serif;max-width:600px}[data-weiv-scope="w9891FC91AE0D1DF7"].garden, [data-weiv-scope="w9891FC91AE0D1DF7"] .garden {height:620px;position:relative;overflow:hidden;background:linear-gradient(#18251d 0 42%,#26382b 43%,#17231b 100%)}[data-weiv-scope="w9891FC91AE0D1DF7"].garden-glow, [data-weiv-scope="w9891FC91AE0D1DF7"] .garden-glow {position:absolute;inset:-30% 20% 20%;background:radial-gradient(circle,#91a98222,transparent 58%)}[data-weiv-scope="w9891FC91AE0D1DF7"].ground, [data-weiv-scope="w9891FC91AE0D1DF7"] .ground {position:absolute;left:-5%;right:-5%;bottom:-18%;height:60%;border-radius:50%;background:#202f24}[data-weiv-scope="w9891FC91AE0D1DF7"].bloom, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom {position:absolute;left:var(--x);top:var(--y);width:var(--size);height:var(--size);border:0;border-radius:50%;cursor:pointer;background:radial-gradient(circle,#ffe0b0 0 8%,#dd8a5d 10% 25%,#5f734f 28% 36%,transparent 38%);filter:drop-shadow(0 8px 10px #0005);transition:.2s}[data-weiv-scope="w9891FC91AE0D1DF7"].bloom.bright, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.bright {filter:hue-rotate(20deg) drop-shadow(0 8px 10px #0005)}[data-weiv-scope="w9891FC91AE0D1DF7"].bloom.quiet, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.quiet {filter:saturate(.45) drop-shadow(0 8px 10px #0005)}[data-weiv-scope="w9891FC91AE0D1DF7"].bloom.tender, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.tender {filter:hue-rotate(-20deg) drop-shadow(0 8px 10px #0005)}[data-weiv-scope="w9891FC91AE0D1DF7"].bloom.private, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.private {outline:1px dashed #e7d8b477;outline-offset:6px}[data-weiv-scope="w9891FC91AE0D1DF7"].bloom.selected, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.selected {transform:scale(1.18)}[data-weiv-scope="w9891FC91AE0D1DF7"].bloom span, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom span {position:absolute;top:100%;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:8px;color:#a9b4aa;text-transform:uppercase;margin-top:5px}[data-weiv-scope="w9891FC91AE0D1DF7"].memory-card, [data-weiv-scope="w9891FC91AE0D1DF7"] .memory-card {position:absolute;right:5vw;bottom:55px;width:300px;background:#efe9db;color:#172219;padding:25px;border-radius:18px;box-shadow:0 18px 50px #0006}[data-weiv-scope="w9891FC91AE0D1DF7"].memory-card small, [data-weiv-scope="w9891FC91AE0D1DF7"] .memory-card small {font-size:9px;text-transform:uppercase;color:#7f8c7f}[data-weiv-scope="w9891FC91AE0D1DF7"].memory-card h2, [data-weiv-scope="w9891FC91AE0D1DF7"] .memory-card h2 {font:26px Georgia,serif;margin:10px 0}[data-weiv-scope="w9891FC91AE0D1DF7"].memory-card p, [data-weiv-scope="w9891FC91AE0D1DF7"] .memory-card p {font:14px/1.55 Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].memory-card span, [data-weiv-scope="w9891FC91AE0D1DF7"] .memory-card span {font-size:9px;color:#7a887c}[data-weiv-scope="w9891FC91AE0D1DF7"].garden-caption, [data-weiv-scope="w9891FC91AE0D1DF7"] .garden-caption {position:absolute;left:6vw;bottom:40px;max-width:340px;color:#849488;font:12px/1.6 Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-list, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-list {padding:25px 7vw 70px;background:#eee8dc;color:#172219;min-height:500px}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-list article, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-list article {display:grid;grid-template-columns:65px 1fr auto;gap:25px;align-items:center;padding:28px 0;border-bottom:1px solid #ccd1c7}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-symbol, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-symbol {width:55px;height:55px;border-radius:50%;background:#d9dfd2;display:grid;place-content:center;font-size:24px}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-list small, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-list small {font-size:9px;text-transform:uppercase;color:#7c897e}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-list h2, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-list h2 {font:27px Georgia,serif;margin:5px 0}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-list p, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-list p {color:#657166;margin:0;font:13px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-list article>span, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-list article>span {font-size:9px;color:#8b968b}[data-weiv-scope="w9891FC91AE0D1DF7"].principles, [data-weiv-scope="w9891FC91AE0D1DF7"] .principles {padding:30px 7vw 55px;background:#eee8dc;color:#172219;display:grid;grid-template-columns:repeat(2,1fr);gap:15px}[data-weiv-scope="w9891FC91AE0D1DF7"].principles article, [data-weiv-scope="w9891FC91AE0D1DF7"] .principles article {background:#f7f2e8;padding:26px;border-radius:16px}[data-weiv-scope="w9891FC91AE0D1DF7"].principles b, [data-weiv-scope="w9891FC91AE0D1DF7"] .principles b {color:#a1664c;font:14px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].principles h3, [data-weiv-scope="w9891FC91AE0D1DF7"] .principles h3 {font:22px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].principles p, [data-weiv-scope="w9891FC91AE0D1DF7"] .principles p {color:#647066;font:13px/1.6 Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].sources, [data-weiv-scope="w9891FC91AE0D1DF7"] .sources {padding:45px 7vw 70px;background:#1a281f}[data-weiv-scope="w9891FC91AE0D1DF7"].sources h2, [data-weiv-scope="w9891FC91AE0D1DF7"] .sources h2 {font:28px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].sources article, [data-weiv-scope="w9891FC91AE0D1DF7"] .sources article {display:grid;grid-template-columns:10px 1fr;gap:14px;border-top:1px solid #34473a;padding:15px 0}[data-weiv-scope="w9891FC91AE0D1DF7"].sources i, [data-weiv-scope="w9891FC91AE0D1DF7"] .sources i {width:7px;height:7px;background:#df9b73;border-radius:50%;margin-top:6px}[data-weiv-scope="w9891FC91AE0D1DF7"].sources b, [data-weiv-scope="w9891FC91AE0D1DF7"] .sources b {font-size:12px}[data-weiv-scope="w9891FC91AE0D1DF7"].sources p, [data-weiv-scope="w9891FC91AE0D1DF7"] .sources p {font-size:11px;color:#91a095;margin:5px 0}[data-weiv-scope="w9891FC91AE0D1DF7"].sources>small, [data-weiv-scope="w9891FC91AE0D1DF7"] .sources>small {font-size:9px;color:#718075}[data-weiv-scope="w9891FC91AE0D1DF7"].modal-layer, [data-weiv-scope="w9891FC91AE0D1DF7"] .modal-layer {position:fixed;z-index:30;inset:0;background:#08100bcc;display:grid;place-content:center;padding:20px}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card {position:relative;width:min(520px,calc(100vw - 40px));max-height:90vh;overflow:auto;background:#eee8dc;color:#172219;border-radius:22px;padding:34px;box-sizing:border-box}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card .close, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card .close {position:absolute;right:22px;top:18px;border:0;background:none;color:#617064;font-size:25px;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card h2, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card h2 {font:32px Georgia,serif;margin:10px 0}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card>p, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card>p {color:#687469;font:13px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card label, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card label {display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#647166;margin-top:20px}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card input, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card input, [data-weiv-scope="w9891FC91AE0D1DF7"].trace-card textarea, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card textarea {display:block;width:100%;box-sizing:border-box;margin-top:8px;border:1px solid #c7cec2;border-radius:10px;background:#f8f4ea;padding:12px;color:#172219}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card textarea, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card textarea {min-height:80px;resize:vertical}[data-weiv-scope="w9891FC91AE0D1DF7"].energy-picker, [data-weiv-scope="w9891FC91AE0D1DF7"] .energy-picker {display:flex;gap:8px;margin-top:8px}[data-weiv-scope="w9891FC91AE0D1DF7"].energy-picker button, [data-weiv-scope="w9891FC91AE0D1DF7"] .energy-picker button {width:38px;height:38px;border-radius:50%;border:1px solid #b8c1b4;background:transparent;color:#516052;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].energy-picker button.active, [data-weiv-scope="w9891FC91AE0D1DF7"] .energy-picker button.active {background:#405943;color:white}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card fieldset, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card fieldset {border:0;padding:0;margin:22px 0 12px;display:grid;grid-template-columns:1fr 1fr;gap:9px}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card legend, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card legend {font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#647166;margin-bottom:8px}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card fieldset button, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card fieldset button {border:1px solid #c3cabf;background:transparent;color:#26342a;border-radius:11px;text-align:left;padding:12px;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card fieldset button.active, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card fieldset button.active {border-color:#57705a;background:#dce3d7}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card fieldset b, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card fieldset b, [data-weiv-scope="w9891FC91AE0D1DF7"].trace-card fieldset span, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card fieldset span {display:block}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card fieldset span, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card fieldset span {font-size:9px;color:#758176;margin-top:4px}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card .save, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card .save {width:100%;border:0;background:#263c2d;color:white;border-radius:20px;padding:12px;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-card .save:disabled, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-card .save:disabled {opacity:.5}@keyframes turn{to{transform:rotate(360deg)}}@keyframes pulse{50%{transform:scale(1.08);opacity:.75}}@keyframes drift{to{background-position:120px 100px}}@media(max-width:850px){[data-weiv-scope="w9891FC91AE0D1DF7"]header, [data-weiv-scope="w9891FC91AE0D1DF7"] header {grid-template-columns:1fr auto;padding:0 18px}[data-weiv-scope="w9891FC91AE0D1DF7"].season, [data-weiv-scope="w9891FC91AE0D1DF7"] .season {display:none}[data-weiv-scope="w9891FC91AE0D1DF7"]aside, [data-weiv-scope="w9891FC91AE0D1DF7"] aside {position:static;width:auto;padding:18px 20px;margin-top:76px;display:block}[data-weiv-scope="w9891FC91AE0D1DF7"].home-name, [data-weiv-scope="w9891FC91AE0D1DF7"] .home-name {display:none}[data-weiv-scope="w9891FC91AE0D1DF7"].shell nav, [data-weiv-scope="w9891FC91AE0D1DF7"] .shell nav {margin:0;display:flex;overflow:auto}[data-weiv-scope="w9891FC91AE0D1DF7"].shell nav button, [data-weiv-scope="w9891FC91AE0D1DF7"] .shell nav button {white-space:nowrap}[data-weiv-scope="w9891FC91AE0D1DF7"].aside-bottom, [data-weiv-scope="w9891FC91AE0D1DF7"] .aside-bottom {display:flex;gap:15px;align-items:center}[data-weiv-scope="w9891FC91AE0D1DF7"].aside-bottom p, [data-weiv-scope="w9891FC91AE0D1DF7"] .aside-bottom p {display:none}[data-weiv-scope="w9891FC91AE0D1DF7"].trace-button, [data-weiv-scope="w9891FC91AE0D1DF7"] .trace-button {width:auto;margin-left:auto}[data-weiv-scope="w9891FC91AE0D1DF7"]main, [data-weiv-scope="w9891FC91AE0D1DF7"] main {margin:0;padding:0}[data-weiv-scope="w9891FC91AE0D1DF7"].hearthscape, [data-weiv-scope="w9891FC91AE0D1DF7"] .hearthscape {grid-template-columns:1fr;gap:28px;text-align:center;padding:48px 22px}[data-weiv-scope="w9891FC91AE0D1DF7"].sky-copy, [data-weiv-scope="w9891FC91AE0D1DF7"] .sky-copy, [data-weiv-scope="w9891FC91AE0D1DF7"].outside, [data-weiv-scope="w9891FC91AE0D1DF7"] .outside {justify-self:center}[data-weiv-scope="w9891FC91AE0D1DF7"].living-orbit, [data-weiv-scope="w9891FC91AE0D1DF7"] .living-orbit {width:280px;height:280px;justify-self:center}[data-weiv-scope="w9891FC91AE0D1DF7"].perspective-row, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective-row, [data-weiv-scope="w9891FC91AE0D1DF7"].rhythm-grid, [data-weiv-scope="w9891FC91AE0D1DF7"] .rhythm-grid, [data-weiv-scope="w9891FC91AE0D1DF7"].principles, [data-weiv-scope="w9891FC91AE0D1DF7"] .principles {grid-template-columns:1fr}[data-weiv-scope="w9891FC91AE0D1DF7"].opening, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening {grid-template-columns:1fr;text-align:center}[data-weiv-scope="w9891FC91AE0D1DF7"].opening-mark, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening-mark {margin:auto}[data-weiv-scope="w9891FC91AE0D1DF7"].opening-actions, [data-weiv-scope="w9891FC91AE0D1DF7"] .opening-actions {min-width:0}[data-weiv-scope="w9891FC91AE0D1DF7"].section-title, [data-weiv-scope="w9891FC91AE0D1DF7"] .section-title {display:block}[data-weiv-scope="w9891FC91AE0D1DF7"].page-intro h1, [data-weiv-scope="w9891FC91AE0D1DF7"] .page-intro h1 {font-size:38px}[data-weiv-scope="w9891FC91AE0D1DF7"].garden, [data-weiv-scope="w9891FC91AE0D1DF7"] .garden {height:680px}[data-weiv-scope="w9891FC91AE0D1DF7"].memory-card, [data-weiv-scope="w9891FC91AE0D1DF7"] .memory-card {left:20px;right:20px;width:auto}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-list article, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-list article {grid-template-columns:50px 1fr}[data-weiv-scope="w9891FC91AE0D1DF7"].ritual-list article>span, [data-weiv-scope="w9891FC91AE0D1DF7"] .ritual-list article>span {display:none}}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].living-orbit, [data-weiv-scope="w9891FC91AE0D1DF7"] .living-orbit {background:radial-gradient(circle,rgba(240,173,113,.38) 0 4%,rgba(180,104,66,.18) 15%,rgba(91,119,86,.08) 42%,transparent 68%);filter:saturate(1.05)}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].rain, [data-weiv-scope="w9891FC91AE0D1DF7"] .rain {opacity:.22}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].perspective>i, [data-weiv-scope="w9891FC91AE0D1DF7"] .perspective>i {background:radial-gradient(circle at 50% 60%,rgba(219,131,88,.72),#dbe3d3 62%)}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].bloom.first-night, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.first-night {left:18%;top:42%;width:68px;height:68px}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].bloom.hallway-laugh, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.hallway-laugh {left:37%;top:20%;width:56px;height:56px}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].bloom.quiet-corner, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.quiet-corner {left:57%;top:47%;width:64px;height:64px}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].bloom.soup-sunday, [data-weiv-scope="w9891FC91AE0D1DF7"] .bloom.soup-sunday {left:74%;top:27%;width:72px;height:72px}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].primary-pulse, [data-weiv-scope="w9891FC91AE0D1DF7"] .primary-pulse {margin-top:18px;border:1px solid #d8a57d;background:#d98a61;color:#23170f;border-radius:22px;padding:11px 16px;cursor:pointer;font-size:11px}[data-weiv-scope="w9891FC91AE0D1DF7"].sky-copy em, [data-weiv-scope="w9891FC91AE0D1DF7"] .sky-copy em {display:block;margin-top:10px;color:#7f9083;font:9px Inter,sans-serif;text-transform:uppercase;letter-spacing:1px}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop {background:#17231b;border-top:1px solid #2e4033;border-bottom:1px solid #2e4033;padding:17px 6vw;display:flex;align-items:center;justify-content:center;gap:24px}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop>div, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop>div {display:flex;align-items:center;gap:10px;max-width:230px}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop b, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop b {width:28px;height:28px;border:1px solid #7f947f;border-radius:50%;display:grid;place-content:center;color:#dca17c;font-size:10px}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop span, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop span {display:grid}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop strong, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop strong {font:14px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop small, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop small {color:#7f9083;font-size:9px;margin-top:3px}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop>i, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop>i {color:#607165}[data-weiv-scope="w9891FC91AE0D1DF7"].guided-example, [data-weiv-scope="w9891FC91AE0D1DF7"] .guided-example {padding:52px 6vw;background:#dcd9cd;color:#172219;text-align:center}[data-weiv-scope="w9891FC91AE0D1DF7"].guided-example>small, [data-weiv-scope="w9891FC91AE0D1DF7"] .guided-example>small {text-transform:uppercase;letter-spacing:1.5px;color:#68766a;font-size:9px}[data-weiv-scope="w9891FC91AE0D1DF7"].guided-example h2, [data-weiv-scope="w9891FC91AE0D1DF7"] .guided-example h2 {font:30px Georgia,serif;margin:9px 0 20px}[data-weiv-scope="w9891FC91AE0D1DF7"].guided-example>div, [data-weiv-scope="w9891FC91AE0D1DF7"] .guided-example>div {display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:900px;margin:auto}[data-weiv-scope="w9891FC91AE0D1DF7"].guided-example p, [data-weiv-scope="w9891FC91AE0D1DF7"] .guided-example p {background:#eeeae0;border-radius:14px;padding:16px;font:13px/1.5 Georgia,serif;margin:0}[data-weiv-scope="w9891FC91AE0D1DF7"].guided-example button, [data-weiv-scope="w9891FC91AE0D1DF7"] .guided-example button {display:block;margin:22px auto 10px;border:0;border-radius:22px;background:#314937;color:white;padding:11px 22px;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].guided-example>span, [data-weiv-scope="w9891FC91AE0D1DF7"] .guided-example>span {display:block;color:#687469;font:11px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-result, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-result {position:fixed;z-index:20;right:28px;top:92px;width:300px;background:#f0eadb;color:#172219;border-radius:14px;padding:16px;box-shadow:0 12px 40px #0007}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-result b, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-result b, [data-weiv-scope="w9891FC91AE0D1DF7"].pulse-result span, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-result span {display:block}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-result b, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-result b {font:16px Georgia,serif}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-result span, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-result span {font-size:10px;line-height:1.5;color:#5b695e;margin-top:4px}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-picker, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-picker {display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-picker button, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-picker button {border:1px solid #bbc4b7;background:transparent;border-radius:11px;text-align:left;padding:10px;color:#26342a;cursor:pointer}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-picker button.active, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-picker button.active {border-color:#57705a;background:#dce3d7}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-picker b, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-picker b, [data-weiv-scope="w9891FC91AE0D1DF7"].pulse-picker span, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-picker span {display:block}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-picker span, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-picker span {font-size:9px;color:#758176;margin-top:3px}\n  [data-weiv-scope="w9891FC91AE0D1DF7"].pulse-field, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-field {margin-top:20px}[data-weiv-scope="w9891FC91AE0D1DF7"].field-label, [data-weiv-scope="w9891FC91AE0D1DF7"] .field-label {display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#647166}\n  @media(max-width:850px){[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop {align-items:stretch;overflow:auto;justify-content:flex-start}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop>i, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop>i {display:none}[data-weiv-scope="w9891FC91AE0D1DF7"].play-loop>div, [data-weiv-scope="w9891FC91AE0D1DF7"] .play-loop>div {min-width:210px}[data-weiv-scope="w9891FC91AE0D1DF7"].guided-example>div, [data-weiv-scope="w9891FC91AE0D1DF7"] .guided-example>div {grid-template-columns:1fr}[data-weiv-scope="w9891FC91AE0D1DF7"].pulse-result, [data-weiv-scope="w9891FC91AE0D1DF7"] .pulse-result {left:16px;right:16px;top:86px;width:auto}}\n';

export const trackedStateGraph = { roots: [], paths: [], regions: [] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_319 = document.createElement('div');
  refs[319] = __ref_319;
  __ref_319.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_319.setAttribute('class', 'shell');
  const __ref_1 = document.createElement('span');
  refs[1] = __ref_1;
  __ref_1.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_1.setAttribute('class', 'boot');
  const __ref_0 = document.createTextNode('');
  refs[0] = __ref_0;
  __ref_1.append(__ref_0);
  __ref_319.append(__ref_1);
  const __ref_20 = document.createElement('header');
  refs[20] = __ref_20;
  __ref_20.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_20.setAttribute('class', 'topbar');
  const __ref_5 = document.createElement('button');
  refs[5] = __ref_5;
  __ref_5.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_5.setAttribute('class', 'brand');
  __ref_5.addEventListener('click', (event) => {
    const resolved = instance.refresh().showHome;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_2 = document.createElement('i');
  refs[2] = __ref_2;
  __ref_2.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_5.append(__ref_2);
  const __ref_4 = document.createElement('span');
  refs[4] = __ref_4;
  __ref_4.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_4.append(document.createTextNode('Hearth'));
  const __ref_3 = document.createElement('small');
  refs[3] = __ref_3;
  __ref_3.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_3.append(document.createTextNode('A living home-world'));
  __ref_4.append(__ref_3);
  __ref_5.append(__ref_4);
  __ref_20.append(__ref_5);
  const __ref_6 = document.createComment('if:start');
  const __ref_7 = document.createComment('if:end');
  refs[6] = __ref_6;
  refs[7] = __ref_7;
  refs[8] = undefined;
  __ref_20.append(__ref_6);
  __ref_20.append(__ref_7);
  const __ref_19 = document.createElement('div');
  refs[19] = __ref_19;
  __ref_19.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_19.setAttribute('class', 'people');
  __ref_19.setAttribute('aria-label', 'Choose whose view');
  const __ref_14 = document.createComment('for:start');
  const __ref_15 = document.createComment('for:end');
  refs[14] = __ref_14;
  refs[15] = __ref_15;
  refs[16] = [];
  __ref_19.append(__ref_14);
  __ref_19.append(__ref_15);
  __ref_20.append(__ref_19);
  __ref_319.append(__ref_20);
  const __ref_42 = document.createElement('aside');
  refs[42] = __ref_42;
  __ref_42.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_42.setAttribute('class', 'sidebar');
  const __ref_25 = document.createElement('div');
  refs[25] = __ref_25;
  __ref_25.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_25.setAttribute('class', 'home-name');
  const __ref_21 = document.createElement('small');
  refs[21] = __ref_21;
  __ref_21.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_21.append(document.createTextNode('Our home'));
  __ref_25.append(__ref_21);
  const __ref_23 = document.createElement('h2');
  refs[23] = __ref_23;
  __ref_23.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_22 = document.createTextNode('');
  refs[22] = __ref_22;
  __ref_23.append(__ref_22);
  __ref_25.append(__ref_23);
  const __ref_24 = document.createElement('p');
  refs[24] = __ref_24;
  __ref_24.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_24.append(document.createTextNode('Cuba Street · Te Aro'));
  __ref_25.append(__ref_24);
  __ref_42.append(__ref_25);
  const __ref_34 = document.createElement('nav');
  refs[34] = __ref_34;
  __ref_34.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_34.setAttribute('aria-label', 'Hearth navigation');
  const __ref_27 = document.createElement('button');
  refs[27] = __ref_27;
  __ref_27.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_27.addEventListener('click', (event) => {
    const resolved = instance.refresh().showHome;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_26 = document.createElement('span');
  refs[26] = __ref_26;
  __ref_26.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_26.append(document.createTextNode('◉'));
  __ref_27.append(__ref_26);
  __ref_27.append(document.createTextNode('Living hearth'));
  __ref_34.append(__ref_27);
  const __ref_29 = document.createElement('button');
  refs[29] = __ref_29;
  __ref_29.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_29.addEventListener('click', (event) => {
    const resolved = instance.refresh().showGarden;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_28 = document.createElement('span');
  refs[28] = __ref_28;
  __ref_28.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_28.append(document.createTextNode('✦'));
  __ref_29.append(__ref_28);
  __ref_29.append(document.createTextNode('Memory garden'));
  __ref_34.append(__ref_29);
  const __ref_31 = document.createElement('button');
  refs[31] = __ref_31;
  __ref_31.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_31.addEventListener('click', (event) => {
    const resolved = instance.refresh().showRituals;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_30 = document.createElement('span');
  refs[30] = __ref_30;
  __ref_30.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_30.append(document.createTextNode('◌'));
  __ref_31.append(__ref_30);
  __ref_31.append(document.createTextNode('Our rituals'));
  __ref_34.append(__ref_31);
  const __ref_33 = document.createElement('button');
  refs[33] = __ref_33;
  __ref_33.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_33.addEventListener('click', (event) => {
    const resolved = instance.refresh().showHow;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_32 = document.createElement('span');
  refs[32] = __ref_32;
  __ref_32.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_32.append(document.createTextNode('?'));
  __ref_33.append(__ref_32);
  __ref_33.append(document.createTextNode('How Hearth listens'));
  __ref_34.append(__ref_33);
  __ref_42.append(__ref_34);
  const __ref_41 = document.createElement('div');
  refs[41] = __ref_41;
  __ref_41.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_41.setAttribute('class', 'aside-bottom');
  const __ref_38 = document.createElement('p');
  refs[38] = __ref_38;
  __ref_38.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_36 = document.createElement('b');
  refs[36] = __ref_36;
  __ref_36.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  const __ref_35 = document.createTextNode('');
  refs[35] = __ref_35;
  __ref_36.append(__ref_35);
  __ref_36.append(document.createTextNode('’s lens'));
  __ref_38.append(__ref_36);
  const __ref_37 = document.createElement('br');
  refs[37] = __ref_37;
  __ref_37.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_38.append(__ref_37);
  __ref_38.append(document.createTextNode('Private traces stay in this lens.'));
  __ref_41.append(__ref_38);
  const __ref_40 = document.createElement('button');
  refs[40] = __ref_40;
  __ref_40.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_40.setAttribute('class', 'trace-button');
  __ref_40.addEventListener('click', (event) => {
    const resolved = instance.refresh().openPulse;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  __ref_40.append(document.createTextNode('Place your pulse '));
  const __ref_39 = document.createElement('span');
  refs[39] = __ref_39;
  __ref_39.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_39.append(document.createTextNode('＋'));
  __ref_40.append(__ref_39);
  __ref_41.append(__ref_40);
  __ref_42.append(__ref_41);
  __ref_319.append(__ref_42);
  const __ref_272 = document.createElement('main');
  refs[272] = __ref_272;
  __ref_272.setAttribute('data-weiv-scope', 'w9891FC91AE0D1DF7');
  __ref_272.setAttribute('class', 'content');
  const __ref_43 = document.createComment('if:start');
  const __ref_44 = document.createComment('if:end');
  refs[43] = __ref_43;
  refs[44] = __ref_44;
  refs[45] = undefined;
  __ref_272.append(__ref_43);
  __ref_272.append(__ref_44);
  const __ref_48 = document.createComment('if:start');
  const __ref_49 = document.createComment('if:end');
  refs[48] = __ref_48;
  refs[49] = __ref_49;
  refs[50] = undefined;
  __ref_272.append(__ref_48);
  __ref_272.append(__ref_49);
  const __ref_55 = document.createComment('if:start');
  const __ref_56 = document.createComment('if:end');
  refs[55] = __ref_55;
  refs[56] = __ref_56;
  refs[57] = undefined;
  __ref_272.append(__ref_55);
  __ref_272.append(__ref_56);
  const __ref_61 = document.createComment('if:start');
  const __ref_62 = document.createComment('if:end');
  refs[61] = __ref_61;
  refs[62] = __ref_62;
  refs[63] = undefined;
  __ref_272.append(__ref_61);
  __ref_272.append(__ref_62);
  const __ref_178 = document.createComment('if:start');
  const __ref_179 = document.createComment('if:end');
  refs[178] = __ref_178;
  refs[179] = __ref_179;
  refs[180] = undefined;
  __ref_272.append(__ref_178);
  __ref_272.append(__ref_179);
  const __ref_209 = document.createComment('if:start');
  const __ref_210 = document.createComment('if:end');
  refs[209] = __ref_209;
  refs[210] = __ref_210;
  refs[211] = undefined;
  __ref_272.append(__ref_209);
  __ref_272.append(__ref_210);
  const __ref_232 = document.createComment('if:start');
  const __ref_233 = document.createComment('if:end');
  refs[232] = __ref_232;
  refs[233] = __ref_233;
  refs[234] = undefined;
  __ref_272.append(__ref_232);
  __ref_272.append(__ref_233);
  __ref_319.append(__ref_272);
  const __ref_273 = document.createComment('if:start');
  const __ref_274 = document.createComment('if:end');
  refs[273] = __ref_273;
  refs[274] = __ref_274;
  refs[275] = undefined;
  __ref_319.append(__ref_273);
  __ref_319.append(__ref_274);
  fragment.append(__ref_319);
  return fragment;
}

function updateRegion_text_0(instance, scope, refs) {
  const __next_text_0 = String(scope.boot() ?? '');
  if (refs[0].data !== __next_text_0) {
    refs[0].data = __next_text_0;
  }
}
function updateRegion_conditional_6(instance, scope, refs) {
  updateConditional_6(instance, scope);
}
function updateRegion_text_9(instance, scope, refs) {
  const __next_text_9 = String(scope.world.season.name ?? '');
  if (refs[9].data !== __next_text_9) {
    refs[9].data = __next_text_9;
  }
}
function updateRegion_text_11(instance, scope, refs) {
  const __next_text_11 = String(scope.world.season.phrase ?? '');
  if (refs[11].data !== __next_text_11) {
    refs[11].data = __next_text_11;
  }
}
function updateRegion_loop_14(instance, scope, refs) {
  updateForLoop_14(instance, scope);
}
function updateRegion_attribute_18_class(instance, scope, refs) {
  const __value_18_class = scope.personClass(scope.person.id);
  if (__value_18_class === false || __value_18_class === null || __value_18_class === undefined) {
    if (refs[18].hasAttribute('class')) {
      refs[18].removeAttribute('class');
    }
  } else if (__value_18_class === true) {
    if (!refs[18].hasAttribute('class')) {
      refs[18].setAttribute('class', '');
    }
  } else {
    refs[18].setAttribute('class', String(__value_18_class));
  }
}
function updateRegion_text_17(instance, scope, refs) {
  const __next_text_17 = String(scope.person.initials ?? '');
  if (refs[17].data !== __next_text_17) {
    refs[17].data = __next_text_17;
  }
}
function updateRegion_text_22(instance, scope, refs) {
  const __next_text_22 = String((scope.world ? scope.world.homeName : 'Harbour House') ?? '');
  if (refs[22].data !== __next_text_22) {
    refs[22].data = __next_text_22;
  }
}
function updateRegion_attribute_27_class(instance, scope, refs) {
  const __value_27_class = scope.navClass('home');
  if (__value_27_class === false || __value_27_class === null || __value_27_class === undefined) {
    if (refs[27].hasAttribute('class')) {
      refs[27].removeAttribute('class');
    }
  } else if (__value_27_class === true) {
    if (!refs[27].hasAttribute('class')) {
      refs[27].setAttribute('class', '');
    }
  } else {
    refs[27].setAttribute('class', String(__value_27_class));
  }
}
function updateRegion_attribute_29_class(instance, scope, refs) {
  const __value_29_class = scope.navClass('garden');
  if (__value_29_class === false || __value_29_class === null || __value_29_class === undefined) {
    if (refs[29].hasAttribute('class')) {
      refs[29].removeAttribute('class');
    }
  } else if (__value_29_class === true) {
    if (!refs[29].hasAttribute('class')) {
      refs[29].setAttribute('class', '');
    }
  } else {
    refs[29].setAttribute('class', String(__value_29_class));
  }
}
function updateRegion_attribute_31_class(instance, scope, refs) {
  const __value_31_class = scope.navClass('rituals');
  if (__value_31_class === false || __value_31_class === null || __value_31_class === undefined) {
    if (refs[31].hasAttribute('class')) {
      refs[31].removeAttribute('class');
    }
  } else if (__value_31_class === true) {
    if (!refs[31].hasAttribute('class')) {
      refs[31].setAttribute('class', '');
    }
  } else {
    refs[31].setAttribute('class', String(__value_31_class));
  }
}
function updateRegion_attribute_33_class(instance, scope, refs) {
  const __value_33_class = scope.navClass('how');
  if (__value_33_class === false || __value_33_class === null || __value_33_class === undefined) {
    if (refs[33].hasAttribute('class')) {
      refs[33].removeAttribute('class');
    }
  } else if (__value_33_class === true) {
    if (!refs[33].hasAttribute('class')) {
      refs[33].setAttribute('class', '');
    }
  } else {
    refs[33].setAttribute('class', String(__value_33_class));
  }
}
function updateRegion_text_35(instance, scope, refs) {
  const __next_text_35 = String(scope.viewerName() ?? '');
  if (refs[35].data !== __next_text_35) {
    refs[35].data = __next_text_35;
  }
}
function updateRegion_conditional_43(instance, scope, refs) {
  updateConditional_43(instance, scope);
}
function updateRegion_text_46(instance, scope, refs) {
  const __next_text_46 = String(scope.errorMessage ?? '');
  if (refs[46].data !== __next_text_46) {
    refs[46].data = __next_text_46;
  }
}
function updateRegion_conditional_48(instance, scope, refs) {
  updateConditional_48(instance, scope);
}
function updateRegion_text_52(instance, scope, refs) {
  const __next_text_52 = String(scope.pulseResult ?? '');
  if (refs[52].data !== __next_text_52) {
    refs[52].data = __next_text_52;
  }
}
function updateRegion_conditional_55(instance, scope, refs) {
  updateConditional_55(instance, scope);
}
function updateRegion_conditional_61(instance, scope, refs) {
  updateConditional_61(instance, scope);
}
function updateRegion_text_65(instance, scope, refs) {
  const __next_text_65 = String(scope.world.householdWeather.name ?? '');
  if (refs[65].data !== __next_text_65) {
    refs[65].data = __next_text_65;
  }
}
function updateRegion_text_67(instance, scope, refs) {
  const __next_text_67 = String(scope.world.householdWeather.detail ?? '');
  if (refs[67].data !== __next_text_67) {
    refs[67].data = __next_text_67;
  }
}
function updateRegion_text_70(instance, scope, refs) {
  const __next_text_70 = String(scope.world.householdWeather.perspectives.length ?? '');
  if (refs[70].data !== __next_text_70) {
    refs[70].data = __next_text_70;
  }
}
function updateRegion_text_79(instance, scope, refs) {
  const __next_text_79 = String(scope.energyWord() ?? '');
  if (refs[79].data !== __next_text_79) {
    refs[79].data = __next_text_79;
  }
}
function updateRegion_text_83(instance, scope, refs) {
  const __next_text_83 = String(scope.world.localWeather.summary ?? '');
  if (refs[83].data !== __next_text_83) {
    refs[83].data = __next_text_83;
  }
}
function updateRegion_text_85(instance, scope, refs) {
  const __next_text_85 = String(scope.world.localWeather.detail ?? '');
  if (refs[85].data !== __next_text_85) {
    refs[85].data = __next_text_85;
  }
}
function updateRegion_loop_113(instance, scope, refs) {
  updateForLoop_113(instance, scope);
}
function updateRegion_attribute_124_class(instance, scope, refs) {
  const __value_124_class = 'perspective ' + (scope.perspective.private ? 'private' : '');
  if (
    __value_124_class === false ||
    __value_124_class === null ||
    __value_124_class === undefined
  ) {
    if (refs[124].hasAttribute('class')) {
      refs[124].removeAttribute('class');
    }
  } else if (__value_124_class === true) {
    if (!refs[124].hasAttribute('class')) {
      refs[124].setAttribute('class', '');
    }
  } else {
    refs[124].setAttribute('class', String(__value_124_class));
  }
}
function updateRegion_text_117(instance, scope, refs) {
  const __next_text_117 = String(scope.perspective.name ?? '');
  if (refs[117].data !== __next_text_117) {
    refs[117].data = __next_text_117;
  }
}
function updateRegion_text_119(instance, scope, refs) {
  const __next_text_119 = String(
    (scope.perspective.private
      ? 'A private trace is shaping this view'
      : scope.perspective.feeling) ?? '',
  );
  if (refs[119].data !== __next_text_119) {
    refs[119].data = __next_text_119;
  }
}
function updateRegion_text_122(instance, scope, refs) {
  const __next_text_122 = String((scope.perspective.private ? 'only you' : 'shared') ?? '');
  if (refs[122].data !== __next_text_122) {
    refs[122].data = __next_text_122;
  }
}
function updateRegion_conditional_127(instance, scope, refs) {
  updateConditional_127(instance, scope);
}
function updateRegion_text_132(instance, scope, refs) {
  const __next_text_132 = String(scope.world.opening.title ?? '');
  if (refs[132].data !== __next_text_132) {
    refs[132].data = __next_text_132;
  }
}
function updateRegion_text_134(instance, scope, refs) {
  const __next_text_134 = String(scope.world.opening.body ?? '');
  if (refs[134].data !== __next_text_134) {
    refs[134].data = __next_text_134;
  }
}
function updateRegion_text_136(instance, scope, refs) {
  const __next_text_136 = String(scope.world.opening.invitation ?? '');
  if (refs[136].data !== __next_text_136) {
    refs[136].data = __next_text_136;
  }
}
function updateRegion_text_139(instance, scope, refs) {
  const __next_text_139 = String(scope.world.opening.why ?? '');
  if (refs[139].data !== __next_text_139) {
    refs[139].data = __next_text_139;
  }
}
function updateRegion_loop_153(instance, scope, refs) {
  updateForLoop_153(instance, scope);
}
function updateRegion_text_156(instance, scope, refs) {
  const __next_text_156 = String(scope.rhythm.confidence ?? '');
  if (refs[156].data !== __next_text_156) {
    refs[156].data = __next_text_156;
  }
}
function updateRegion_text_158(instance, scope, refs) {
  const __next_text_158 = String(scope.rhythm.title ?? '');
  if (refs[158].data !== __next_text_158) {
    refs[158].data = __next_text_158;
  }
}
function updateRegion_text_160(instance, scope, refs) {
  const __next_text_160 = String(scope.rhythm.observation ?? '');
  if (refs[160].data !== __next_text_160) {
    refs[160].data = __next_text_160;
  }
}
function updateRegion_conditional_178(instance, scope, refs) {
  updateConditional_178(instance, scope);
}
function updateRegion_loop_187(instance, scope, refs) {
  updateForLoop_187(instance, scope);
}
function updateRegion_attribute_193_class(instance, scope, refs) {
  const __value_193_class = scope.bloomClass(scope.bloom);
  if (
    __value_193_class === false ||
    __value_193_class === null ||
    __value_193_class === undefined
  ) {
    if (refs[193].hasAttribute('class')) {
      refs[193].removeAttribute('class');
    }
  } else if (__value_193_class === true) {
    if (!refs[193].hasAttribute('class')) {
      refs[193].setAttribute('class', '');
    }
  } else {
    refs[193].setAttribute('class', String(__value_193_class));
  }
}
function updateRegion_text_191(instance, scope, refs) {
  const __next_text_191 = String((scope.bloom.private ? 'private' : scope.bloom.dateLabel) ?? '');
  if (refs[191].data !== __next_text_191) {
    refs[191].data = __next_text_191;
  }
}
function updateRegion_conditional_194(instance, scope, refs) {
  updateConditional_194(instance, scope);
}
function updateRegion_text_197(instance, scope, refs) {
  const __next_text_197 = String(
    (scope.selectedBloom.chapter || scope.selectedBloom.dateLabel) ?? '',
  );
  if (refs[197].data !== __next_text_197) {
    refs[197].data = __next_text_197;
  }
}
function updateRegion_text_199(instance, scope, refs) {
  const __next_text_199 = String(scope.selectedBloom.title ?? '');
  if (refs[199].data !== __next_text_199) {
    refs[199].data = __next_text_199;
  }
}
function updateRegion_text_201(instance, scope, refs) {
  const __next_text_201 = String(scope.selectedBloom.detail ?? '');
  if (refs[201].data !== __next_text_201) {
    refs[201].data = __next_text_201;
  }
}
function updateRegion_text_203(instance, scope, refs) {
  const __next_text_203 = String(
    (scope.selectedBloom.private ? 'Only visible to you' : 'Held in shared memory') ?? '',
  );
  if (refs[203].data !== __next_text_203) {
    refs[203].data = __next_text_203;
  }
}
function updateRegion_conditional_209(instance, scope, refs) {
  updateConditional_209(instance, scope);
}
function updateRegion_loop_216(instance, scope, refs) {
  updateForLoop_216(instance, scope);
}
function updateRegion_text_220(instance, scope, refs) {
  const __next_text_220 = String(scope.ritual.cadence ?? '');
  if (refs[220].data !== __next_text_220) {
    refs[220].data = __next_text_220;
  }
}
function updateRegion_text_222(instance, scope, refs) {
  const __next_text_222 = String(scope.ritual.title ?? '');
  if (refs[222].data !== __next_text_222) {
    refs[222].data = __next_text_222;
  }
}
function updateRegion_text_224(instance, scope, refs) {
  const __next_text_224 = String(scope.ritual.description ?? '');
  if (refs[224].data !== __next_text_224) {
    refs[224].data = __next_text_224;
  }
}
function updateRegion_text_227(instance, scope, refs) {
  const __next_text_227 = String(scope.ritual.createdBy ?? '');
  if (refs[227].data !== __next_text_227) {
    refs[227].data = __next_text_227;
  }
}
function updateRegion_conditional_232(instance, scope, refs) {
  updateConditional_232(instance, scope);
}
function updateRegion_loop_258(instance, scope, refs) {
  updateForLoop_258(instance, scope);
}
function updateRegion_text_262(instance, scope, refs) {
  const __next_text_262 = String(scope.source.label ?? '');
  if (refs[262].data !== __next_text_262) {
    refs[262].data = __next_text_262;
  }
}
function updateRegion_text_264(instance, scope, refs) {
  const __next_text_264 = String(scope.source.detail ?? '');
  if (refs[264].data !== __next_text_264) {
    refs[264].data = __next_text_264;
  }
}
function updateRegion_text_268(instance, scope, refs) {
  const __next_text_268 = String(scope.observedLabel() ?? '');
  if (refs[268].data !== __next_text_268) {
    refs[268].data = __next_text_268;
  }
}
function updateRegion_conditional_273(instance, scope, refs) {
  updateConditional_273(instance, scope);
}
function updateRegion_attribute_283_class(instance, scope, refs) {
  const __value_283_class = scope.pulseClass('need: a little quiet');
  if (
    __value_283_class === false ||
    __value_283_class === null ||
    __value_283_class === undefined
  ) {
    if (refs[283].hasAttribute('class')) {
      refs[283].removeAttribute('class');
    }
  } else if (__value_283_class === true) {
    if (!refs[283].hasAttribute('class')) {
      refs[283].setAttribute('class', '');
    }
  } else {
    refs[283].setAttribute('class', String(__value_283_class));
  }
}
function updateRegion_attribute_286_class(instance, scope, refs) {
  const __value_286_class = scope.pulseClass('hope: some closeness');
  if (
    __value_286_class === false ||
    __value_286_class === null ||
    __value_286_class === undefined
  ) {
    if (refs[286].hasAttribute('class')) {
      refs[286].removeAttribute('class');
    }
  } else if (__value_286_class === true) {
    if (!refs[286].hasAttribute('class')) {
      refs[286].setAttribute('class', '');
    }
  } else {
    refs[286].setAttribute('class', String(__value_286_class));
  }
}
function updateRegion_attribute_289_class(instance, scope, refs) {
  const __value_289_class = scope.pulseClass('bringing warmth');
  if (
    __value_289_class === false ||
    __value_289_class === null ||
    __value_289_class === undefined
  ) {
    if (refs[289].hasAttribute('class')) {
      refs[289].removeAttribute('class');
    }
  } else if (__value_289_class === true) {
    if (!refs[289].hasAttribute('class')) {
      refs[289].setAttribute('class', '');
    }
  } else {
    refs[289].setAttribute('class', String(__value_289_class));
  }
}
function updateRegion_attribute_292_class(instance, scope, refs) {
  const __value_292_class = scope.pulseClass('need: room to exhale');
  if (
    __value_292_class === false ||
    __value_292_class === null ||
    __value_292_class === undefined
  ) {
    if (refs[292].hasAttribute('class')) {
      refs[292].removeAttribute('class');
    }
  } else if (__value_292_class === true) {
    if (!refs[292].hasAttribute('class')) {
      refs[292].setAttribute('class', '');
    }
  } else {
    refs[292].setAttribute('class', String(__value_292_class));
  }
}
function updateRegion_attribute_296_class(instance, scope, refs) {
  const __value_296_class = scope.energyClass(1);
  if (
    __value_296_class === false ||
    __value_296_class === null ||
    __value_296_class === undefined
  ) {
    if (refs[296].hasAttribute('class')) {
      refs[296].removeAttribute('class');
    }
  } else if (__value_296_class === true) {
    if (!refs[296].hasAttribute('class')) {
      refs[296].setAttribute('class', '');
    }
  } else {
    refs[296].setAttribute('class', String(__value_296_class));
  }
}
function updateRegion_attribute_297_class(instance, scope, refs) {
  const __value_297_class = scope.energyClass(2);
  if (
    __value_297_class === false ||
    __value_297_class === null ||
    __value_297_class === undefined
  ) {
    if (refs[297].hasAttribute('class')) {
      refs[297].removeAttribute('class');
    }
  } else if (__value_297_class === true) {
    if (!refs[297].hasAttribute('class')) {
      refs[297].setAttribute('class', '');
    }
  } else {
    refs[297].setAttribute('class', String(__value_297_class));
  }
}
function updateRegion_attribute_298_class(instance, scope, refs) {
  const __value_298_class = scope.energyClass(3);
  if (
    __value_298_class === false ||
    __value_298_class === null ||
    __value_298_class === undefined
  ) {
    if (refs[298].hasAttribute('class')) {
      refs[298].removeAttribute('class');
    }
  } else if (__value_298_class === true) {
    if (!refs[298].hasAttribute('class')) {
      refs[298].setAttribute('class', '');
    }
  } else {
    refs[298].setAttribute('class', String(__value_298_class));
  }
}
function updateRegion_attribute_299_class(instance, scope, refs) {
  const __value_299_class = scope.energyClass(4);
  if (
    __value_299_class === false ||
    __value_299_class === null ||
    __value_299_class === undefined
  ) {
    if (refs[299].hasAttribute('class')) {
      refs[299].removeAttribute('class');
    }
  } else if (__value_299_class === true) {
    if (!refs[299].hasAttribute('class')) {
      refs[299].setAttribute('class', '');
    }
  } else {
    refs[299].setAttribute('class', String(__value_299_class));
  }
}
function updateRegion_attribute_300_class(instance, scope, refs) {
  const __value_300_class = scope.energyClass(5);
  if (
    __value_300_class === false ||
    __value_300_class === null ||
    __value_300_class === undefined
  ) {
    if (refs[300].hasAttribute('class')) {
      refs[300].removeAttribute('class');
    }
  } else if (__value_300_class === true) {
    if (!refs[300].hasAttribute('class')) {
      refs[300].setAttribute('class', '');
    }
  } else {
    refs[300].setAttribute('class', String(__value_300_class));
  }
}
function updateRegion_attribute_303_value(instance, scope, refs) {
  const __value_303_value = scope.draftFeeling;
  const __next_303_value = __value_303_value ?? '';
  const __next_string_303_value = String(__next_303_value);
  if (refs[303].value !== __next_string_303_value) {
    refs[303].value = __next_string_303_value;
  }
  refs[303].setAttribute('value', __next_string_303_value);
}
function updateRegion_attribute_305_value(instance, scope, refs) {
  const __value_305_value = scope.draftNote;
  const __next_305_value = __value_305_value ?? '';
  const __next_string_305_value = String(__next_305_value);
  if (refs[305].value !== __next_string_305_value) {
    refs[305].value = __next_string_305_value;
  }
  refs[305].setAttribute('value', __next_string_305_value);
}
function updateRegion_attribute_310_class(instance, scope, refs) {
  const __value_310_class = scope.visibilityClass('private');
  if (
    __value_310_class === false ||
    __value_310_class === null ||
    __value_310_class === undefined
  ) {
    if (refs[310].hasAttribute('class')) {
      refs[310].removeAttribute('class');
    }
  } else if (__value_310_class === true) {
    if (!refs[310].hasAttribute('class')) {
      refs[310].setAttribute('class', '');
    }
  } else {
    refs[310].setAttribute('class', String(__value_310_class));
  }
}
function updateRegion_attribute_313_class(instance, scope, refs) {
  const __value_313_class = scope.visibilityClass('shared');
  if (
    __value_313_class === false ||
    __value_313_class === null ||
    __value_313_class === undefined
  ) {
    if (refs[313].hasAttribute('class')) {
      refs[313].removeAttribute('class');
    }
  } else if (__value_313_class === true) {
    if (!refs[313].hasAttribute('class')) {
      refs[313].setAttribute('class', '');
    }
  } else {
    refs[313].setAttribute('class', String(__value_313_class));
  }
}
function updateRegion_attribute_316_disabled(instance, scope, refs) {
  const __value_316_disabled = scope.busy || !scope.draftFeeling;
  const __next_316_disabled = Boolean(__value_316_disabled);
  if (refs[316].disabled !== __next_316_disabled) {
    refs[316].disabled = __next_316_disabled;
  }
  const __has_attr_316_disabled = refs[316].hasAttribute('disabled');
  if (__next_316_disabled) {
    if (!__has_attr_316_disabled) {
      refs[316].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_316_disabled) {
      refs[316].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_315(instance, scope, refs) {
  const __next_text_315 = String(
    (scope.busy
      ? 'Holding…'
      : scope.draftVisibility === 'private'
        ? 'Shape only my lens'
        : 'Shape the shared hearth') ?? '',
  );
  if (refs[315].data !== __next_text_315) {
    refs[315].data = __next_text_315;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_text_0(instance, scope, refs);
  updateRegion_conditional_6(instance, scope, refs);
  updateRegion_loop_14(instance, scope, refs);
  updateRegion_text_22(instance, scope, refs);
  updateRegion_attribute_27_class(instance, scope, refs);
  updateRegion_attribute_29_class(instance, scope, refs);
  updateRegion_attribute_31_class(instance, scope, refs);
  updateRegion_attribute_33_class(instance, scope, refs);
  updateRegion_text_35(instance, scope, refs);
  updateRegion_conditional_43(instance, scope, refs);
  updateRegion_conditional_48(instance, scope, refs);
  updateRegion_conditional_55(instance, scope, refs);
  updateRegion_conditional_61(instance, scope, refs);
  updateRegion_conditional_178(instance, scope, refs);
  updateRegion_conditional_209(instance, scope, refs);
  updateRegion_conditional_232(instance, scope, refs);
  updateRegion_conditional_273(instance, scope, refs);
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
    dirtySet.has('showTrace') ||
    dirtyRegionSet.has(1)
  ) {
    updateRegion_text_0(instance, scope, refs);
  }
  if (dirtySet.has('world') || dirtyRegionSet.has(2)) {
    updateRegion_conditional_6(instance, scope, refs);
  }
  if (
    dirtySet.has('participants') ||
    dirtySet.has('personClass') ||
    dirtySet.has('viewer') ||
    dirtyRegionSet.has(3)
  ) {
    updateRegion_loop_14(instance, scope, refs);
  }
  if (dirtySet.has('world') || dirtyRegionSet.has(4)) {
    updateRegion_text_22(instance, scope, refs);
  }
  if (dirtySet.has('navClass') || dirtySet.has('active') || dirtyRegionSet.has(5)) {
    updateRegion_attribute_27_class(instance, scope, refs);
  }
  if (dirtySet.has('navClass') || dirtySet.has('active') || dirtyRegionSet.has(6)) {
    updateRegion_attribute_29_class(instance, scope, refs);
  }
  if (dirtySet.has('navClass') || dirtySet.has('active') || dirtyRegionSet.has(7)) {
    updateRegion_attribute_31_class(instance, scope, refs);
  }
  if (dirtySet.has('navClass') || dirtySet.has('active') || dirtyRegionSet.has(8)) {
    updateRegion_attribute_33_class(instance, scope, refs);
  }
  if (
    dirtySet.has('viewerName') ||
    dirtySet.has('participants') ||
    dirtySet.has('viewer') ||
    dirtyRegionSet.has(9)
  ) {
    updateRegion_text_35(instance, scope, refs);
  }
  if (dirtySet.has('errorMessage') || dirtyRegionSet.has(10)) {
    updateRegion_conditional_43(instance, scope, refs);
  }
  if (dirtySet.has('pulseResult') || dirtyRegionSet.has(11)) {
    updateRegion_conditional_48(instance, scope, refs);
  }
  if (dirtySet.has('world') || dirtyRegionSet.has(12)) {
    updateRegion_conditional_55(instance, scope, refs);
  }
  if (
    dirtySet.has('world') ||
    dirtySet.has('active') ||
    dirtySet.has('energyWord') ||
    dirtyRegionSet.has(13)
  ) {
    updateRegion_conditional_61(instance, scope, refs);
  }
  if (
    dirtySet.has('world') ||
    dirtySet.has('active') ||
    dirtySet.has('bloomClass') ||
    dirtySet.has('selectedBloom') ||
    dirtyRegionSet.has(14)
  ) {
    updateRegion_conditional_178(instance, scope, refs);
  }
  if (dirtySet.has('world') || dirtySet.has('active') || dirtyRegionSet.has(15)) {
    updateRegion_conditional_209(instance, scope, refs);
  }
  if (
    dirtySet.has('world') ||
    dirtySet.has('active') ||
    dirtySet.has('observedLabel') ||
    dirtyRegionSet.has(16)
  ) {
    updateRegion_conditional_232(instance, scope, refs);
  }
  if (
    dirtySet.has('showTrace') ||
    dirtySet.has('pulseClass') ||
    dirtySet.has('draftFeeling') ||
    dirtySet.has('energyClass') ||
    dirtySet.has('draftEnergy') ||
    dirtySet.has('draftNote') ||
    dirtySet.has('visibilityClass') ||
    dirtySet.has('draftVisibility') ||
    dirtySet.has('busy') ||
    dirtyRegionSet.has(17)
  ) {
    updateRegion_conditional_273(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[8] === true) {
  } else {
  }
  const __records_16 = refs[16] ?? [];
  for (const record of __records_16) {
    if (record.handle && typeof record.handle.destroy === 'function') {
      record.handle.destroy();
    } else if (typeof record.destroy === 'function') {
      record.destroy();
    }
  }
  if (refs[45] === true) {
  } else {
  }
  if (refs[50] === true) {
  } else {
  }
  if (refs[57] === true) {
  } else {
  }
  if (refs[63] === true) {
    const __records_115 = refs[115] ?? [];
    for (const record of __records_115) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    if (refs[129] === true) {
    } else {
    }
    const __records_155 = refs[155] ?? [];
    for (const record of __records_155) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
  if (refs[180] === true) {
    const __records_189 = refs[189] ?? [];
    for (const record of __records_189) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    if (refs[196] === true) {
    } else {
    }
  } else {
  }
  if (refs[211] === true) {
    const __records_218 = refs[218] ?? [];
    for (const record of __records_218) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
  if (refs[234] === true) {
    const __records_260 = refs[260] ?? [];
    for (const record of __records_260) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
  if (refs[275] === true) {
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
