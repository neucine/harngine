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
function createConditionalFragment_13(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_17 = document.createElement('div');
    refs[17] = __ref_17;
    __ref_17.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_17.setAttribute('class', 'error');
    const __ref_16 = document.createTextNode('');
    refs[16] = __ref_16;
    __ref_17.append(__ref_16);
    fragment.append(__ref_17);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_13(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_13(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.errorMessage);
  if (refs[15] !== next) {
    const previous = refs[15];
    destroyConditionalBranch_13(instance, previous === true);
    refs[15] = next;
    replaceBetween(refs[13], refs[14], createConditionalFragment_13(instance, scope, next));
  }
  if (next) {
    updateRegion_text_16(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_18(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_30 = document.createElement('section');
    refs[30] = __ref_30;
    __ref_30.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_30.setAttribute('class', 'arrival');
    const __ref_21 = document.createElement('div');
    refs[21] = __ref_21;
    __ref_21.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_21.setAttribute('class', 'orb');
    __ref_30.append(__ref_21);
    const __ref_22 = document.createElement('p');
    refs[22] = __ref_22;
    __ref_22.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_22.setAttribute('class', 'eyebrow');
    __ref_22.append(document.createTextNode('Opening a thought-space'));
    __ref_30.append(__ref_22);
    const __ref_24 = document.createElement('h1');
    refs[24] = __ref_24;
    __ref_24.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_24.append(document.createTextNode('Material is arriving'));
    const __ref_23 = document.createElement('br');
    refs[23] = __ref_23;
    __ref_23.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_24.append(__ref_23);
    __ref_24.append(document.createTextNode('from three directions.'));
    __ref_30.append(__ref_24);
    const __ref_25 = document.createElement('p');
    refs[25] = __ref_25;
    __ref_25.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_25.append(
      document.createTextNode('Sources are being kept apart long enough to disagree.'),
    );
    __ref_30.append(__ref_25);
    const __ref_29 = document.createElement('div');
    refs[29] = __ref_29;
    __ref_29.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_29.setAttribute('class', 'arrival-agents');
    const __ref_26 = document.createElement('span');
    refs[26] = __ref_26;
    __ref_26.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_26.append(document.createTextNode('Archivist'));
    __ref_29.append(__ref_26);
    const __ref_27 = document.createElement('span');
    refs[27] = __ref_27;
    __ref_27.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_27.append(document.createTextNode('Contrarian'));
    __ref_29.append(__ref_27);
    const __ref_28 = document.createElement('span');
    refs[28] = __ref_28;
    __ref_28.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_28.append(document.createTextNode('Metaphorist'));
    __ref_29.append(__ref_28);
    __ref_30.append(__ref_29);
    fragment.append(__ref_30);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_18(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_18(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.space);
  if (refs[20] !== next) {
    const previous = refs[20];
    destroyConditionalBranch_18(instance, previous === true);
    refs[20] = next;
    replaceBetween(refs[18], refs[19], createConditionalFragment_18(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_31(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_61 = document.createElement('section');
    refs[61] = __ref_61;
    __ref_61.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_61.setAttribute('class', 'seed-room');
    const __ref_38 = document.createElement('div');
    refs[38] = __ref_38;
    __ref_38.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_38.setAttribute('class', 'seed-copy');
    const __ref_34 = document.createElement('p');
    refs[34] = __ref_34;
    __ref_34.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_34.setAttribute('class', 'eyebrow');
    __ref_34.append(document.createTextNode('Your first move'));
    __ref_38.append(__ref_34);
    const __ref_36 = document.createElement('h1');
    refs[36] = __ref_36;
    __ref_36.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_36.append(document.createTextNode('Turn three unlikely fragments'));
    const __ref_35 = document.createElement('br');
    refs[35] = __ref_35;
    __ref_35.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_36.append(__ref_35);
    __ref_36.append(document.createTextNode('into one idea worth keeping.'));
    __ref_38.append(__ref_36);
    const __ref_37 = document.createElement('p');
    refs[37] = __ref_37;
    __ref_37.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_37.append(
      document.createTextNode(
        'Start with a live question. Muse will keep the sources attached while you gather, collide, and grow a Spark.',
      ),
    );
    __ref_38.append(__ref_37);
    __ref_61.append(__ref_38);
    const __ref_48 = document.createElement('div');
    refs[48] = __ref_48;
    __ref_48.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_48.setAttribute('class', 'seed-card');
    const __ref_40 = document.createElement('label');
    refs[40] = __ref_40;
    __ref_40.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_40.append(document.createTextNode('What are you trying to see differently?'));
    const __ref_39 = document.createElement('textarea');
    refs[39] = __ref_39;
    __ref_39.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_39.setAttribute('id', 'seed-question');
    __ref_39.setAttribute('rows', '3');
    __ref_39.addEventListener('input', (event) => {
      const resolved = scope.updateSeed;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_40.append(__ref_39);
    __ref_48.append(__ref_40);
    const __ref_41 = document.createElement('button');
    refs[41] = __ref_41;
    __ref_41.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_41.setAttribute('class', 'begin');
    __ref_41.addEventListener('click', (event) => {
      const resolved = scope.beginSeed;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_41.append(document.createTextNode('Enter the material →'));
    __ref_48.append(__ref_41);
    const __ref_46 = document.createElement('div');
    refs[46] = __ref_46;
    __ref_46.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_46.setAttribute('class', 'prepared');
    const __ref_42 = document.createElement('span');
    refs[42] = __ref_42;
    __ref_42.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_42.append(document.createTextNode('Or choose a prepared live seed'));
    __ref_46.append(__ref_42);
    const __ref_43 = document.createElement('button');
    refs[43] = __ref_43;
    __ref_43.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_43.addEventListener('click', (event) => {
      const resolved = scope.preparedOffice;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_43.append(document.createTextNode('What is an office for now?'));
    __ref_46.append(__ref_43);
    const __ref_44 = document.createElement('button');
    refs[44] = __ref_44;
    __ref_44.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_44.addEventListener('click', (event) => {
      const resolved = scope.preparedRitual;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_44.append(document.createTextNode('Which rituals make hybrid teams feel real?'));
    __ref_46.append(__ref_44);
    const __ref_45 = document.createElement('button');
    refs[45] = __ref_45;
    __ref_45.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_45.addEventListener('click', (event) => {
      const resolved = scope.preparedFreedom;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_45.append(document.createTextNode('When does flexibility become infrastructure?'));
    __ref_46.append(__ref_45);
    __ref_48.append(__ref_46);
    const __ref_47 = document.createElement('p');
    refs[47] = __ref_47;
    __ref_47.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_47.setAttribute('class', 'source-note');
    __ref_47.append(
      document.createTextNode(
        'No account or credential needed · OpenAlex, Crossref, and Wikimedia material is already waiting',
      ),
    );
    __ref_48.append(__ref_47);
    __ref_61.append(__ref_48);
    const __ref_60 = document.createElement('div');
    refs[60] = __ref_60;
    __ref_60.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_60.setAttribute('class', 'micro-arc');
    const __ref_50 = document.createElement('span');
    refs[50] = __ref_50;
    __ref_50.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_49 = document.createElement('b');
    refs[49] = __ref_49;
    __ref_49.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_49.append(document.createTextNode('1'));
    __ref_50.append(__ref_49);
    __ref_50.append(document.createTextNode(' Seed'));
    __ref_60.append(__ref_50);
    const __ref_51 = document.createElement('i');
    refs[51] = __ref_51;
    __ref_51.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_60.append(__ref_51);
    const __ref_53 = document.createElement('span');
    refs[53] = __ref_53;
    __ref_53.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_52 = document.createElement('b');
    refs[52] = __ref_52;
    __ref_52.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_52.append(document.createTextNode('2'));
    __ref_53.append(__ref_52);
    __ref_53.append(document.createTextNode(' Gather'));
    __ref_60.append(__ref_53);
    const __ref_54 = document.createElement('i');
    refs[54] = __ref_54;
    __ref_54.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_60.append(__ref_54);
    const __ref_56 = document.createElement('span');
    refs[56] = __ref_56;
    __ref_56.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_55 = document.createElement('b');
    refs[55] = __ref_55;
    __ref_55.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_55.append(document.createTextNode('3'));
    __ref_56.append(__ref_55);
    __ref_56.append(document.createTextNode(' Collide'));
    __ref_60.append(__ref_56);
    const __ref_57 = document.createElement('i');
    refs[57] = __ref_57;
    __ref_57.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_60.append(__ref_57);
    const __ref_59 = document.createElement('span');
    refs[59] = __ref_59;
    __ref_59.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_58 = document.createElement('b');
    refs[58] = __ref_58;
    __ref_58.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_58.append(document.createTextNode('4'));
    __ref_59.append(__ref_58);
    __ref_59.append(document.createTextNode(' Keep a Spark'));
    __ref_60.append(__ref_59);
    __ref_61.append(__ref_60);
    fragment.append(__ref_61);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_31(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_31(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.space && !scope.seedChosen);
  if (refs[33] !== next) {
    const previous = refs[33];
    destroyConditionalBranch_31(instance, previous === true);
    refs[33] = next;
    replaceBetween(refs[31], refs[32], createConditionalFragment_31(instance, scope, next));
  }
  if (next) {
    updateRegion_attribute_39_value(instance, scope, refs);
    updateRegion_attribute_41_disabled(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_62(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_256 = document.createElement('section');
    refs[256] = __ref_256;
    __ref_256.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_256.setAttribute('class', 'workspace');
    const __ref_95 = document.createElement('aside');
    refs[95] = __ref_95;
    __ref_95.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_95.setAttribute('class', 'left-rail');
    const __ref_65 = document.createElement('p');
    refs[65] = __ref_65;
    __ref_65.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_65.setAttribute('class', 'eyebrow');
    __ref_65.append(document.createTextNode('Your seed'));
    __ref_95.append(__ref_65);
    const __ref_67 = document.createElement('h1');
    refs[67] = __ref_67;
    __ref_67.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_66 = document.createTextNode('');
    refs[66] = __ref_66;
    __ref_67.append(__ref_66);
    __ref_95.append(__ref_67);
    const __ref_68 = document.createElement('p');
    refs[68] = __ref_68;
    __ref_68.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_68.setAttribute('class', 'intro');
    __ref_68.append(
      document.createTextNode(
        'Gather two or three fragments that do not obviously belong together. Your active studio perspective will collide them into a grounded Spark.',
      ),
    );
    __ref_95.append(__ref_68);
    const __ref_78 = document.createElement('div');
    refs[78] = __ref_78;
    __ref_78.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_78.setAttribute('class', 'gravity');
    const __ref_72 = document.createElement('div');
    refs[72] = __ref_72;
    __ref_72.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_69 = document.createElement('b');
    refs[69] = __ref_69;
    __ref_69.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_69.append(document.createTextNode('Semantic gravity'));
    __ref_72.append(__ref_69);
    const __ref_71 = document.createElement('span');
    refs[71] = __ref_71;
    __ref_71.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_70 = document.createTextNode('');
    refs[70] = __ref_70;
    __ref_71.append(__ref_70);
    __ref_72.append(__ref_71);
    __ref_78.append(__ref_72);
    const __ref_73 = document.createElement('input');
    refs[73] = __ref_73;
    __ref_73.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_73.setAttribute('type', 'range');
    __ref_73.setAttribute('min', '0');
    __ref_73.setAttribute('max', '2');
    __ref_73.setAttribute('step', '1');
    __ref_73.addEventListener('input', (event) => {
      const resolved = scope.changeGravity;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_78.append(__ref_73);
    const __ref_77 = document.createElement('div');
    refs[77] = __ref_77;
    __ref_77.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_77.setAttribute('class', 'gravity-labels');
    const __ref_74 = document.createElement('small');
    refs[74] = __ref_74;
    __ref_74.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_74.append(document.createTextNode('evidence'));
    __ref_77.append(__ref_74);
    const __ref_75 = document.createElement('small');
    refs[75] = __ref_75;
    __ref_75.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_75.append(document.createTextNode('tension'));
    __ref_77.append(__ref_75);
    const __ref_76 = document.createElement('small');
    refs[76] = __ref_76;
    __ref_76.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_76.append(document.createTextNode('poetry'));
    __ref_77.append(__ref_76);
    __ref_78.append(__ref_77);
    __ref_95.append(__ref_78);
    const __ref_94 = document.createElement('div');
    refs[94] = __ref_94;
    __ref_94.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_94.setAttribute('class', 'agents');
    const __ref_83 = document.createElement('button');
    refs[83] = __ref_83;
    __ref_83.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_83.addEventListener('click', (event) => {
      const resolved = scope.chooseArchivist;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_79 = document.createElement('i');
    refs[79] = __ref_79;
    __ref_79.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_79.append(document.createTextNode('A'));
    __ref_83.append(__ref_79);
    const __ref_82 = document.createElement('span');
    refs[82] = __ref_82;
    __ref_82.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_80 = document.createElement('b');
    refs[80] = __ref_80;
    __ref_80.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_80.append(document.createTextNode('Archivist'));
    __ref_82.append(__ref_80);
    const __ref_81 = document.createElement('small');
    refs[81] = __ref_81;
    __ref_81.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_81.append(document.createTextNode('guards context'));
    __ref_82.append(__ref_81);
    __ref_83.append(__ref_82);
    __ref_94.append(__ref_83);
    const __ref_88 = document.createElement('button');
    refs[88] = __ref_88;
    __ref_88.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_88.addEventListener('click', (event) => {
      const resolved = scope.chooseContrarian;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_84 = document.createElement('i');
    refs[84] = __ref_84;
    __ref_84.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_84.append(document.createTextNode('C'));
    __ref_88.append(__ref_84);
    const __ref_87 = document.createElement('span');
    refs[87] = __ref_87;
    __ref_87.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_85 = document.createElement('b');
    refs[85] = __ref_85;
    __ref_85.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_85.append(document.createTextNode('Contrarian'));
    __ref_87.append(__ref_85);
    const __ref_86 = document.createElement('small');
    refs[86] = __ref_86;
    __ref_86.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_86.append(document.createTextNode('finds the fracture'));
    __ref_87.append(__ref_86);
    __ref_88.append(__ref_87);
    __ref_94.append(__ref_88);
    const __ref_93 = document.createElement('button');
    refs[93] = __ref_93;
    __ref_93.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_93.addEventListener('click', (event) => {
      const resolved = scope.chooseMetaphorist;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_89 = document.createElement('i');
    refs[89] = __ref_89;
    __ref_89.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_89.append(document.createTextNode('M'));
    __ref_93.append(__ref_89);
    const __ref_92 = document.createElement('span');
    refs[92] = __ref_92;
    __ref_92.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_90 = document.createElement('b');
    refs[90] = __ref_90;
    __ref_90.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_90.append(document.createTextNode('Metaphorist'));
    __ref_92.append(__ref_90);
    const __ref_91 = document.createElement('small');
    refs[91] = __ref_91;
    __ref_91.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_91.append(document.createTextNode('listens for images'));
    __ref_92.append(__ref_91);
    __ref_93.append(__ref_92);
    __ref_94.append(__ref_93);
    __ref_95.append(__ref_94);
    __ref_256.append(__ref_95);
    const __ref_201 = document.createElement('section');
    refs[201] = __ref_201;
    __ref_201.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_201.setAttribute('class', 'field');
    __ref_201.setAttribute('aria-label', 'Constellation of creative material');
    const __ref_103 = document.createElement('div');
    refs[103] = __ref_103;
    __ref_103.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_103.setAttribute('class', 'play-path');
    const __ref_96 = document.createElement('span');
    refs[96] = __ref_96;
    __ref_96.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_96.setAttribute('class', 'done');
    __ref_96.append(document.createTextNode('1 · Seed'));
    __ref_103.append(__ref_96);
    const __ref_97 = document.createElement('i');
    refs[97] = __ref_97;
    __ref_97.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_103.append(__ref_97);
    const __ref_98 = document.createElement('span');
    refs[98] = __ref_98;
    __ref_98.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_98.append(document.createTextNode('2 · Gather'));
    __ref_103.append(__ref_98);
    const __ref_99 = document.createElement('i');
    refs[99] = __ref_99;
    __ref_99.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_103.append(__ref_99);
    const __ref_100 = document.createElement('span');
    refs[100] = __ref_100;
    __ref_100.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_100.append(document.createTextNode('3 · Collide'));
    __ref_103.append(__ref_100);
    const __ref_101 = document.createElement('i');
    refs[101] = __ref_101;
    __ref_101.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_103.append(__ref_101);
    const __ref_102 = document.createElement('span');
    refs[102] = __ref_102;
    __ref_102.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_102.append(document.createTextNode('4 · Keep'));
    __ref_103.append(__ref_102);
    __ref_201.append(__ref_103);
    const __ref_113 = document.createElement('div');
    refs[113] = __ref_113;
    __ref_113.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_113.setAttribute('class', 'field-top');
    const __ref_110 = document.createElement('div');
    refs[110] = __ref_110;
    __ref_110.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_105 = document.createElement('span');
    refs[105] = __ref_105;
    __ref_105.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_104 = document.createTextNode('');
    refs[104] = __ref_104;
    __ref_105.append(__ref_104);
    __ref_105.append(document.createTextNode(' awake'));
    __ref_110.append(__ref_105);
    const __ref_107 = document.createElement('span');
    refs[107] = __ref_107;
    __ref_107.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_106 = document.createTextNode('');
    refs[106] = __ref_106;
    __ref_107.append(__ref_106);
    __ref_107.append(document.createTextNode(' sleeping'));
    __ref_110.append(__ref_107);
    const __ref_109 = document.createElement('span');
    refs[109] = __ref_109;
    __ref_109.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_108 = document.createTextNode('');
    refs[108] = __ref_108;
    __ref_109.append(__ref_108);
    __ref_109.append(document.createTextNode(' relations'));
    __ref_110.append(__ref_109);
    __ref_113.append(__ref_110);
    const __ref_112 = document.createElement('p');
    refs[112] = __ref_112;
    __ref_112.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_111 = document.createTextNode('');
    refs[111] = __ref_111;
    __ref_112.append(__ref_111);
    __ref_113.append(__ref_112);
    __ref_201.append(__ref_113);
    const __ref_192 = document.createElement('div');
    refs[192] = __ref_192;
    __ref_192.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_192.setAttribute('class', 'constellation');
    const __ref_114 = document.createElement('div');
    refs[114] = __ref_114;
    __ref_114.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_114.setAttribute('class', 'halo one');
    __ref_192.append(__ref_114);
    const __ref_115 = document.createElement('div');
    refs[115] = __ref_115;
    __ref_115.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_115.setAttribute('class', 'halo two');
    __ref_192.append(__ref_115);
    const __ref_124 = document.createElement('button');
    refs[124] = __ref_124;
    __ref_124.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_124.addEventListener('click', (event) => {
      const resolved = scope.select0;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_117 = document.createElement('span');
    refs[117] = __ref_117;
    __ref_117.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_117.setAttribute('class', 'node-kind');
    const __ref_116 = document.createTextNode('');
    refs[116] = __ref_116;
    __ref_117.append(__ref_116);
    __ref_124.append(__ref_117);
    const __ref_119 = document.createElement('b');
    refs[119] = __ref_119;
    __ref_119.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_118 = document.createTextNode('');
    refs[118] = __ref_118;
    __ref_119.append(__ref_118);
    __ref_124.append(__ref_119);
    const __ref_121 = document.createElement('small');
    refs[121] = __ref_121;
    __ref_121.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_120 = document.createTextNode('');
    refs[120] = __ref_120;
    __ref_121.append(__ref_120);
    __ref_124.append(__ref_121);
    const __ref_123 = document.createElement('i');
    refs[123] = __ref_123;
    __ref_123.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_122 = document.createTextNode('');
    refs[122] = __ref_122;
    __ref_123.append(__ref_122);
    __ref_124.append(__ref_123);
    __ref_192.append(__ref_124);
    const __ref_133 = document.createElement('button');
    refs[133] = __ref_133;
    __ref_133.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_133.addEventListener('click', (event) => {
      const resolved = scope.select1;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_126 = document.createElement('span');
    refs[126] = __ref_126;
    __ref_126.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_126.setAttribute('class', 'node-kind');
    const __ref_125 = document.createTextNode('');
    refs[125] = __ref_125;
    __ref_126.append(__ref_125);
    __ref_133.append(__ref_126);
    const __ref_128 = document.createElement('b');
    refs[128] = __ref_128;
    __ref_128.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_127 = document.createTextNode('');
    refs[127] = __ref_127;
    __ref_128.append(__ref_127);
    __ref_133.append(__ref_128);
    const __ref_130 = document.createElement('small');
    refs[130] = __ref_130;
    __ref_130.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_129 = document.createTextNode('');
    refs[129] = __ref_129;
    __ref_130.append(__ref_129);
    __ref_133.append(__ref_130);
    const __ref_132 = document.createElement('i');
    refs[132] = __ref_132;
    __ref_132.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_131 = document.createTextNode('');
    refs[131] = __ref_131;
    __ref_132.append(__ref_131);
    __ref_133.append(__ref_132);
    __ref_192.append(__ref_133);
    const __ref_142 = document.createElement('button');
    refs[142] = __ref_142;
    __ref_142.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_142.addEventListener('click', (event) => {
      const resolved = scope.select2;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_135 = document.createElement('span');
    refs[135] = __ref_135;
    __ref_135.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_135.setAttribute('class', 'node-kind');
    const __ref_134 = document.createTextNode('');
    refs[134] = __ref_134;
    __ref_135.append(__ref_134);
    __ref_142.append(__ref_135);
    const __ref_137 = document.createElement('b');
    refs[137] = __ref_137;
    __ref_137.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_136 = document.createTextNode('');
    refs[136] = __ref_136;
    __ref_137.append(__ref_136);
    __ref_142.append(__ref_137);
    const __ref_139 = document.createElement('small');
    refs[139] = __ref_139;
    __ref_139.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_138 = document.createTextNode('');
    refs[138] = __ref_138;
    __ref_139.append(__ref_138);
    __ref_142.append(__ref_139);
    const __ref_141 = document.createElement('i');
    refs[141] = __ref_141;
    __ref_141.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_140 = document.createTextNode('');
    refs[140] = __ref_140;
    __ref_141.append(__ref_140);
    __ref_142.append(__ref_141);
    __ref_192.append(__ref_142);
    const __ref_151 = document.createElement('button');
    refs[151] = __ref_151;
    __ref_151.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_151.addEventListener('click', (event) => {
      const resolved = scope.select3;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_144 = document.createElement('span');
    refs[144] = __ref_144;
    __ref_144.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_144.setAttribute('class', 'node-kind');
    const __ref_143 = document.createTextNode('');
    refs[143] = __ref_143;
    __ref_144.append(__ref_143);
    __ref_151.append(__ref_144);
    const __ref_146 = document.createElement('b');
    refs[146] = __ref_146;
    __ref_146.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_145 = document.createTextNode('');
    refs[145] = __ref_145;
    __ref_146.append(__ref_145);
    __ref_151.append(__ref_146);
    const __ref_148 = document.createElement('small');
    refs[148] = __ref_148;
    __ref_148.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_147 = document.createTextNode('');
    refs[147] = __ref_147;
    __ref_148.append(__ref_147);
    __ref_151.append(__ref_148);
    const __ref_150 = document.createElement('i');
    refs[150] = __ref_150;
    __ref_150.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_149 = document.createTextNode('');
    refs[149] = __ref_149;
    __ref_150.append(__ref_149);
    __ref_151.append(__ref_150);
    __ref_192.append(__ref_151);
    const __ref_160 = document.createElement('button');
    refs[160] = __ref_160;
    __ref_160.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_160.addEventListener('click', (event) => {
      const resolved = scope.select4;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_153 = document.createElement('span');
    refs[153] = __ref_153;
    __ref_153.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_153.setAttribute('class', 'node-kind');
    const __ref_152 = document.createTextNode('');
    refs[152] = __ref_152;
    __ref_153.append(__ref_152);
    __ref_160.append(__ref_153);
    const __ref_155 = document.createElement('b');
    refs[155] = __ref_155;
    __ref_155.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_154 = document.createTextNode('');
    refs[154] = __ref_154;
    __ref_155.append(__ref_154);
    __ref_160.append(__ref_155);
    const __ref_157 = document.createElement('small');
    refs[157] = __ref_157;
    __ref_157.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_156 = document.createTextNode('');
    refs[156] = __ref_156;
    __ref_157.append(__ref_156);
    __ref_160.append(__ref_157);
    const __ref_159 = document.createElement('i');
    refs[159] = __ref_159;
    __ref_159.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_158 = document.createTextNode('');
    refs[158] = __ref_158;
    __ref_159.append(__ref_158);
    __ref_160.append(__ref_159);
    __ref_192.append(__ref_160);
    const __ref_169 = document.createElement('button');
    refs[169] = __ref_169;
    __ref_169.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_169.addEventListener('click', (event) => {
      const resolved = scope.select5;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_162 = document.createElement('span');
    refs[162] = __ref_162;
    __ref_162.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_162.setAttribute('class', 'node-kind');
    const __ref_161 = document.createTextNode('');
    refs[161] = __ref_161;
    __ref_162.append(__ref_161);
    __ref_169.append(__ref_162);
    const __ref_164 = document.createElement('b');
    refs[164] = __ref_164;
    __ref_164.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_163 = document.createTextNode('');
    refs[163] = __ref_163;
    __ref_164.append(__ref_163);
    __ref_169.append(__ref_164);
    const __ref_166 = document.createElement('small');
    refs[166] = __ref_166;
    __ref_166.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_165 = document.createTextNode('');
    refs[165] = __ref_165;
    __ref_166.append(__ref_165);
    __ref_169.append(__ref_166);
    const __ref_168 = document.createElement('i');
    refs[168] = __ref_168;
    __ref_168.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_167 = document.createTextNode('');
    refs[167] = __ref_167;
    __ref_168.append(__ref_167);
    __ref_169.append(__ref_168);
    __ref_192.append(__ref_169);
    const __ref_178 = document.createElement('button');
    refs[178] = __ref_178;
    __ref_178.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_178.addEventListener('click', (event) => {
      const resolved = scope.select6;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_171 = document.createElement('span');
    refs[171] = __ref_171;
    __ref_171.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_171.setAttribute('class', 'node-kind');
    const __ref_170 = document.createTextNode('');
    refs[170] = __ref_170;
    __ref_171.append(__ref_170);
    __ref_178.append(__ref_171);
    const __ref_173 = document.createElement('b');
    refs[173] = __ref_173;
    __ref_173.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_172 = document.createTextNode('');
    refs[172] = __ref_172;
    __ref_173.append(__ref_172);
    __ref_178.append(__ref_173);
    const __ref_175 = document.createElement('small');
    refs[175] = __ref_175;
    __ref_175.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_174 = document.createTextNode('');
    refs[174] = __ref_174;
    __ref_175.append(__ref_174);
    __ref_178.append(__ref_175);
    const __ref_177 = document.createElement('i');
    refs[177] = __ref_177;
    __ref_177.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_176 = document.createTextNode('');
    refs[176] = __ref_176;
    __ref_177.append(__ref_176);
    __ref_178.append(__ref_177);
    __ref_192.append(__ref_178);
    const __ref_187 = document.createElement('button');
    refs[187] = __ref_187;
    __ref_187.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_187.addEventListener('click', (event) => {
      const resolved = scope.select7;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_180 = document.createElement('span');
    refs[180] = __ref_180;
    __ref_180.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_180.setAttribute('class', 'node-kind');
    const __ref_179 = document.createTextNode('');
    refs[179] = __ref_179;
    __ref_180.append(__ref_179);
    __ref_187.append(__ref_180);
    const __ref_182 = document.createElement('b');
    refs[182] = __ref_182;
    __ref_182.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_181 = document.createTextNode('');
    refs[181] = __ref_181;
    __ref_182.append(__ref_181);
    __ref_187.append(__ref_182);
    const __ref_184 = document.createElement('small');
    refs[184] = __ref_184;
    __ref_184.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_183 = document.createTextNode('');
    refs[183] = __ref_183;
    __ref_184.append(__ref_183);
    __ref_187.append(__ref_184);
    const __ref_186 = document.createElement('i');
    refs[186] = __ref_186;
    __ref_186.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_185 = document.createTextNode('');
    refs[185] = __ref_185;
    __ref_186.append(__ref_185);
    __ref_187.append(__ref_186);
    __ref_192.append(__ref_187);
    const __ref_191 = document.createElement('div');
    refs[191] = __ref_191;
    __ref_191.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_191.setAttribute('class', 'center-note');
    const __ref_188 = document.createElement('i');
    refs[188] = __ref_188;
    __ref_188.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_191.append(__ref_188);
    const __ref_190 = document.createElement('span');
    refs[190] = __ref_190;
    __ref_190.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_190.append(document.createTextNode('meaning stays'));
    const __ref_189 = document.createElement('br');
    refs[189] = __ref_189;
    __ref_189.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_190.append(__ref_189);
    __ref_190.append(document.createTextNode('movable'));
    __ref_191.append(__ref_190);
    __ref_192.append(__ref_191);
    __ref_201.append(__ref_192);
    const __ref_200 = document.createElement('div');
    refs[200] = __ref_200;
    __ref_200.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_200.setAttribute('class', 'gesture-bar');
    const __ref_194 = document.createElement('span');
    refs[194] = __ref_194;
    __ref_194.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_193 = document.createTextNode('');
    refs[193] = __ref_193;
    __ref_194.append(__ref_193);
    __ref_194.append(document.createTextNode(' / 3 gathered'));
    __ref_200.append(__ref_194);
    const __ref_196 = document.createElement('button');
    refs[196] = __ref_196;
    __ref_196.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_196.addEventListener('click', (event) => {
      const resolved = scope.makeSpark;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_195 = document.createTextNode('');
    refs[195] = __ref_195;
    __ref_196.append(__ref_195);
    __ref_200.append(__ref_196);
    const __ref_198 = document.createElement('button');
    refs[198] = __ref_198;
    __ref_198.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_198.addEventListener('click', (event) => {
      const resolved = scope.toggleSleep;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_197 = document.createTextNode('');
    refs[197] = __ref_197;
    __ref_198.append(__ref_197);
    __ref_200.append(__ref_198);
    const __ref_199 = document.createElement('button');
    refs[199] = __ref_199;
    __ref_199.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_199.addEventListener('click', (event) => {
      const resolved = scope.clearSelection;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_199.append(document.createTextNode('Release'));
    __ref_200.append(__ref_199);
    __ref_201.append(__ref_200);
    __ref_256.append(__ref_201);
    const __ref_255 = document.createElement('aside');
    refs[255] = __ref_255;
    __ref_255.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_255.setAttribute('class', 'conversation');
    const __ref_202 = document.createComment('if:start');
    const __ref_203 = document.createComment('if:end');
    refs[202] = __ref_202;
    refs[203] = __ref_203;
    refs[204] = undefined;
    __ref_255.append(__ref_202);
    __ref_255.append(__ref_203);
    const __ref_218 = document.createComment('if:start');
    const __ref_219 = document.createComment('if:end');
    refs[218] = __ref_218;
    refs[219] = __ref_219;
    refs[220] = undefined;
    __ref_255.append(__ref_218);
    __ref_255.append(__ref_219);
    const __ref_251 = document.createElement('div');
    refs[251] = __ref_251;
    __ref_251.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_251.setAttribute('class', 'thread');
    const __ref_241 = document.createElement('div');
    refs[241] = __ref_241;
    __ref_241.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_241.setAttribute('class', 'thread-head');
    const __ref_239 = document.createElement('span');
    refs[239] = __ref_239;
    __ref_239.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_238 = document.createTextNode('');
    refs[238] = __ref_238;
    __ref_239.append(__ref_238);
    __ref_241.append(__ref_239);
    const __ref_240 = document.createElement('small');
    refs[240] = __ref_240;
    __ref_240.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_240.append(document.createTextNode('tending this region'));
    __ref_241.append(__ref_240);
    __ref_251.append(__ref_241);
    const __ref_243 = document.createElement('div');
    refs[243] = __ref_243;
    __ref_243.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_243.setAttribute('class', 'message seed');
    const __ref_242 = document.createTextNode('');
    refs[242] = __ref_242;
    __ref_243.append(__ref_242);
    __ref_251.append(__ref_243);
    const __ref_250 = document.createElement('div');
    refs[250] = __ref_250;
    __ref_250.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_245 = document.createElement('div');
    refs[245] = __ref_245;
    __ref_245.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_245.setAttribute('class', 'message mine');
    const __ref_244 = document.createTextNode('');
    refs[244] = __ref_244;
    __ref_245.append(__ref_244);
    __ref_250.append(__ref_245);
    const __ref_249 = document.createElement('div');
    refs[249] = __ref_249;
    __ref_249.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_249.setAttribute('class', 'message agent-message');
    const __ref_247 = document.createElement('b');
    refs[247] = __ref_247;
    __ref_247.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_246 = document.createTextNode('');
    refs[246] = __ref_246;
    __ref_247.append(__ref_246);
    __ref_249.append(__ref_247);
    const __ref_248 = document.createTextNode('');
    refs[248] = __ref_248;
    __ref_249.append(__ref_248);
    __ref_250.append(__ref_249);
    __ref_251.append(__ref_250);
    __ref_255.append(__ref_251);
    const __ref_254 = document.createElement('div');
    refs[254] = __ref_254;
    __ref_254.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_254.setAttribute('class', 'composer');
    const __ref_252 = document.createElement('textarea');
    refs[252] = __ref_252;
    __ref_252.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_252.setAttribute('placeholder', 'What changes if I follow this?');
    __ref_252.setAttribute('rows', '2');
    __ref_252.addEventListener('input', (event) => {
      const resolved = scope.updatePrompt;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_254.append(__ref_252);
    const __ref_253 = document.createElement('button');
    refs[253] = __ref_253;
    __ref_253.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_253.addEventListener('click', (event) => {
      const resolved = scope.askMaterial;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_253.append(document.createTextNode('Ask material ↗'));
    __ref_254.append(__ref_253);
    __ref_255.append(__ref_254);
    __ref_256.append(__ref_255);
    fragment.append(__ref_256);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_62(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[204] === true) {
    } else {
    }
    if (refs[220] === true) {
      if (refs[229] === true) {
      } else {
      }
    } else {
    }
  } else {
  }
}

function updateConditional_62(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.space && scope.seedChosen && !scope.showLineage);
  if (refs[64] !== next) {
    const previous = refs[64];
    destroyConditionalBranch_62(instance, previous === true);
    refs[64] = next;
    replaceBetween(refs[62], refs[63], createConditionalFragment_62(instance, scope, next));
  }
  if (next) {
    updateRegion_text_66(instance, scope, refs);
    updateRegion_text_70(instance, scope, refs);
    updateRegion_attribute_73_value(instance, scope, refs);
    updateRegion_attribute_83_class(instance, scope, refs);
    updateRegion_attribute_88_class(instance, scope, refs);
    updateRegion_attribute_93_class(instance, scope, refs);
    updateRegion_attribute_98_class(instance, scope, refs);
    updateRegion_attribute_100_class(instance, scope, refs);
    updateRegion_attribute_102_class(instance, scope, refs);
    updateRegion_text_104(instance, scope, refs);
    updateRegion_text_106(instance, scope, refs);
    updateRegion_text_108(instance, scope, refs);
    updateRegion_text_111(instance, scope, refs);
    updateRegion_attribute_124_class(instance, scope, refs);
    updateRegion_attribute_124_style(instance, scope, refs);
    updateRegion_text_116(instance, scope, refs);
    updateRegion_text_118(instance, scope, refs);
    updateRegion_text_120(instance, scope, refs);
    updateRegion_text_122(instance, scope, refs);
    updateRegion_attribute_133_class(instance, scope, refs);
    updateRegion_attribute_133_style(instance, scope, refs);
    updateRegion_text_125(instance, scope, refs);
    updateRegion_text_127(instance, scope, refs);
    updateRegion_text_129(instance, scope, refs);
    updateRegion_text_131(instance, scope, refs);
    updateRegion_attribute_142_class(instance, scope, refs);
    updateRegion_attribute_142_style(instance, scope, refs);
    updateRegion_text_134(instance, scope, refs);
    updateRegion_text_136(instance, scope, refs);
    updateRegion_text_138(instance, scope, refs);
    updateRegion_text_140(instance, scope, refs);
    updateRegion_attribute_151_class(instance, scope, refs);
    updateRegion_attribute_151_style(instance, scope, refs);
    updateRegion_text_143(instance, scope, refs);
    updateRegion_text_145(instance, scope, refs);
    updateRegion_text_147(instance, scope, refs);
    updateRegion_text_149(instance, scope, refs);
    updateRegion_attribute_160_class(instance, scope, refs);
    updateRegion_attribute_160_style(instance, scope, refs);
    updateRegion_text_152(instance, scope, refs);
    updateRegion_text_154(instance, scope, refs);
    updateRegion_text_156(instance, scope, refs);
    updateRegion_text_158(instance, scope, refs);
    updateRegion_attribute_169_class(instance, scope, refs);
    updateRegion_attribute_169_style(instance, scope, refs);
    updateRegion_text_161(instance, scope, refs);
    updateRegion_text_163(instance, scope, refs);
    updateRegion_text_165(instance, scope, refs);
    updateRegion_text_167(instance, scope, refs);
    updateRegion_attribute_178_class(instance, scope, refs);
    updateRegion_attribute_178_style(instance, scope, refs);
    updateRegion_text_170(instance, scope, refs);
    updateRegion_text_172(instance, scope, refs);
    updateRegion_text_174(instance, scope, refs);
    updateRegion_text_176(instance, scope, refs);
    updateRegion_attribute_187_class(instance, scope, refs);
    updateRegion_attribute_187_style(instance, scope, refs);
    updateRegion_text_179(instance, scope, refs);
    updateRegion_text_181(instance, scope, refs);
    updateRegion_text_183(instance, scope, refs);
    updateRegion_text_185(instance, scope, refs);
    updateRegion_text_193(instance, scope, refs);
    updateRegion_attribute_196_disabled(instance, scope, refs);
    updateRegion_text_195(instance, scope, refs);
    updateRegion_attribute_198_disabled(instance, scope, refs);
    updateRegion_text_197(instance, scope, refs);
    updateRegion_attribute_199_disabled(instance, scope, refs);
    updateRegion_conditional_202(instance, scope, refs);
    updateRegion_conditional_218(instance, scope, refs);
    updateRegion_text_238(instance, scope, refs);
    updateRegion_text_242(instance, scope, refs);
    updateRegion_attribute_250_class(instance, scope, refs);
    updateRegion_text_244(instance, scope, refs);
    updateRegion_text_246(instance, scope, refs);
    updateRegion_text_248(instance, scope, refs);
    updateRegion_attribute_252_value(instance, scope, refs);
    updateRegion_attribute_253_disabled(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_202(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_217 = document.createElement('section');
    refs[217] = __ref_217;
    __ref_217.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_217.setAttribute('class', 'spark-card');
    const __ref_208 = document.createElement('div');
    refs[208] = __ref_208;
    __ref_208.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_208.setAttribute('class', 'spark-top');
    const __ref_206 = document.createElement('span');
    refs[206] = __ref_206;
    __ref_206.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_206.append(document.createTextNode('New Spark · '));
    const __ref_205 = document.createTextNode('');
    refs[205] = __ref_205;
    __ref_206.append(__ref_205);
    __ref_208.append(__ref_206);
    const __ref_207 = document.createElement('i');
    refs[207] = __ref_207;
    __ref_207.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_207.append(document.createTextNode('✦'));
    __ref_208.append(__ref_207);
    __ref_217.append(__ref_208);
    const __ref_210 = document.createElement('h2');
    refs[210] = __ref_210;
    __ref_210.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_209 = document.createTextNode('');
    refs[209] = __ref_209;
    __ref_210.append(__ref_209);
    __ref_217.append(__ref_210);
    const __ref_212 = document.createElement('p');
    refs[212] = __ref_212;
    __ref_212.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_211 = document.createTextNode('');
    refs[211] = __ref_211;
    __ref_212.append(__ref_211);
    __ref_217.append(__ref_212);
    const __ref_214 = document.createElement('small');
    refs[214] = __ref_214;
    __ref_214.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_213 = document.createTextNode('');
    refs[213] = __ref_213;
    __ref_214.append(__ref_213);
    __ref_217.append(__ref_214);
    const __ref_216 = document.createElement('button');
    refs[216] = __ref_216;
    __ref_216.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_216.addEventListener('click', (event) => {
      const resolved = scope.saveSpark;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_215 = document.createTextNode('');
    refs[215] = __ref_215;
    __ref_216.append(__ref_215);
    __ref_217.append(__ref_216);
    fragment.append(__ref_217);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_202(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_202(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.latestSpark());
  if (refs[204] !== next) {
    const previous = refs[204];
    destroyConditionalBranch_202(instance, previous === true);
    refs[204] = next;
    replaceBetween(refs[202], refs[203], createConditionalFragment_202(instance, scope, next));
  }
  if (next) {
    updateRegion_text_205(instance, scope, refs);
    updateRegion_text_209(instance, scope, refs);
    updateRegion_text_211(instance, scope, refs);
    updateRegion_text_213(instance, scope, refs);
    updateRegion_attribute_216_disabled(instance, scope, refs);
    updateRegion_text_215(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_218(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_233 = document.createElement('div');
    refs[233] = __ref_233;
    __ref_233.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_233.setAttribute('class', 'material-detail');
    const __ref_222 = document.createElement('span');
    refs[222] = __ref_222;
    __ref_222.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_221 = document.createTextNode('');
    refs[221] = __ref_221;
    __ref_222.append(__ref_221);
    __ref_233.append(__ref_222);
    const __ref_224 = document.createElement('h2');
    refs[224] = __ref_224;
    __ref_224.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_223 = document.createTextNode('');
    refs[223] = __ref_223;
    __ref_224.append(__ref_223);
    __ref_233.append(__ref_224);
    const __ref_226 = document.createElement('p');
    refs[226] = __ref_226;
    __ref_226.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    const __ref_225 = document.createTextNode('');
    refs[225] = __ref_225;
    __ref_226.append(__ref_225);
    __ref_233.append(__ref_226);
    const __ref_227 = document.createComment('if:start');
    const __ref_228 = document.createComment('if:end');
    refs[227] = __ref_227;
    refs[228] = __ref_228;
    refs[229] = undefined;
    __ref_233.append(__ref_227);
    __ref_233.append(__ref_228);
    fragment.append(__ref_233);
  } else {
    const __ref_237 = document.createElement('div');
    refs[237] = __ref_237;
    __ref_237.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_237.setAttribute('class', 'material-detail empty-detail');
    const __ref_234 = document.createElement('span');
    refs[234] = __ref_234;
    __ref_234.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_234.setAttribute('class', 'kind-mark');
    __ref_234.append(document.createTextNode('open'));
    __ref_237.append(__ref_234);
    const __ref_235 = document.createElement('h2');
    refs[235] = __ref_235;
    __ref_235.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_235.append(document.createTextNode('Enter the material.'));
    __ref_237.append(__ref_235);
    const __ref_236 = document.createElement('p');
    refs[236] = __ref_236;
    __ref_236.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_236.append(
      document.createTextNode(
        'Choose a node. Nothing here is a step in a funnel; it is a place you can return to.',
      ),
    );
    __ref_237.append(__ref_236);
    fragment.append(__ref_237);
  }
  return fragment;
}

function destroyConditionalBranch_218(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[229] === true) {
    } else {
    }
  } else {
  }
}

function updateConditional_218(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.selectedNode);
  if (refs[220] !== next) {
    const previous = refs[220];
    destroyConditionalBranch_218(instance, previous === true);
    refs[220] = next;
    replaceBetween(refs[218], refs[219], createConditionalFragment_218(instance, scope, next));
  }
  if (next) {
    updateRegion_attribute_222_class(instance, scope, refs);
    updateRegion_text_221(instance, scope, refs);
    updateRegion_text_223(instance, scope, refs);
    updateRegion_text_225(instance, scope, refs);
    updateRegion_conditional_227(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_227(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_232 = document.createElement('div');
    refs[232] = __ref_232;
    __ref_232.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_232.setAttribute('class', 'provenance');
    __ref_232.append(document.createTextNode('↳ '));
    const __ref_230 = document.createTextNode('');
    refs[230] = __ref_230;
    __ref_232.append(__ref_230);
    __ref_232.append(document.createTextNode(' provenance link'));
    const __ref_231 = document.createTextNode('');
    refs[231] = __ref_231;
    __ref_232.append(__ref_231);
    __ref_232.append(document.createTextNode(' retained'));
    fragment.append(__ref_232);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_227(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_227(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.selectedNode.evidence.length > 0);
  if (refs[229] !== next) {
    const previous = refs[229];
    destroyConditionalBranch_227(instance, previous === true);
    refs[229] = next;
    replaceBetween(refs[227], refs[228], createConditionalFragment_227(instance, scope, next));
  }
  if (next) {
    updateRegion_text_230(instance, scope, refs);
    updateRegion_text_231(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_257(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_281 = document.createElement('section');
    refs[281] = __ref_281;
    __ref_281.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_281.setAttribute('class', 'lineage-view');
    const __ref_264 = document.createElement('div');
    refs[264] = __ref_264;
    __ref_264.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_264.setAttribute('class', 'lineage-hero');
    const __ref_260 = document.createElement('p');
    refs[260] = __ref_260;
    __ref_260.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_260.setAttribute('class', 'eyebrow');
    __ref_260.append(document.createTextNode('Lineage playback'));
    __ref_264.append(__ref_260);
    const __ref_262 = document.createElement('h1');
    refs[262] = __ref_262;
    __ref_262.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_262.append(document.createTextNode('The space remembers'));
    const __ref_261 = document.createElement('br');
    refs[261] = __ref_261;
    __ref_261.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_262.append(__ref_261);
    __ref_262.append(document.createTextNode('how it changed.'));
    __ref_264.append(__ref_262);
    const __ref_263 = document.createElement('p');
    refs[263] = __ref_263;
    __ref_263.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_263.append(
      document.createTextNode(
        'Rejected and dormant directions remain part of the record. Re-entry does not mean starting over.',
      ),
    );
    __ref_264.append(__ref_263);
    __ref_281.append(__ref_264);
    const __ref_280 = document.createElement('div');
    refs[280] = __ref_280;
    __ref_280.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
    __ref_280.setAttribute('class', 'timeline');
    const __ref_265 = document.createComment('for:start');
    const __ref_266 = document.createComment('for:end');
    refs[265] = __ref_265;
    refs[266] = __ref_266;
    refs[267] = [];
    __ref_280.append(__ref_265);
    __ref_280.append(__ref_266);
    __ref_281.append(__ref_280);
    fragment.append(__ref_281);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_257(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_267 = refs[267] ?? [];
    for (const record of __records_267) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_257(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.space && scope.seedChosen && scope.showLineage);
  if (refs[259] !== next) {
    const previous = refs[259];
    destroyConditionalBranch_257(instance, previous === true);
    refs[259] = next;
    replaceBetween(refs[257], refs[258], createConditionalFragment_257(instance, scope, next));
  }
  if (next) {
    updateRegion_loop_265(instance, scope, refs);
  } else {
  }
}

function createForEntry_265(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['event']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['event']: currentItem };
    updateRegion_text_268(instance, loopScope, entryRefs);
    updateRegion_text_271(instance, loopScope, entryRefs);
    updateRegion_text_273(instance, loopScope, entryRefs);
    updateRegion_text_275(instance, loopScope, entryRefs);
    updateRegion_text_276(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_279 = document.createElement('article');
  entryRefs[279] = __ref_279;
  __ref_279.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_269 = document.createElement('time');
  entryRefs[269] = __ref_269;
  __ref_269.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_268 = document.createTextNode('');
  entryRefs[268] = __ref_268;
  __ref_269.append(__ref_268);
  __ref_279.append(__ref_269);
  const __ref_270 = document.createElement('i');
  entryRefs[270] = __ref_270;
  __ref_270.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_279.append(__ref_270);
  const __ref_278 = document.createElement('div');
  entryRefs[278] = __ref_278;
  __ref_278.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_272 = document.createElement('span');
  entryRefs[272] = __ref_272;
  __ref_272.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_271 = document.createTextNode('');
  entryRefs[271] = __ref_271;
  __ref_272.append(__ref_271);
  __ref_278.append(__ref_272);
  const __ref_274 = document.createElement('h2');
  entryRefs[274] = __ref_274;
  __ref_274.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_273 = document.createTextNode('');
  entryRefs[273] = __ref_273;
  __ref_274.append(__ref_273);
  __ref_278.append(__ref_274);
  const __ref_277 = document.createElement('small');
  entryRefs[277] = __ref_277;
  __ref_277.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_275 = document.createTextNode('');
  entryRefs[275] = __ref_275;
  __ref_277.append(__ref_275);
  __ref_277.append(document.createTextNode(' material reference'));
  const __ref_276 = document.createTextNode('');
  entryRefs[276] = __ref_276;
  __ref_277.append(__ref_276);
  __ref_278.append(__ref_277);
  __ref_279.append(__ref_278);
  fragment.append(__ref_279);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_265(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.reversedLineage() ?? [];
  const previous = refs[267] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[266]);
    } else {
      record = createForEntry_265(instance, scope, item, refs[266]);
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
  refs[267] = nextRecords;
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
  let space = null;
  let busy = false;
  let initialized = false;
  let starting = false;
  let errorMessage = '';
  let selectedIds = [];
  let selectedNode = null;
  let perspective = 'contrarian';
  let prompt = '';
  let gravity = '1';
  let showLineage = false;
  let seedChosen = false;
  let seed = '';
  let seedDraft = 'What is an office for when focused work can happen anywhere?';
  function boot() {
    if (!initialized && typeof window !== 'undefined') {
      initialized = true;
      queueMicrotask(load);
      window.setInterval(() => {
        if (!busy && !space) load();
      }, 900);
    }
    return '';
  }
  async function api(path, body) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'x-muse-token': props.token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'The space could not respond');
    return value;
  }
  async function load() {
    try {
      const next = await api('/api/state');
      if (next.status === 'idle' && !starting) {
        starting = true;
        await api('/api/research', next.defaults);
        return load();
      }
      queueMicrotask(() => applyState(next));
    } catch (error) {
      queueMicrotask(() => {
        errorMessage = error instanceof Error ? error.message : 'The space could not open';
      });
    }
  }
  function applyState(next) {
    data = next;
    if (next.space) space = next.space;
    syncSelected();
    errorMessage = '';
  }
  function updateSeed(event) {
    seedDraft = event.currentTarget.value;
  }
  function beginSeed() {
    if (seedDraft.trim().length >= 8) {
      seed = seedDraft.trim();
      seedChosen = true;
    }
  }
  function preparedOffice() {
    seedDraft = 'What is an office for when focused work can happen anywhere?';
    beginSeed();
  }
  function preparedRitual() {
    seedDraft = 'Which rituals make hybrid teams feel real?';
    beginSeed();
  }
  function preparedFreedom() {
    seedDraft = 'When does flexibility become infrastructure?';
    beginSeed();
  }
  function headerStatus() {
    if (!space) return 'Material arriving';
    const kept = (space.sparks || []).filter((item) => item.saved).length;
    return kept > 0 ? `${kept} Spark${kept === 1 ? '' : 's'} incubating` : 'Space remembers';
  }
  function lineageLabel() {
    if (!space) return 'See lineage';
    const kept = (space.sparks || []).filter((item) => item.saved).length;
    return kept > 0 ? `Lineage · ${kept} incubating` : 'See lineage';
  }
  function syncSelected() {
    if (!space) return;
    selectedIds = selectedIds.filter((id) => space.nodes.some((node) => node.id === id));
    selectedNode =
      selectedIds.length > 0
        ? space.nodes.find((node) => node.id === selectedIds[selectedIds.length - 1])
        : null;
  }
  function activeNodes() {
    return space.nodes.filter((node) => !node.dormant);
  }
  function dormantCount() {
    return space.nodes.filter((node) => node.dormant).length;
  }
  function visibleNodes() {
    return space.nodes;
  }
  function nodeAt(index) {
    return space.nodes[index];
  }
  function selectedDormant() {
    return Boolean(selectedNode && selectedNode.dormant);
  }
  function selectNode(id) {
    const existing = selectedIds.indexOf(id);
    if (existing >= 0) selectedIds = selectedIds.filter((item) => item !== id);
    else selectedIds = [...selectedIds.slice(-2), id];
    syncSelected();
  }
  function clearSelection() {
    selectedIds = [];
    selectedNode = null;
  }
  function select0() {
    selectNode(nodeAt(0).id);
  }
  function select1() {
    selectNode(nodeAt(1).id);
  }
  function select2() {
    selectNode(nodeAt(2).id);
  }
  function select3() {
    selectNode(nodeAt(3).id);
  }
  function select4() {
    selectNode(nodeAt(4).id);
  }
  function select5() {
    selectNode(nodeAt(5).id);
  }
  function select6() {
    selectNode(nodeAt(6).id);
  }
  function select7() {
    selectNode(nodeAt(7).id);
  }
  function changeGravity(event) {
    gravity = event.currentTarget.value;
  }
  function gravityLabel() {
    return gravity === '0'
      ? 'sources pull inward'
      : gravity === '2'
        ? 'motifs pull inward'
        : 'tensions pull inward';
  }
  function nodeStyle(node) {
    let x = node.x;
    let y = node.y;
    if (gravity === '0' && node.kind === 'source') {
      x = 47 + (node.x - 47) * 0.35;
      y = 42 + (node.y - 42) * 0.35;
    }
    if (gravity === '1' && node.kind === 'tension') {
      x = 47;
      y = 40;
    }
    if (gravity === '2' && ['motif', 'inference'].includes(node.kind)) {
      x = 48 + (node.x - 48) * 0.3;
      y = 42 + (node.y - 42) * 0.3;
    }
    return `left:${x}%;top:${y}%;`;
  }
  function nodeClass(node) {
    return `material-node ${node.kind}${node.dormant ? ' dormant' : ''}${selectedIds.includes(node.id) ? ' selected' : ''}`;
  }
  function nodeExcerpt(node) {
    return node.body.length > 82 ? node.body.slice(0, 82) + '…' : node.body;
  }
  function evidenceLabel(node) {
    return node.evidence.length > 0 ? `${node.evidence.length} trace` : 'untraced fragment';
  }
  function selectionHint() {
    if (selectedIds.length === 3) return 'Three fragments gathered. Make the collision.';
    if (selectedIds.length === 2) return 'Enough to Spark—or gather one stranger fragment.';
    if (selectedIds.length === 1)
      return 'Good. Now choose something that does not obviously belong.';
    return 'Gather your first fragment.';
  }
  function chooseArchivist() {
    perspective = 'archivist';
  }
  function chooseContrarian() {
    perspective = 'contrarian';
  }
  function chooseMetaphorist() {
    perspective = 'metaphorist';
  }
  function agentClass(id) {
    return `agent${perspective === id ? ' active' : ''}`;
  }
  function perspectiveName() {
    return perspective === 'archivist'
      ? 'The Archivist'
      : perspective === 'metaphorist'
        ? 'The Metaphorist'
        : 'The Contrarian';
  }
  function perspectiveLabel(id) {
    return id === 'archivist' ? 'Archivist' : id === 'metaphorist' ? 'Metaphorist' : 'Contrarian';
  }
  function perspectiveWelcome() {
    if (perspective === 'archivist') return 'I will keep the conditions attached while you wander.';
    if (perspective === 'metaphorist')
      return 'I am listening for the image the evidence cannot say by itself.';
    return 'I will look for the claim this material refuses to make.';
  }
  function nodeConversations() {
    if (!selectedNode) return [];
    return space.conversations.filter((item) => item.nodeId === selectedNode.id);
  }
  function latestConversation() {
    const items = nodeConversations();
    return items.length > 0 ? items[items.length - 1] : null;
  }
  function latestPrompt() {
    const item = latestConversation();
    return item ? item.prompt : '';
  }
  function latestResponse() {
    const item = latestConversation();
    return item ? item.response : '';
  }
  function latestPerspective() {
    const item = latestConversation();
    return item ? perspectiveLabel(item.perspective) : '';
  }
  function latestSpark() {
    const items = space && space.sparks ? space.sparks : [];
    return items.length > 0 ? items[items.length - 1] : null;
  }
  function latestSparkTitle() {
    const item = latestSpark();
    return item ? item.title : '';
  }
  function latestSparkBody() {
    const item = latestSpark();
    return item ? item.body : '';
  }
  function latestSparkTension() {
    const item = latestSpark();
    return item ? item.tension : '';
  }
  function latestSparkSaved() {
    const item = latestSpark();
    return Boolean(item && item.saved);
  }
  function latestSparkPerspective() {
    const item = latestSpark();
    return item ? perspectiveLabel(item.perspective) : '';
  }
  function updatePrompt(event) {
    prompt = event.currentTarget.value;
  }
  async function askMaterial() {
    if (!selectedNode || busy || prompt.trim().length < 3) return;
    busy = true;
    try {
      const next = await api('/api/conversation', {
        nodeId: selectedNode.id,
        perspective,
        prompt: prompt.trim(),
      });
      queueMicrotask(() => {
        space = next.space;
        prompt = '';
        syncSelected();
      });
    } catch (error) {
      queueMicrotask(() => {
        errorMessage = error instanceof Error ? error.message : 'The material went quiet';
      });
    } finally {
      queueMicrotask(() => {
        busy = false;
      });
    }
  }
  async function gesture(action) {
    if (busy) return;
    busy = true;
    try {
      const next = await api('/api/gesture', {
        action,
        nodeIds: selectedIds,
      });
      queueMicrotask(() => {
        space = next.space;
        syncSelected();
      });
    } catch (error) {
      queueMicrotask(() => {
        errorMessage = error instanceof Error ? error.message : 'The gesture did not land';
      });
    } finally {
      queueMicrotask(() => {
        busy = false;
      });
    }
  }
  function juxtapose() {
    gesture('juxtapose');
  }
  function toggleSleep() {
    gesture(selectedDormant() ? 'revive' : 'sleep');
  }
  function makeSpark() {
    void createSparkFromSelection();
  }
  async function createSparkFromSelection() {
    if (busy) return;
    busy = true;
    try {
      const next = await api('/api/spark', {
        seed,
        perspective,
        nodeIds: selectedIds,
      });
      queueMicrotask(() => {
        space = next.space;
        syncSelected();
      });
    } catch (error) {
      queueMicrotask(() => {
        errorMessage = error instanceof Error ? error.message : 'The fragments did not collide';
      });
    } finally {
      queueMicrotask(() => {
        busy = false;
      });
    }
  }
  function saveSpark() {
    void keepLatestSpark();
  }
  async function keepLatestSpark() {
    const item = latestSpark();
    if (!item || item.saved || busy) return;
    busy = true;
    try {
      const next = await api('/api/spark/save', { sparkId: item.id });
      queueMicrotask(() => {
        space = next.space;
      });
    } catch (error) {
      queueMicrotask(() => {
        errorMessage = error instanceof Error ? error.message : 'The Spark could not be kept';
      });
    } finally {
      queueMicrotask(() => {
        busy = false;
      });
    }
  }
  function toggleLineage() {
    showLineage = !showLineage;
  }
  function reversedLineage() {
    return [...space.lineage].reverse();
  }
  function eventTime(value) {
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  props = __weiv_getTrackedRoot('props', props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    __weiv_scope.data = data;
    __weiv_scope.space = space;
    __weiv_scope.busy = busy;
    __weiv_scope.initialized = initialized;
    __weiv_scope.starting = starting;
    __weiv_scope.errorMessage = errorMessage;
    __weiv_scope.selectedIds = selectedIds;
    __weiv_scope.selectedNode = selectedNode;
    __weiv_scope.perspective = perspective;
    __weiv_scope.prompt = prompt;
    __weiv_scope.gravity = gravity;
    __weiv_scope.showLineage = showLineage;
    __weiv_scope.seedChosen = seedChosen;
    __weiv_scope.seed = seed;
    __weiv_scope.seedDraft = seedDraft;
    __weiv_scope.boot = boot;
    __weiv_scope.api = api;
    __weiv_scope.load = load;
    __weiv_scope.applyState = applyState;
    __weiv_scope.updateSeed = updateSeed;
    __weiv_scope.beginSeed = beginSeed;
    __weiv_scope.preparedOffice = preparedOffice;
    __weiv_scope.preparedRitual = preparedRitual;
    __weiv_scope.preparedFreedom = preparedFreedom;
    __weiv_scope.headerStatus = headerStatus;
    __weiv_scope.lineageLabel = lineageLabel;
    __weiv_scope.syncSelected = syncSelected;
    __weiv_scope.activeNodes = activeNodes;
    __weiv_scope.dormantCount = dormantCount;
    __weiv_scope.visibleNodes = visibleNodes;
    __weiv_scope.nodeAt = nodeAt;
    __weiv_scope.selectedDormant = selectedDormant;
    __weiv_scope.selectNode = selectNode;
    __weiv_scope.clearSelection = clearSelection;
    __weiv_scope.select0 = select0;
    __weiv_scope.select1 = select1;
    __weiv_scope.select2 = select2;
    __weiv_scope.select3 = select3;
    __weiv_scope.select4 = select4;
    __weiv_scope.select5 = select5;
    __weiv_scope.select6 = select6;
    __weiv_scope.select7 = select7;
    __weiv_scope.changeGravity = changeGravity;
    __weiv_scope.gravityLabel = gravityLabel;
    __weiv_scope.nodeStyle = nodeStyle;
    __weiv_scope.nodeClass = nodeClass;
    __weiv_scope.nodeExcerpt = nodeExcerpt;
    __weiv_scope.evidenceLabel = evidenceLabel;
    __weiv_scope.selectionHint = selectionHint;
    __weiv_scope.chooseArchivist = chooseArchivist;
    __weiv_scope.chooseContrarian = chooseContrarian;
    __weiv_scope.chooseMetaphorist = chooseMetaphorist;
    __weiv_scope.agentClass = agentClass;
    __weiv_scope.perspectiveName = perspectiveName;
    __weiv_scope.perspectiveLabel = perspectiveLabel;
    __weiv_scope.perspectiveWelcome = perspectiveWelcome;
    __weiv_scope.nodeConversations = nodeConversations;
    __weiv_scope.latestConversation = latestConversation;
    __weiv_scope.latestPrompt = latestPrompt;
    __weiv_scope.latestResponse = latestResponse;
    __weiv_scope.latestPerspective = latestPerspective;
    __weiv_scope.latestSpark = latestSpark;
    __weiv_scope.latestSparkTitle = latestSparkTitle;
    __weiv_scope.latestSparkBody = latestSparkBody;
    __weiv_scope.latestSparkTension = latestSparkTension;
    __weiv_scope.latestSparkSaved = latestSparkSaved;
    __weiv_scope.latestSparkPerspective = latestSparkPerspective;
    __weiv_scope.updatePrompt = updatePrompt;
    __weiv_scope.askMaterial = askMaterial;
    __weiv_scope.gesture = gesture;
    __weiv_scope.juxtapose = juxtapose;
    __weiv_scope.toggleSleep = toggleSleep;
    __weiv_scope.makeSpark = makeSpark;
    __weiv_scope.createSparkFromSelection = createSparkFromSelection;
    __weiv_scope.saveSpark = saveSpark;
    __weiv_scope.keepLatestSpark = keepLatestSpark;
    __weiv_scope.toggleLineage = toggleLineage;
    __weiv_scope.reversedLineage = reversedLineage;
    __weiv_scope.eventTime = eventTime;
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

export const scopeId = 'wF8D8D15902FD343B';
export const css =
  '\n  [data-weiv-scope="wF8D8D15902FD343B"].muse-shell, [data-weiv-scope="wF8D8D15902FD343B"] .muse-shell { --night:#171714; --paper:#ede9df; --dim:#999589; --line:#3a3933; --acid:#d7ef5b; --violet:#b8a2f7; --coral:#ef8e6d; --blue:#85bcd1; min-height:100vh; color:var(--paper); background:radial-gradient(circle at 52% 34%,#292821 0,#171714 48%); font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif; }\n  [data-weiv-scope="wF8D8D15902FD343B"].muse-shell, [data-weiv-scope="wF8D8D15902FD343B"] .muse-shell, [data-weiv-scope="wF8D8D15902FD343B"].muse-shell *, [data-weiv-scope="wF8D8D15902FD343B"] .muse-shell * {box-sizing:border-box}[data-weiv-scope="wF8D8D15902FD343B"]button, [data-weiv-scope="wF8D8D15902FD343B"] button, [data-weiv-scope="wF8D8D15902FD343B"]input, [data-weiv-scope="wF8D8D15902FD343B"] input, [data-weiv-scope="wF8D8D15902FD343B"]textarea, [data-weiv-scope="wF8D8D15902FD343B"] textarea {font:inherit}[data-weiv-scope="wF8D8D15902FD343B"].bootstrap, [data-weiv-scope="wF8D8D15902FD343B"] .bootstrap {display:none}[data-weiv-scope="wF8D8D15902FD343B"]button, [data-weiv-scope="wF8D8D15902FD343B"] button {cursor:pointer}\n  [data-weiv-scope="wF8D8D15902FD343B"]header, [data-weiv-scope="wF8D8D15902FD343B"] header {height:70px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 27px;border-bottom:1px solid #34332e;background:#171714d9;backdrop-filter:blur(14px);position:sticky;top:0;z-index:20}\n  [data-weiv-scope="wF8D8D15902FD343B"].brand, [data-weiv-scope="wF8D8D15902FD343B"] .brand {display:flex;align-items:center;gap:10px}[data-weiv-scope="wF8D8D15902FD343B"].brand>i, [data-weiv-scope="wF8D8D15902FD343B"] .brand>i {display:grid;place-items:center;width:34px;height:34px;border-radius:50% 45% 55% 48%;background:var(--acid);color:#202117;font:700 19px Georgia;transform:rotate(-8deg)}[data-weiv-scope="wF8D8D15902FD343B"].brand b, [data-weiv-scope="wF8D8D15902FD343B"] .brand b {font:600 20px Georgia}[data-weiv-scope="wF8D8D15902FD343B"].brand small, [data-weiv-scope="wF8D8D15902FD343B"] .brand small {display:block;color:var(--dim);font-size:9px;letter-spacing:.13em;text-transform:uppercase}\n  [data-weiv-scope="wF8D8D15902FD343B"].presence, [data-weiv-scope="wF8D8D15902FD343B"] .presence {display:flex;align-items:center;gap:9px;color:#aaa69a;font-size:11px}[data-weiv-scope="wF8D8D15902FD343B"].presence span, [data-weiv-scope="wF8D8D15902FD343B"] .presence span {width:6px;height:6px;border-radius:50%;background:var(--acid);box-shadow:0 0 0 5px #d7ef5b18}[data-weiv-scope="wF8D8D15902FD343B"].quiet, [data-weiv-scope="wF8D8D15902FD343B"] .quiet {justify-self:end;border:1px solid var(--line);border-radius:99px;background:transparent;color:#c7c3b8;padding:7px 12px;font-size:10px}[data-weiv-scope="wF8D8D15902FD343B"].quiet:hover, [data-weiv-scope="wF8D8D15902FD343B"] .quiet:hover {border-color:#777268}\n  [data-weiv-scope="wF8D8D15902FD343B"]main, [data-weiv-scope="wF8D8D15902FD343B"] main {min-height:calc(100vh - 70px)}[data-weiv-scope="wF8D8D15902FD343B"].error, [data-weiv-scope="wF8D8D15902FD343B"] .error {position:fixed;z-index:30;top:82px;left:50%;transform:translateX(-50%);padding:10px 14px;border-radius:8px;background:#7b3429;color:white}\n  [data-weiv-scope="wF8D8D15902FD343B"].eyebrow, [data-weiv-scope="wF8D8D15902FD343B"] .eyebrow {margin:0 0 10px;color:var(--acid);font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}\n  [data-weiv-scope="wF8D8D15902FD343B"].arrival, [data-weiv-scope="wF8D8D15902FD343B"] .arrival {display:grid;place-items:center;align-content:center;min-height:calc(100vh - 70px);text-align:center}[data-weiv-scope="wF8D8D15902FD343B"].arrival h1, [data-weiv-scope="wF8D8D15902FD343B"] .arrival h1 {margin:7px 0 14px;font:500 clamp(41px,6vw,74px)/.98 Georgia;letter-spacing:-.045em}[data-weiv-scope="wF8D8D15902FD343B"].arrival>p:not(.eyebrow), [data-weiv-scope="wF8D8D15902FD343B"] .arrival>p:not(.eyebrow) {color:var(--dim)}[data-weiv-scope="wF8D8D15902FD343B"].orb, [data-weiv-scope="wF8D8D15902FD343B"] .orb {width:45px;height:45px;margin-bottom:20px;border:1px solid var(--acid);border-radius:50%;box-shadow:inset 14px -10px 26px #d7ef5b77,0 0 55px #d7ef5b36;animation:breathe 1.8s infinite alternate}@keyframes breathe{to{transform:scale(1.13);opacity:.7}}[data-weiv-scope="wF8D8D15902FD343B"].arrival-agents, [data-weiv-scope="wF8D8D15902FD343B"] .arrival-agents {display:flex;gap:7px;margin-top:20px}[data-weiv-scope="wF8D8D15902FD343B"].arrival-agents span, [data-weiv-scope="wF8D8D15902FD343B"] .arrival-agents span {padding:5px 8px;border:1px solid var(--line);border-radius:99px;color:#aaa69a;font-size:9px}\n  [data-weiv-scope="wF8D8D15902FD343B"].quiet:disabled, [data-weiv-scope="wF8D8D15902FD343B"] .quiet:disabled {opacity:.25;cursor:not-allowed}[data-weiv-scope="wF8D8D15902FD343B"].seed-room, [data-weiv-scope="wF8D8D15902FD343B"] .seed-room {display:grid;grid-template-columns:minmax(360px,.9fr) minmax(430px,.7fr);gap:clamp(45px,8vw,130px);align-items:center;min-height:calc(100vh - 70px);max-width:1180px;margin:auto;padding:60px 45px 110px;position:relative}[data-weiv-scope="wF8D8D15902FD343B"].seed-copy h1, [data-weiv-scope="wF8D8D15902FD343B"] .seed-copy h1 {margin:9px 0 22px;font:500 clamp(48px,6vw,77px)/.96 Georgia;letter-spacing:-.055em}[data-weiv-scope="wF8D8D15902FD343B"].seed-copy>p:last-child, [data-weiv-scope="wF8D8D15902FD343B"] .seed-copy>p:last-child {max-width:590px;color:var(--dim);font-size:15px;line-height:1.6}[data-weiv-scope="wF8D8D15902FD343B"].seed-card, [data-weiv-scope="wF8D8D15902FD343B"] .seed-card {padding:27px;border:1px solid #48463f;border-radius:18px;background:#201f1bcc;box-shadow:0 30px 90px #0005}[data-weiv-scope="wF8D8D15902FD343B"].seed-card label, [data-weiv-scope="wF8D8D15902FD343B"] .seed-card label {display:block;margin-bottom:9px;color:var(--acid);font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}[data-weiv-scope="wF8D8D15902FD343B"].seed-card textarea, [data-weiv-scope="wF8D8D15902FD343B"] .seed-card textarea {width:100%;resize:vertical;padding:14px;border:1px solid #555248;border-radius:11px;background:#171714;color:var(--paper);outline:none;font:19px/1.35 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].seed-card textarea:focus, [data-weiv-scope="wF8D8D15902FD343B"] .seed-card textarea:focus {border-color:var(--acid);box-shadow:0 0 0 3px #d7ef5b12}[data-weiv-scope="wF8D8D15902FD343B"].begin, [data-weiv-scope="wF8D8D15902FD343B"] .begin {width:100%;margin-top:10px;padding:12px;border:0;border-radius:10px;background:var(--acid);color:#191a12;font-weight:800}[data-weiv-scope="wF8D8D15902FD343B"].begin:disabled, [data-weiv-scope="wF8D8D15902FD343B"] .begin:disabled {opacity:.3}[data-weiv-scope="wF8D8D15902FD343B"].prepared, [data-weiv-scope="wF8D8D15902FD343B"] .prepared {display:grid;gap:6px;margin-top:25px;padding-top:18px;border-top:1px solid var(--line)}[data-weiv-scope="wF8D8D15902FD343B"].prepared>span, [data-weiv-scope="wF8D8D15902FD343B"] .prepared>span {margin-bottom:3px;color:var(--dim);font-size:9px}[data-weiv-scope="wF8D8D15902FD343B"].prepared button, [data-weiv-scope="wF8D8D15902FD343B"] .prepared button {padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:transparent;color:#c9c5ba;text-align:left;font:12px Georgia}[data-weiv-scope="wF8D8D15902FD343B"].prepared button:hover, [data-weiv-scope="wF8D8D15902FD343B"] .prepared button:hover {border-color:#777268;background:#292823}[data-weiv-scope="wF8D8D15902FD343B"].source-note, [data-weiv-scope="wF8D8D15902FD343B"] .source-note {margin:18px 0 0;color:#6f6c64;font-size:8px;text-align:center}[data-weiv-scope="wF8D8D15902FD343B"].micro-arc, [data-weiv-scope="wF8D8D15902FD343B"] .micro-arc {position:absolute;left:45px;right:45px;bottom:42px;display:flex;align-items:center;justify-content:center;color:#7f7b71;font-size:9px}[data-weiv-scope="wF8D8D15902FD343B"].micro-arc span, [data-weiv-scope="wF8D8D15902FD343B"] .micro-arc span {display:flex;align-items:center;gap:7px}[data-weiv-scope="wF8D8D15902FD343B"].micro-arc b, [data-weiv-scope="wF8D8D15902FD343B"] .micro-arc b {display:grid;place-items:center;width:22px;height:22px;border:1px solid #555248;border-radius:50%;color:var(--acid)}[data-weiv-scope="wF8D8D15902FD343B"].micro-arc i, [data-weiv-scope="wF8D8D15902FD343B"] .micro-arc i {width:65px;height:1px;margin:0 10px;background:#3b3933}\n  [data-weiv-scope="wF8D8D15902FD343B"].workspace, [data-weiv-scope="wF8D8D15902FD343B"] .workspace {display:grid;grid-template-columns:230px minmax(570px,1fr) 300px;min-height:calc(100vh - 70px)}[data-weiv-scope="wF8D8D15902FD343B"].left-rail, [data-weiv-scope="wF8D8D15902FD343B"] .left-rail, [data-weiv-scope="wF8D8D15902FD343B"].conversation, [data-weiv-scope="wF8D8D15902FD343B"] .conversation {padding:28px 20px}[data-weiv-scope="wF8D8D15902FD343B"].left-rail, [data-weiv-scope="wF8D8D15902FD343B"] .left-rail {border-right:1px solid #302f2a}[data-weiv-scope="wF8D8D15902FD343B"].left-rail h1, [data-weiv-scope="wF8D8D15902FD343B"] .left-rail h1 {margin:5px 0 14px;font:500 27px/1.04 Georgia;letter-spacing:-.035em}[data-weiv-scope="wF8D8D15902FD343B"].intro, [data-weiv-scope="wF8D8D15902FD343B"] .intro {color:var(--dim);font-size:11px;line-height:1.65}\n  [data-weiv-scope="wF8D8D15902FD343B"].gravity, [data-weiv-scope="wF8D8D15902FD343B"] .gravity {margin:35px 0 28px;padding-top:18px;border-top:1px solid var(--line)}[data-weiv-scope="wF8D8D15902FD343B"].gravity>div:first-child, [data-weiv-scope="wF8D8D15902FD343B"] .gravity>div:first-child {display:flex;justify-content:space-between;gap:8px}[data-weiv-scope="wF8D8D15902FD343B"].gravity b, [data-weiv-scope="wF8D8D15902FD343B"] .gravity b {font-size:10px}[data-weiv-scope="wF8D8D15902FD343B"].gravity span, [data-weiv-scope="wF8D8D15902FD343B"] .gravity span {color:var(--dim);font-size:8px}[data-weiv-scope="wF8D8D15902FD343B"].gravity input, [data-weiv-scope="wF8D8D15902FD343B"] .gravity input {width:100%;margin:16px 0 4px;accent-color:var(--acid)}[data-weiv-scope="wF8D8D15902FD343B"].gravity-labels, [data-weiv-scope="wF8D8D15902FD343B"] .gravity-labels {display:flex;justify-content:space-between;color:var(--dim)}\n  [data-weiv-scope="wF8D8D15902FD343B"].agents, [data-weiv-scope="wF8D8D15902FD343B"] .agents {display:grid;gap:6px}[data-weiv-scope="wF8D8D15902FD343B"].agent, [data-weiv-scope="wF8D8D15902FD343B"] .agent {display:flex;gap:9px;align-items:center;width:100%;padding:9px;border:1px solid transparent;border-radius:10px;background:transparent;color:#aaa69a;text-align:left}[data-weiv-scope="wF8D8D15902FD343B"].agent:hover, [data-weiv-scope="wF8D8D15902FD343B"] .agent:hover, [data-weiv-scope="wF8D8D15902FD343B"].agent.active, [data-weiv-scope="wF8D8D15902FD343B"] .agent.active {border-color:var(--line);background:#25241f;color:var(--paper)}[data-weiv-scope="wF8D8D15902FD343B"].agent i, [data-weiv-scope="wF8D8D15902FD343B"] .agent i {display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#37362f;color:var(--acid);font-size:9px;font-style:normal}[data-weiv-scope="wF8D8D15902FD343B"].agent span, [data-weiv-scope="wF8D8D15902FD343B"] .agent span {display:grid}[data-weiv-scope="wF8D8D15902FD343B"].agent b, [data-weiv-scope="wF8D8D15902FD343B"] .agent b {font-size:10px}[data-weiv-scope="wF8D8D15902FD343B"].agent small, [data-weiv-scope="wF8D8D15902FD343B"] .agent small {font-size:8px;color:var(--dim)}\n  [data-weiv-scope="wF8D8D15902FD343B"].field, [data-weiv-scope="wF8D8D15902FD343B"] .field {position:relative;min-width:0;padding:15px 22px 0;overflow:hidden}[data-weiv-scope="wF8D8D15902FD343B"].play-path, [data-weiv-scope="wF8D8D15902FD343B"] .play-path {display:flex;align-items:center;justify-content:center;margin-bottom:10px;color:#625f57;font-size:8px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}[data-weiv-scope="wF8D8D15902FD343B"].play-path span.current, [data-weiv-scope="wF8D8D15902FD343B"] .play-path span.current {color:var(--paper)}[data-weiv-scope="wF8D8D15902FD343B"].play-path span.done, [data-weiv-scope="wF8D8D15902FD343B"] .play-path span.done {color:var(--acid)}[data-weiv-scope="wF8D8D15902FD343B"].play-path i, [data-weiv-scope="wF8D8D15902FD343B"] .play-path i {width:34px;height:1px;margin:0 7px;background:#3e3c36}[data-weiv-scope="wF8D8D15902FD343B"].field-top, [data-weiv-scope="wF8D8D15902FD343B"] .field-top {display:flex;align-items:center;justify-content:space-between;gap:14px}[data-weiv-scope="wF8D8D15902FD343B"].field-top>div, [data-weiv-scope="wF8D8D15902FD343B"] .field-top>div {display:flex;gap:7px}[data-weiv-scope="wF8D8D15902FD343B"].field-top span, [data-weiv-scope="wF8D8D15902FD343B"] .field-top span {padding:4px 7px;border:1px solid var(--line);border-radius:99px;color:var(--dim);font-size:8px}[data-weiv-scope="wF8D8D15902FD343B"].field-top p, [data-weiv-scope="wF8D8D15902FD343B"] .field-top p {color:var(--dim);font:italic 11px Georgia}[data-weiv-scope="wF8D8D15902FD343B"].constellation, [data-weiv-scope="wF8D8D15902FD343B"] .constellation {position:relative;height:calc(100vh - 188px);min-height:550px}[data-weiv-scope="wF8D8D15902FD343B"].halo, [data-weiv-scope="wF8D8D15902FD343B"] .halo {position:absolute;border:1px solid #ffffff08;border-radius:50%}[data-weiv-scope="wF8D8D15902FD343B"].halo.one, [data-weiv-scope="wF8D8D15902FD343B"] .halo.one {inset:14% 20% 17%}[data-weiv-scope="wF8D8D15902FD343B"].halo.two, [data-weiv-scope="wF8D8D15902FD343B"] .halo.two {inset:27% 32% 30%}[data-weiv-scope="wF8D8D15902FD343B"].center-note, [data-weiv-scope="wF8D8D15902FD343B"] .center-note {position:absolute;left:48%;top:43%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:7px;color:#65635b;font:italic 10px Georgia}[data-weiv-scope="wF8D8D15902FD343B"].center-note i, [data-weiv-scope="wF8D8D15902FD343B"] .center-note i {width:7px;height:7px;border-radius:50%;background:#55534c}\n  [data-weiv-scope="wF8D8D15902FD343B"].material-node, [data-weiv-scope="wF8D8D15902FD343B"] .material-node {position:absolute;transform:translate(-50%,-50%);display:grid;gap:5px;width:145px;padding:11px 12px;border:1px solid #44423b;border-radius:13px;background:#22211dcc;color:var(--paper);text-align:left;box-shadow:0 12px 45px #0000001f;transition:left .55s ease,top .55s ease,opacity .25s,transform .2s,border-color .2s}[data-weiv-scope="wF8D8D15902FD343B"].material-node:hover, [data-weiv-scope="wF8D8D15902FD343B"] .material-node:hover {transform:translate(-50%,-50%) scale(1.04);border-color:#817d70;z-index:3}[data-weiv-scope="wF8D8D15902FD343B"].material-node.selected, [data-weiv-scope="wF8D8D15902FD343B"] .material-node.selected {border-color:var(--acid);box-shadow:0 0 0 3px #d7ef5b12,0 16px 50px #0006;z-index:4}[data-weiv-scope="wF8D8D15902FD343B"].material-node.dormant, [data-weiv-scope="wF8D8D15902FD343B"] .material-node.dormant {opacity:.25;filter:saturate(.3)}[data-weiv-scope="wF8D8D15902FD343B"].node-kind, [data-weiv-scope="wF8D8D15902FD343B"] .node-kind {font-size:7px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:var(--blue)}[data-weiv-scope="wF8D8D15902FD343B"].material-node.tension .node-kind, [data-weiv-scope="wF8D8D15902FD343B"] .material-node.tension .node-kind {color:var(--coral)}[data-weiv-scope="wF8D8D15902FD343B"].material-node.motif .node-kind, [data-weiv-scope="wF8D8D15902FD343B"] .material-node.motif .node-kind {color:var(--violet)}[data-weiv-scope="wF8D8D15902FD343B"].material-node.inference .node-kind, [data-weiv-scope="wF8D8D15902FD343B"] .material-node.inference .node-kind {color:var(--acid)}[data-weiv-scope="wF8D8D15902FD343B"].material-node b, [data-weiv-scope="wF8D8D15902FD343B"] .material-node b {font:500 13px/1.1 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].material-node small, [data-weiv-scope="wF8D8D15902FD343B"] .material-node small {color:#9d998e;font-size:8px;line-height:1.35}[data-weiv-scope="wF8D8D15902FD343B"].material-node>i, [data-weiv-scope="wF8D8D15902FD343B"] .material-node>i {color:#777369;font-size:7px;font-style:normal}\n  [data-weiv-scope="wF8D8D15902FD343B"].gesture-bar, [data-weiv-scope="wF8D8D15902FD343B"] .gesture-bar {position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:6px;border:1px solid #44423b;border-radius:99px;background:#1c1b18e8;backdrop-filter:blur(10px);z-index:8}[data-weiv-scope="wF8D8D15902FD343B"].gesture-bar span, [data-weiv-scope="wF8D8D15902FD343B"] .gesture-bar span {padding:0 8px;color:var(--dim);font-size:8px}[data-weiv-scope="wF8D8D15902FD343B"].gesture-bar button, [data-weiv-scope="wF8D8D15902FD343B"] .gesture-bar button {padding:7px 10px;border:0;border-radius:99px;background:#34332d;color:#dedacf;font-size:9px}[data-weiv-scope="wF8D8D15902FD343B"].gesture-bar button:first-of-type, [data-weiv-scope="wF8D8D15902FD343B"] .gesture-bar button:first-of-type {background:var(--acid);color:#1b1c13;font-weight:750}[data-weiv-scope="wF8D8D15902FD343B"].gesture-bar button:disabled, [data-weiv-scope="wF8D8D15902FD343B"] .gesture-bar button:disabled {opacity:.3;cursor:not-allowed}\n  [data-weiv-scope="wF8D8D15902FD343B"].conversation, [data-weiv-scope="wF8D8D15902FD343B"] .conversation {display:flex;flex-direction:column;border-left:1px solid #302f2a;background:#191916}[data-weiv-scope="wF8D8D15902FD343B"].material-detail, [data-weiv-scope="wF8D8D15902FD343B"] .material-detail {min-height:190px;padding-bottom:20px;border-bottom:1px solid var(--line)}[data-weiv-scope="wF8D8D15902FD343B"].kind-mark, [data-weiv-scope="wF8D8D15902FD343B"] .kind-mark {display:inline-block;padding:4px 7px;border-radius:99px;background:#32312b;color:var(--blue);font-size:7px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}[data-weiv-scope="wF8D8D15902FD343B"].kind-mark.tension, [data-weiv-scope="wF8D8D15902FD343B"] .kind-mark.tension {color:var(--coral)}[data-weiv-scope="wF8D8D15902FD343B"].kind-mark.motif, [data-weiv-scope="wF8D8D15902FD343B"] .kind-mark.motif {color:var(--violet)}[data-weiv-scope="wF8D8D15902FD343B"].material-detail h2, [data-weiv-scope="wF8D8D15902FD343B"] .material-detail h2 {margin:14px 0 8px;font:500 24px/1.08 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].material-detail p, [data-weiv-scope="wF8D8D15902FD343B"] .material-detail p {color:#a5a196;font:13px/1.55 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].provenance, [data-weiv-scope="wF8D8D15902FD343B"] .provenance {color:#77746b;font-size:8px}[data-weiv-scope="wF8D8D15902FD343B"].empty-detail, [data-weiv-scope="wF8D8D15902FD343B"] .empty-detail {color:var(--dim)}\n  [data-weiv-scope="wF8D8D15902FD343B"].spark-card, [data-weiv-scope="wF8D8D15902FD343B"] .spark-card {margin:-8px -8px 18px;padding:18px;border:1px solid #6f7441;border-radius:15px;background:linear-gradient(145deg,#323526,#24251e);box-shadow:0 18px 55px #0005}[data-weiv-scope="wF8D8D15902FD343B"].spark-top, [data-weiv-scope="wF8D8D15902FD343B"] .spark-top {display:flex;justify-content:space-between;color:var(--acid);font-size:8px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}[data-weiv-scope="wF8D8D15902FD343B"].spark-top i, [data-weiv-scope="wF8D8D15902FD343B"] .spark-top i {font-style:normal;font-size:15px}[data-weiv-scope="wF8D8D15902FD343B"].spark-card h2, [data-weiv-scope="wF8D8D15902FD343B"] .spark-card h2 {margin:11px 0 8px;font:500 25px/1.05 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].spark-card p, [data-weiv-scope="wF8D8D15902FD343B"] .spark-card p {margin:0;color:#d2cec2;font:12px/1.55 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].spark-card small, [data-weiv-scope="wF8D8D15902FD343B"] .spark-card small {display:block;margin:11px 0;color:#8f8b80;font-size:8px;line-height:1.45}[data-weiv-scope="wF8D8D15902FD343B"].spark-card button, [data-weiv-scope="wF8D8D15902FD343B"] .spark-card button {width:100%;padding:9px;border:0;border-radius:8px;background:var(--acid);color:#1b1c13;font-size:9px;font-weight:800}[data-weiv-scope="wF8D8D15902FD343B"].spark-card button:disabled, [data-weiv-scope="wF8D8D15902FD343B"] .spark-card button:disabled {background:#4a4e35;color:#cdd49c}\n  [data-weiv-scope="wF8D8D15902FD343B"].thread, [data-weiv-scope="wF8D8D15902FD343B"] .thread {flex:1;max-height:calc(100vh - 405px);overflow:auto;padding:18px 0}[data-weiv-scope="wF8D8D15902FD343B"].thread-head, [data-weiv-scope="wF8D8D15902FD343B"] .thread-head {display:flex;justify-content:space-between;margin-bottom:12px}[data-weiv-scope="wF8D8D15902FD343B"].thread-head span, [data-weiv-scope="wF8D8D15902FD343B"] .thread-head span {font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em}[data-weiv-scope="wF8D8D15902FD343B"].thread-head small, [data-weiv-scope="wF8D8D15902FD343B"] .thread-head small {color:var(--dim);font-size:8px}[data-weiv-scope="wF8D8D15902FD343B"].message, [data-weiv-scope="wF8D8D15902FD343B"] .message {margin:8px 0;padding:10px 11px;border-radius:11px;background:#292823;color:#b8b4a9;font:11px/1.5 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].message.mine, [data-weiv-scope="wF8D8D15902FD343B"] .message.mine {margin-left:35px;background:#34372b;color:#dce5b4}[data-weiv-scope="wF8D8D15902FD343B"].message.agent-message b, [data-weiv-scope="wF8D8D15902FD343B"] .message.agent-message b {display:block;margin-bottom:4px;color:var(--acid);font:800 7px Inter;text-transform:uppercase;letter-spacing:.12em}[data-weiv-scope="wF8D8D15902FD343B"].composer, [data-weiv-scope="wF8D8D15902FD343B"] .composer {display:grid;gap:7px;padding-top:12px;border-top:1px solid var(--line)}[data-weiv-scope="wF8D8D15902FD343B"].composer textarea, [data-weiv-scope="wF8D8D15902FD343B"] .composer textarea {resize:none;width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:#22211d;color:var(--paper);outline:none;font:11px/1.4 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].composer textarea:focus, [data-weiv-scope="wF8D8D15902FD343B"] .composer textarea:focus {border-color:#716e63}[data-weiv-scope="wF8D8D15902FD343B"].composer button, [data-weiv-scope="wF8D8D15902FD343B"] .composer button {justify-self:end;padding:7px 10px;border:0;border-radius:8px;background:var(--acid);color:#1b1c13;font-size:9px;font-weight:750}[data-weiv-scope="wF8D8D15902FD343B"].composer button:disabled, [data-weiv-scope="wF8D8D15902FD343B"] .composer button:disabled {opacity:.3}\n  [data-weiv-scope="wF8D8D15902FD343B"].exchange.hidden, [data-weiv-scope="wF8D8D15902FD343B"] .exchange.hidden {display:none}\n  [data-weiv-scope="wF8D8D15902FD343B"].lineage-view, [data-weiv-scope="wF8D8D15902FD343B"] .lineage-view {display:grid;grid-template-columns:minmax(320px,.7fr) minmax(460px,1.3fr);gap:70px;max-width:1180px;margin:auto;padding:75px 40px}[data-weiv-scope="wF8D8D15902FD343B"].lineage-hero, [data-weiv-scope="wF8D8D15902FD343B"] .lineage-hero {position:sticky;top:145px;align-self:start}[data-weiv-scope="wF8D8D15902FD343B"].lineage-hero h1, [data-weiv-scope="wF8D8D15902FD343B"] .lineage-hero h1 {margin:10px 0 18px;font:500 52px/.98 Georgia;letter-spacing:-.045em}[data-weiv-scope="wF8D8D15902FD343B"].lineage-hero>p:last-child, [data-weiv-scope="wF8D8D15902FD343B"] .lineage-hero>p:last-child {max-width:420px;color:var(--dim)}[data-weiv-scope="wF8D8D15902FD343B"].timeline, [data-weiv-scope="wF8D8D15902FD343B"] .timeline {border-left:1px solid var(--line)}[data-weiv-scope="wF8D8D15902FD343B"].timeline article, [data-weiv-scope="wF8D8D15902FD343B"] .timeline article {display:grid;grid-template-columns:60px 15px 1fr;gap:13px;margin:0 0 39px;transform:translateX(-68px)}[data-weiv-scope="wF8D8D15902FD343B"].timeline time, [data-weiv-scope="wF8D8D15902FD343B"] .timeline time {color:var(--dim);font-size:9px;text-align:right}[data-weiv-scope="wF8D8D15902FD343B"].timeline article>i, [data-weiv-scope="wF8D8D15902FD343B"] .timeline article>i {width:9px;height:9px;margin-top:3px;border:2px solid var(--night);border-radius:50%;background:var(--acid);box-shadow:0 0 0 1px #6e713c}[data-weiv-scope="wF8D8D15902FD343B"].timeline article span, [data-weiv-scope="wF8D8D15902FD343B"] .timeline article span {color:var(--acid);font-size:8px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}[data-weiv-scope="wF8D8D15902FD343B"].timeline h2, [data-weiv-scope="wF8D8D15902FD343B"] .timeline h2 {margin:6px 0;font:500 20px/1.2 Georgia}[data-weiv-scope="wF8D8D15902FD343B"].timeline small, [data-weiv-scope="wF8D8D15902FD343B"] .timeline small {color:var(--dim);font-size:8px}\n  @media(max-width:1100px){[data-weiv-scope="wF8D8D15902FD343B"].workspace, [data-weiv-scope="wF8D8D15902FD343B"] .workspace {grid-template-columns:205px minmax(520px,1fr)}[data-weiv-scope="wF8D8D15902FD343B"].conversation, [data-weiv-scope="wF8D8D15902FD343B"] .conversation {position:fixed;z-index:12;right:0;top:70px;bottom:0;width:300px;box-shadow:-18px 0 50px #0007}[data-weiv-scope="wF8D8D15902FD343B"].field, [data-weiv-scope="wF8D8D15902FD343B"] .field {padding-right:110px}[data-weiv-scope="wF8D8D15902FD343B"].material-node, [data-weiv-scope="wF8D8D15902FD343B"] .material-node {width:132px}}\n  @media(max-width:760px){[data-weiv-scope="wF8D8D15902FD343B"]header, [data-weiv-scope="wF8D8D15902FD343B"] header {grid-template-columns:1fr auto}[data-weiv-scope="wF8D8D15902FD343B"].presence, [data-weiv-scope="wF8D8D15902FD343B"] .presence {display:none}[data-weiv-scope="wF8D8D15902FD343B"].seed-room, [data-weiv-scope="wF8D8D15902FD343B"] .seed-room {grid-template-columns:1fr;padding:42px 22px 90px}[data-weiv-scope="wF8D8D15902FD343B"].seed-copy h1, [data-weiv-scope="wF8D8D15902FD343B"] .seed-copy h1 {font-size:46px}[data-weiv-scope="wF8D8D15902FD343B"].micro-arc, [data-weiv-scope="wF8D8D15902FD343B"] .micro-arc {left:20px;right:20px}[data-weiv-scope="wF8D8D15902FD343B"].micro-arc i, [data-weiv-scope="wF8D8D15902FD343B"] .micro-arc i {width:13px}[data-weiv-scope="wF8D8D15902FD343B"].workspace, [data-weiv-scope="wF8D8D15902FD343B"] .workspace {display:block}[data-weiv-scope="wF8D8D15902FD343B"].left-rail, [data-weiv-scope="wF8D8D15902FD343B"] .left-rail {display:none}[data-weiv-scope="wF8D8D15902FD343B"].field, [data-weiv-scope="wF8D8D15902FD343B"] .field {padding:15px}[data-weiv-scope="wF8D8D15902FD343B"].conversation, [data-weiv-scope="wF8D8D15902FD343B"] .conversation {position:static;width:100%;min-height:420px;border-top:1px solid var(--line);box-shadow:none}[data-weiv-scope="wF8D8D15902FD343B"].material-detail, [data-weiv-scope="wF8D8D15902FD343B"] .material-detail {min-height:0}[data-weiv-scope="wF8D8D15902FD343B"].material-detail p, [data-weiv-scope="wF8D8D15902FD343B"] .material-detail p {display:none}[data-weiv-scope="wF8D8D15902FD343B"].thread, [data-weiv-scope="wF8D8D15902FD343B"] .thread {display:none}[data-weiv-scope="wF8D8D15902FD343B"].constellation, [data-weiv-scope="wF8D8D15902FD343B"] .constellation {height:58vh;min-height:470px}[data-weiv-scope="wF8D8D15902FD343B"].material-node, [data-weiv-scope="wF8D8D15902FD343B"] .material-node {width:116px}[data-weiv-scope="wF8D8D15902FD343B"].lineage-view, [data-weiv-scope="wF8D8D15902FD343B"] .lineage-view {grid-template-columns:1fr;padding:45px 25px}[data-weiv-scope="wF8D8D15902FD343B"].lineage-hero, [data-weiv-scope="wF8D8D15902FD343B"] .lineage-hero {position:static}[data-weiv-scope="wF8D8D15902FD343B"].lineage-hero h1, [data-weiv-scope="wF8D8D15902FD343B"] .lineage-hero h1 {font-size:42px}}\n';

export const trackedStateGraph = { roots: [], paths: [], regions: [] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_283 = document.createElement('div');
  refs[283] = __ref_283;
  __ref_283.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_283.setAttribute('class', 'muse-shell');
  const __ref_1 = document.createElement('span');
  refs[1] = __ref_1;
  __ref_1.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_1.setAttribute('class', 'bootstrap');
  const __ref_0 = document.createTextNode('');
  refs[0] = __ref_0;
  __ref_1.append(__ref_0);
  __ref_283.append(__ref_1);
  const __ref_12 = document.createElement('header');
  refs[12] = __ref_12;
  __ref_12.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_6 = document.createElement('div');
  refs[6] = __ref_6;
  __ref_6.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_6.setAttribute('class', 'brand');
  const __ref_2 = document.createElement('i');
  refs[2] = __ref_2;
  __ref_2.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_2.append(document.createTextNode('m'));
  __ref_6.append(__ref_2);
  const __ref_5 = document.createElement('div');
  refs[5] = __ref_5;
  __ref_5.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_3 = document.createElement('b');
  refs[3] = __ref_3;
  __ref_3.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_3.append(document.createTextNode('Muse'));
  __ref_5.append(__ref_3);
  const __ref_4 = document.createElement('small');
  refs[4] = __ref_4;
  __ref_4.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_4.append(document.createTextNode('living material'));
  __ref_5.append(__ref_4);
  __ref_6.append(__ref_5);
  __ref_12.append(__ref_6);
  const __ref_9 = document.createElement('div');
  refs[9] = __ref_9;
  __ref_9.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_9.setAttribute('class', 'presence');
  const __ref_7 = document.createElement('span');
  refs[7] = __ref_7;
  __ref_7.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_9.append(__ref_7);
  const __ref_8 = document.createTextNode('');
  refs[8] = __ref_8;
  __ref_9.append(__ref_8);
  __ref_12.append(__ref_9);
  const __ref_11 = document.createElement('button');
  refs[11] = __ref_11;
  __ref_11.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  __ref_11.setAttribute('class', 'quiet');
  __ref_11.addEventListener('click', (event) => {
    const resolved = instance.refresh().toggleLineage;
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_10 = document.createTextNode('');
  refs[10] = __ref_10;
  __ref_11.append(__ref_10);
  __ref_12.append(__ref_11);
  __ref_283.append(__ref_12);
  const __ref_282 = document.createElement('main');
  refs[282] = __ref_282;
  __ref_282.setAttribute('data-weiv-scope', 'wF8D8D15902FD343B');
  const __ref_13 = document.createComment('if:start');
  const __ref_14 = document.createComment('if:end');
  refs[13] = __ref_13;
  refs[14] = __ref_14;
  refs[15] = undefined;
  __ref_282.append(__ref_13);
  __ref_282.append(__ref_14);
  const __ref_18 = document.createComment('if:start');
  const __ref_19 = document.createComment('if:end');
  refs[18] = __ref_18;
  refs[19] = __ref_19;
  refs[20] = undefined;
  __ref_282.append(__ref_18);
  __ref_282.append(__ref_19);
  const __ref_31 = document.createComment('if:start');
  const __ref_32 = document.createComment('if:end');
  refs[31] = __ref_31;
  refs[32] = __ref_32;
  refs[33] = undefined;
  __ref_282.append(__ref_31);
  __ref_282.append(__ref_32);
  const __ref_62 = document.createComment('if:start');
  const __ref_63 = document.createComment('if:end');
  refs[62] = __ref_62;
  refs[63] = __ref_63;
  refs[64] = undefined;
  __ref_282.append(__ref_62);
  __ref_282.append(__ref_63);
  const __ref_257 = document.createComment('if:start');
  const __ref_258 = document.createComment('if:end');
  refs[257] = __ref_257;
  refs[258] = __ref_258;
  refs[259] = undefined;
  __ref_282.append(__ref_257);
  __ref_282.append(__ref_258);
  __ref_283.append(__ref_282);
  fragment.append(__ref_283);
  return fragment;
}

function updateRegion_text_0(instance, scope, refs) {
  const __next_text_0 = String(scope.boot() ?? '');
  if (refs[0].data !== __next_text_0) {
    refs[0].data = __next_text_0;
  }
}
function updateRegion_text_8(instance, scope, refs) {
  const __next_text_8 = String((scope.busy ? 'Space is shifting…' : scope.headerStatus()) ?? '');
  if (refs[8].data !== __next_text_8) {
    refs[8].data = __next_text_8;
  }
}
function updateRegion_attribute_11_disabled(instance, scope, refs) {
  const __value_11_disabled = !scope.seedChosen;
  const __next_11_disabled = Boolean(__value_11_disabled);
  if (refs[11].disabled !== __next_11_disabled) {
    refs[11].disabled = __next_11_disabled;
  }
  const __has_attr_11_disabled = refs[11].hasAttribute('disabled');
  if (__next_11_disabled) {
    if (!__has_attr_11_disabled) {
      refs[11].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_11_disabled) {
      refs[11].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_10(instance, scope, refs) {
  const __next_text_10 = String(
    (scope.showLineage ? 'Return to space' : scope.lineageLabel()) ?? '',
  );
  if (refs[10].data !== __next_text_10) {
    refs[10].data = __next_text_10;
  }
}
function updateRegion_conditional_13(instance, scope, refs) {
  updateConditional_13(instance, scope);
}
function updateRegion_text_16(instance, scope, refs) {
  const __next_text_16 = String(scope.errorMessage ?? '');
  if (refs[16].data !== __next_text_16) {
    refs[16].data = __next_text_16;
  }
}
function updateRegion_conditional_18(instance, scope, refs) {
  updateConditional_18(instance, scope);
}
function updateRegion_conditional_31(instance, scope, refs) {
  updateConditional_31(instance, scope);
}
function updateRegion_attribute_39_value(instance, scope, refs) {
  const __value_39_value = scope.seedDraft;
  const __next_39_value = __value_39_value ?? '';
  const __next_string_39_value = String(__next_39_value);
  if (refs[39].value !== __next_string_39_value) {
    refs[39].value = __next_string_39_value;
  }
  refs[39].setAttribute('value', __next_string_39_value);
}
function updateRegion_attribute_41_disabled(instance, scope, refs) {
  const __value_41_disabled = scope.seedDraft.length < 8;
  const __next_41_disabled = Boolean(__value_41_disabled);
  if (refs[41].disabled !== __next_41_disabled) {
    refs[41].disabled = __next_41_disabled;
  }
  const __has_attr_41_disabled = refs[41].hasAttribute('disabled');
  if (__next_41_disabled) {
    if (!__has_attr_41_disabled) {
      refs[41].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_41_disabled) {
      refs[41].removeAttribute('disabled');
    }
  }
}
function updateRegion_conditional_62(instance, scope, refs) {
  updateConditional_62(instance, scope);
}
function updateRegion_text_66(instance, scope, refs) {
  const __next_text_66 = String(scope.seed ?? '');
  if (refs[66].data !== __next_text_66) {
    refs[66].data = __next_text_66;
  }
}
function updateRegion_text_70(instance, scope, refs) {
  const __next_text_70 = String(scope.gravityLabel() ?? '');
  if (refs[70].data !== __next_text_70) {
    refs[70].data = __next_text_70;
  }
}
function updateRegion_attribute_73_value(instance, scope, refs) {
  const __value_73_value = scope.gravity;
  const __next_73_value = __value_73_value ?? '';
  const __next_string_73_value = String(__next_73_value);
  if (refs[73].value !== __next_string_73_value) {
    refs[73].value = __next_string_73_value;
  }
  refs[73].setAttribute('value', __next_string_73_value);
}
function updateRegion_attribute_83_class(instance, scope, refs) {
  const __value_83_class = scope.agentClass('archivist');
  if (__value_83_class === false || __value_83_class === null || __value_83_class === undefined) {
    if (refs[83].hasAttribute('class')) {
      refs[83].removeAttribute('class');
    }
  } else if (__value_83_class === true) {
    if (!refs[83].hasAttribute('class')) {
      refs[83].setAttribute('class', '');
    }
  } else {
    refs[83].setAttribute('class', String(__value_83_class));
  }
}
function updateRegion_attribute_88_class(instance, scope, refs) {
  const __value_88_class = scope.agentClass('contrarian');
  if (__value_88_class === false || __value_88_class === null || __value_88_class === undefined) {
    if (refs[88].hasAttribute('class')) {
      refs[88].removeAttribute('class');
    }
  } else if (__value_88_class === true) {
    if (!refs[88].hasAttribute('class')) {
      refs[88].setAttribute('class', '');
    }
  } else {
    refs[88].setAttribute('class', String(__value_88_class));
  }
}
function updateRegion_attribute_93_class(instance, scope, refs) {
  const __value_93_class = scope.agentClass('metaphorist');
  if (__value_93_class === false || __value_93_class === null || __value_93_class === undefined) {
    if (refs[93].hasAttribute('class')) {
      refs[93].removeAttribute('class');
    }
  } else if (__value_93_class === true) {
    if (!refs[93].hasAttribute('class')) {
      refs[93].setAttribute('class', '');
    }
  } else {
    refs[93].setAttribute('class', String(__value_93_class));
  }
}
function updateRegion_attribute_98_class(instance, scope, refs) {
  const __value_98_class = scope.selectedIds.length > 0 ? 'done' : 'current';
  if (__value_98_class === false || __value_98_class === null || __value_98_class === undefined) {
    if (refs[98].hasAttribute('class')) {
      refs[98].removeAttribute('class');
    }
  } else if (__value_98_class === true) {
    if (!refs[98].hasAttribute('class')) {
      refs[98].setAttribute('class', '');
    }
  } else {
    refs[98].setAttribute('class', String(__value_98_class));
  }
}
function updateRegion_attribute_100_class(instance, scope, refs) {
  const __value_100_class = scope.selectedIds.length > 1 ? 'current' : '';
  if (
    __value_100_class === false ||
    __value_100_class === null ||
    __value_100_class === undefined
  ) {
    if (refs[100].hasAttribute('class')) {
      refs[100].removeAttribute('class');
    }
  } else if (__value_100_class === true) {
    if (!refs[100].hasAttribute('class')) {
      refs[100].setAttribute('class', '');
    }
  } else {
    refs[100].setAttribute('class', String(__value_100_class));
  }
}
function updateRegion_attribute_102_class(instance, scope, refs) {
  const __value_102_class = scope.latestSpark() ? 'done' : '';
  if (
    __value_102_class === false ||
    __value_102_class === null ||
    __value_102_class === undefined
  ) {
    if (refs[102].hasAttribute('class')) {
      refs[102].removeAttribute('class');
    }
  } else if (__value_102_class === true) {
    if (!refs[102].hasAttribute('class')) {
      refs[102].setAttribute('class', '');
    }
  } else {
    refs[102].setAttribute('class', String(__value_102_class));
  }
}
function updateRegion_text_104(instance, scope, refs) {
  const __next_text_104 = String(scope.activeNodes().length ?? '');
  if (refs[104].data !== __next_text_104) {
    refs[104].data = __next_text_104;
  }
}
function updateRegion_text_106(instance, scope, refs) {
  const __next_text_106 = String(scope.dormantCount() ?? '');
  if (refs[106].data !== __next_text_106) {
    refs[106].data = __next_text_106;
  }
}
function updateRegion_text_108(instance, scope, refs) {
  const __next_text_108 = String(scope.space.relations.length ?? '');
  if (refs[108].data !== __next_text_108) {
    refs[108].data = __next_text_108;
  }
}
function updateRegion_text_111(instance, scope, refs) {
  const __next_text_111 = String(scope.selectionHint() ?? '');
  if (refs[111].data !== __next_text_111) {
    refs[111].data = __next_text_111;
  }
}
function updateRegion_attribute_124_class(instance, scope, refs) {
  const __value_124_class = scope.nodeClass(scope.nodeAt(0));
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
function updateRegion_attribute_124_style(instance, scope, refs) {
  const __value_124_style = scope.nodeStyle(scope.nodeAt(0));
  if (
    __value_124_style === false ||
    __value_124_style === null ||
    __value_124_style === undefined
  ) {
    if (refs[124].hasAttribute('style')) {
      refs[124].removeAttribute('style');
    }
  } else if (__value_124_style === true) {
    if (!refs[124].hasAttribute('style')) {
      refs[124].setAttribute('style', '');
    }
  } else {
    refs[124].setAttribute('style', String(__value_124_style));
  }
}
function updateRegion_text_116(instance, scope, refs) {
  const __next_text_116 = String(scope.nodeAt(0).kind ?? '');
  if (refs[116].data !== __next_text_116) {
    refs[116].data = __next_text_116;
  }
}
function updateRegion_text_118(instance, scope, refs) {
  const __next_text_118 = String(scope.nodeAt(0).title ?? '');
  if (refs[118].data !== __next_text_118) {
    refs[118].data = __next_text_118;
  }
}
function updateRegion_text_120(instance, scope, refs) {
  const __next_text_120 = String(scope.nodeExcerpt(scope.nodeAt(0)) ?? '');
  if (refs[120].data !== __next_text_120) {
    refs[120].data = __next_text_120;
  }
}
function updateRegion_text_122(instance, scope, refs) {
  const __next_text_122 = String(scope.evidenceLabel(scope.nodeAt(0)) ?? '');
  if (refs[122].data !== __next_text_122) {
    refs[122].data = __next_text_122;
  }
}
function updateRegion_attribute_133_class(instance, scope, refs) {
  const __value_133_class = scope.nodeClass(scope.nodeAt(1));
  if (
    __value_133_class === false ||
    __value_133_class === null ||
    __value_133_class === undefined
  ) {
    if (refs[133].hasAttribute('class')) {
      refs[133].removeAttribute('class');
    }
  } else if (__value_133_class === true) {
    if (!refs[133].hasAttribute('class')) {
      refs[133].setAttribute('class', '');
    }
  } else {
    refs[133].setAttribute('class', String(__value_133_class));
  }
}
function updateRegion_attribute_133_style(instance, scope, refs) {
  const __value_133_style = scope.nodeStyle(scope.nodeAt(1));
  if (
    __value_133_style === false ||
    __value_133_style === null ||
    __value_133_style === undefined
  ) {
    if (refs[133].hasAttribute('style')) {
      refs[133].removeAttribute('style');
    }
  } else if (__value_133_style === true) {
    if (!refs[133].hasAttribute('style')) {
      refs[133].setAttribute('style', '');
    }
  } else {
    refs[133].setAttribute('style', String(__value_133_style));
  }
}
function updateRegion_text_125(instance, scope, refs) {
  const __next_text_125 = String(scope.nodeAt(1).kind ?? '');
  if (refs[125].data !== __next_text_125) {
    refs[125].data = __next_text_125;
  }
}
function updateRegion_text_127(instance, scope, refs) {
  const __next_text_127 = String(scope.nodeAt(1).title ?? '');
  if (refs[127].data !== __next_text_127) {
    refs[127].data = __next_text_127;
  }
}
function updateRegion_text_129(instance, scope, refs) {
  const __next_text_129 = String(scope.nodeExcerpt(scope.nodeAt(1)) ?? '');
  if (refs[129].data !== __next_text_129) {
    refs[129].data = __next_text_129;
  }
}
function updateRegion_text_131(instance, scope, refs) {
  const __next_text_131 = String(scope.evidenceLabel(scope.nodeAt(1)) ?? '');
  if (refs[131].data !== __next_text_131) {
    refs[131].data = __next_text_131;
  }
}
function updateRegion_attribute_142_class(instance, scope, refs) {
  const __value_142_class = scope.nodeClass(scope.nodeAt(2));
  if (
    __value_142_class === false ||
    __value_142_class === null ||
    __value_142_class === undefined
  ) {
    if (refs[142].hasAttribute('class')) {
      refs[142].removeAttribute('class');
    }
  } else if (__value_142_class === true) {
    if (!refs[142].hasAttribute('class')) {
      refs[142].setAttribute('class', '');
    }
  } else {
    refs[142].setAttribute('class', String(__value_142_class));
  }
}
function updateRegion_attribute_142_style(instance, scope, refs) {
  const __value_142_style = scope.nodeStyle(scope.nodeAt(2));
  if (
    __value_142_style === false ||
    __value_142_style === null ||
    __value_142_style === undefined
  ) {
    if (refs[142].hasAttribute('style')) {
      refs[142].removeAttribute('style');
    }
  } else if (__value_142_style === true) {
    if (!refs[142].hasAttribute('style')) {
      refs[142].setAttribute('style', '');
    }
  } else {
    refs[142].setAttribute('style', String(__value_142_style));
  }
}
function updateRegion_text_134(instance, scope, refs) {
  const __next_text_134 = String(scope.nodeAt(2).kind ?? '');
  if (refs[134].data !== __next_text_134) {
    refs[134].data = __next_text_134;
  }
}
function updateRegion_text_136(instance, scope, refs) {
  const __next_text_136 = String(scope.nodeAt(2).title ?? '');
  if (refs[136].data !== __next_text_136) {
    refs[136].data = __next_text_136;
  }
}
function updateRegion_text_138(instance, scope, refs) {
  const __next_text_138 = String(scope.nodeExcerpt(scope.nodeAt(2)) ?? '');
  if (refs[138].data !== __next_text_138) {
    refs[138].data = __next_text_138;
  }
}
function updateRegion_text_140(instance, scope, refs) {
  const __next_text_140 = String(scope.evidenceLabel(scope.nodeAt(2)) ?? '');
  if (refs[140].data !== __next_text_140) {
    refs[140].data = __next_text_140;
  }
}
function updateRegion_attribute_151_class(instance, scope, refs) {
  const __value_151_class = scope.nodeClass(scope.nodeAt(3));
  if (
    __value_151_class === false ||
    __value_151_class === null ||
    __value_151_class === undefined
  ) {
    if (refs[151].hasAttribute('class')) {
      refs[151].removeAttribute('class');
    }
  } else if (__value_151_class === true) {
    if (!refs[151].hasAttribute('class')) {
      refs[151].setAttribute('class', '');
    }
  } else {
    refs[151].setAttribute('class', String(__value_151_class));
  }
}
function updateRegion_attribute_151_style(instance, scope, refs) {
  const __value_151_style = scope.nodeStyle(scope.nodeAt(3));
  if (
    __value_151_style === false ||
    __value_151_style === null ||
    __value_151_style === undefined
  ) {
    if (refs[151].hasAttribute('style')) {
      refs[151].removeAttribute('style');
    }
  } else if (__value_151_style === true) {
    if (!refs[151].hasAttribute('style')) {
      refs[151].setAttribute('style', '');
    }
  } else {
    refs[151].setAttribute('style', String(__value_151_style));
  }
}
function updateRegion_text_143(instance, scope, refs) {
  const __next_text_143 = String(scope.nodeAt(3).kind ?? '');
  if (refs[143].data !== __next_text_143) {
    refs[143].data = __next_text_143;
  }
}
function updateRegion_text_145(instance, scope, refs) {
  const __next_text_145 = String(scope.nodeAt(3).title ?? '');
  if (refs[145].data !== __next_text_145) {
    refs[145].data = __next_text_145;
  }
}
function updateRegion_text_147(instance, scope, refs) {
  const __next_text_147 = String(scope.nodeExcerpt(scope.nodeAt(3)) ?? '');
  if (refs[147].data !== __next_text_147) {
    refs[147].data = __next_text_147;
  }
}
function updateRegion_text_149(instance, scope, refs) {
  const __next_text_149 = String(scope.evidenceLabel(scope.nodeAt(3)) ?? '');
  if (refs[149].data !== __next_text_149) {
    refs[149].data = __next_text_149;
  }
}
function updateRegion_attribute_160_class(instance, scope, refs) {
  const __value_160_class = scope.nodeClass(scope.nodeAt(4));
  if (
    __value_160_class === false ||
    __value_160_class === null ||
    __value_160_class === undefined
  ) {
    if (refs[160].hasAttribute('class')) {
      refs[160].removeAttribute('class');
    }
  } else if (__value_160_class === true) {
    if (!refs[160].hasAttribute('class')) {
      refs[160].setAttribute('class', '');
    }
  } else {
    refs[160].setAttribute('class', String(__value_160_class));
  }
}
function updateRegion_attribute_160_style(instance, scope, refs) {
  const __value_160_style = scope.nodeStyle(scope.nodeAt(4));
  if (
    __value_160_style === false ||
    __value_160_style === null ||
    __value_160_style === undefined
  ) {
    if (refs[160].hasAttribute('style')) {
      refs[160].removeAttribute('style');
    }
  } else if (__value_160_style === true) {
    if (!refs[160].hasAttribute('style')) {
      refs[160].setAttribute('style', '');
    }
  } else {
    refs[160].setAttribute('style', String(__value_160_style));
  }
}
function updateRegion_text_152(instance, scope, refs) {
  const __next_text_152 = String(scope.nodeAt(4).kind ?? '');
  if (refs[152].data !== __next_text_152) {
    refs[152].data = __next_text_152;
  }
}
function updateRegion_text_154(instance, scope, refs) {
  const __next_text_154 = String(scope.nodeAt(4).title ?? '');
  if (refs[154].data !== __next_text_154) {
    refs[154].data = __next_text_154;
  }
}
function updateRegion_text_156(instance, scope, refs) {
  const __next_text_156 = String(scope.nodeExcerpt(scope.nodeAt(4)) ?? '');
  if (refs[156].data !== __next_text_156) {
    refs[156].data = __next_text_156;
  }
}
function updateRegion_text_158(instance, scope, refs) {
  const __next_text_158 = String(scope.evidenceLabel(scope.nodeAt(4)) ?? '');
  if (refs[158].data !== __next_text_158) {
    refs[158].data = __next_text_158;
  }
}
function updateRegion_attribute_169_class(instance, scope, refs) {
  const __value_169_class = scope.nodeClass(scope.nodeAt(5));
  if (
    __value_169_class === false ||
    __value_169_class === null ||
    __value_169_class === undefined
  ) {
    if (refs[169].hasAttribute('class')) {
      refs[169].removeAttribute('class');
    }
  } else if (__value_169_class === true) {
    if (!refs[169].hasAttribute('class')) {
      refs[169].setAttribute('class', '');
    }
  } else {
    refs[169].setAttribute('class', String(__value_169_class));
  }
}
function updateRegion_attribute_169_style(instance, scope, refs) {
  const __value_169_style = scope.nodeStyle(scope.nodeAt(5));
  if (
    __value_169_style === false ||
    __value_169_style === null ||
    __value_169_style === undefined
  ) {
    if (refs[169].hasAttribute('style')) {
      refs[169].removeAttribute('style');
    }
  } else if (__value_169_style === true) {
    if (!refs[169].hasAttribute('style')) {
      refs[169].setAttribute('style', '');
    }
  } else {
    refs[169].setAttribute('style', String(__value_169_style));
  }
}
function updateRegion_text_161(instance, scope, refs) {
  const __next_text_161 = String(scope.nodeAt(5).kind ?? '');
  if (refs[161].data !== __next_text_161) {
    refs[161].data = __next_text_161;
  }
}
function updateRegion_text_163(instance, scope, refs) {
  const __next_text_163 = String(scope.nodeAt(5).title ?? '');
  if (refs[163].data !== __next_text_163) {
    refs[163].data = __next_text_163;
  }
}
function updateRegion_text_165(instance, scope, refs) {
  const __next_text_165 = String(scope.nodeExcerpt(scope.nodeAt(5)) ?? '');
  if (refs[165].data !== __next_text_165) {
    refs[165].data = __next_text_165;
  }
}
function updateRegion_text_167(instance, scope, refs) {
  const __next_text_167 = String(scope.evidenceLabel(scope.nodeAt(5)) ?? '');
  if (refs[167].data !== __next_text_167) {
    refs[167].data = __next_text_167;
  }
}
function updateRegion_attribute_178_class(instance, scope, refs) {
  const __value_178_class = scope.nodeClass(scope.nodeAt(6));
  if (
    __value_178_class === false ||
    __value_178_class === null ||
    __value_178_class === undefined
  ) {
    if (refs[178].hasAttribute('class')) {
      refs[178].removeAttribute('class');
    }
  } else if (__value_178_class === true) {
    if (!refs[178].hasAttribute('class')) {
      refs[178].setAttribute('class', '');
    }
  } else {
    refs[178].setAttribute('class', String(__value_178_class));
  }
}
function updateRegion_attribute_178_style(instance, scope, refs) {
  const __value_178_style = scope.nodeStyle(scope.nodeAt(6));
  if (
    __value_178_style === false ||
    __value_178_style === null ||
    __value_178_style === undefined
  ) {
    if (refs[178].hasAttribute('style')) {
      refs[178].removeAttribute('style');
    }
  } else if (__value_178_style === true) {
    if (!refs[178].hasAttribute('style')) {
      refs[178].setAttribute('style', '');
    }
  } else {
    refs[178].setAttribute('style', String(__value_178_style));
  }
}
function updateRegion_text_170(instance, scope, refs) {
  const __next_text_170 = String(scope.nodeAt(6).kind ?? '');
  if (refs[170].data !== __next_text_170) {
    refs[170].data = __next_text_170;
  }
}
function updateRegion_text_172(instance, scope, refs) {
  const __next_text_172 = String(scope.nodeAt(6).title ?? '');
  if (refs[172].data !== __next_text_172) {
    refs[172].data = __next_text_172;
  }
}
function updateRegion_text_174(instance, scope, refs) {
  const __next_text_174 = String(scope.nodeExcerpt(scope.nodeAt(6)) ?? '');
  if (refs[174].data !== __next_text_174) {
    refs[174].data = __next_text_174;
  }
}
function updateRegion_text_176(instance, scope, refs) {
  const __next_text_176 = String(scope.evidenceLabel(scope.nodeAt(6)) ?? '');
  if (refs[176].data !== __next_text_176) {
    refs[176].data = __next_text_176;
  }
}
function updateRegion_attribute_187_class(instance, scope, refs) {
  const __value_187_class = scope.nodeClass(scope.nodeAt(7));
  if (
    __value_187_class === false ||
    __value_187_class === null ||
    __value_187_class === undefined
  ) {
    if (refs[187].hasAttribute('class')) {
      refs[187].removeAttribute('class');
    }
  } else if (__value_187_class === true) {
    if (!refs[187].hasAttribute('class')) {
      refs[187].setAttribute('class', '');
    }
  } else {
    refs[187].setAttribute('class', String(__value_187_class));
  }
}
function updateRegion_attribute_187_style(instance, scope, refs) {
  const __value_187_style = scope.nodeStyle(scope.nodeAt(7));
  if (
    __value_187_style === false ||
    __value_187_style === null ||
    __value_187_style === undefined
  ) {
    if (refs[187].hasAttribute('style')) {
      refs[187].removeAttribute('style');
    }
  } else if (__value_187_style === true) {
    if (!refs[187].hasAttribute('style')) {
      refs[187].setAttribute('style', '');
    }
  } else {
    refs[187].setAttribute('style', String(__value_187_style));
  }
}
function updateRegion_text_179(instance, scope, refs) {
  const __next_text_179 = String(scope.nodeAt(7).kind ?? '');
  if (refs[179].data !== __next_text_179) {
    refs[179].data = __next_text_179;
  }
}
function updateRegion_text_181(instance, scope, refs) {
  const __next_text_181 = String(scope.nodeAt(7).title ?? '');
  if (refs[181].data !== __next_text_181) {
    refs[181].data = __next_text_181;
  }
}
function updateRegion_text_183(instance, scope, refs) {
  const __next_text_183 = String(scope.nodeExcerpt(scope.nodeAt(7)) ?? '');
  if (refs[183].data !== __next_text_183) {
    refs[183].data = __next_text_183;
  }
}
function updateRegion_text_185(instance, scope, refs) {
  const __next_text_185 = String(scope.evidenceLabel(scope.nodeAt(7)) ?? '');
  if (refs[185].data !== __next_text_185) {
    refs[185].data = __next_text_185;
  }
}
function updateRegion_text_193(instance, scope, refs) {
  const __next_text_193 = String(scope.selectedIds.length ?? '');
  if (refs[193].data !== __next_text_193) {
    refs[193].data = __next_text_193;
  }
}
function updateRegion_attribute_196_disabled(instance, scope, refs) {
  const __value_196_disabled = scope.selectedIds.length < 2 || scope.busy;
  const __next_196_disabled = Boolean(__value_196_disabled);
  if (refs[196].disabled !== __next_196_disabled) {
    refs[196].disabled = __next_196_disabled;
  }
  const __has_attr_196_disabled = refs[196].hasAttribute('disabled');
  if (__next_196_disabled) {
    if (!__has_attr_196_disabled) {
      refs[196].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_196_disabled) {
      refs[196].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_195(instance, scope, refs) {
  const __next_text_195 = String((scope.busy ? 'Colliding…' : 'Make a Spark ✦') ?? '');
  if (refs[195].data !== __next_text_195) {
    refs[195].data = __next_text_195;
  }
}
function updateRegion_attribute_198_disabled(instance, scope, refs) {
  const __value_198_disabled = scope.selectedIds.length !== 1 || scope.busy;
  const __next_198_disabled = Boolean(__value_198_disabled);
  if (refs[198].disabled !== __next_198_disabled) {
    refs[198].disabled = __next_198_disabled;
  }
  const __has_attr_198_disabled = refs[198].hasAttribute('disabled');
  if (__next_198_disabled) {
    if (!__has_attr_198_disabled) {
      refs[198].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_198_disabled) {
      refs[198].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_197(instance, scope, refs) {
  const __next_text_197 = String(
    (scope.selectedDormant() ? 'Revive direction' : 'Let it sleep') ?? '',
  );
  if (refs[197].data !== __next_text_197) {
    refs[197].data = __next_text_197;
  }
}
function updateRegion_attribute_199_disabled(instance, scope, refs) {
  const __value_199_disabled = scope.selectedIds.length === 0;
  const __next_199_disabled = Boolean(__value_199_disabled);
  if (refs[199].disabled !== __next_199_disabled) {
    refs[199].disabled = __next_199_disabled;
  }
  const __has_attr_199_disabled = refs[199].hasAttribute('disabled');
  if (__next_199_disabled) {
    if (!__has_attr_199_disabled) {
      refs[199].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_199_disabled) {
      refs[199].removeAttribute('disabled');
    }
  }
}
function updateRegion_conditional_202(instance, scope, refs) {
  updateConditional_202(instance, scope);
}
function updateRegion_text_205(instance, scope, refs) {
  const __next_text_205 = String(scope.latestSparkPerspective() ?? '');
  if (refs[205].data !== __next_text_205) {
    refs[205].data = __next_text_205;
  }
}
function updateRegion_text_209(instance, scope, refs) {
  const __next_text_209 = String(scope.latestSparkTitle() ?? '');
  if (refs[209].data !== __next_text_209) {
    refs[209].data = __next_text_209;
  }
}
function updateRegion_text_211(instance, scope, refs) {
  const __next_text_211 = String(scope.latestSparkBody() ?? '');
  if (refs[211].data !== __next_text_211) {
    refs[211].data = __next_text_211;
  }
}
function updateRegion_text_213(instance, scope, refs) {
  const __next_text_213 = String(scope.latestSparkTension() ?? '');
  if (refs[213].data !== __next_text_213) {
    refs[213].data = __next_text_213;
  }
}
function updateRegion_attribute_216_disabled(instance, scope, refs) {
  const __value_216_disabled = scope.latestSparkSaved();
  const __next_216_disabled = Boolean(__value_216_disabled);
  if (refs[216].disabled !== __next_216_disabled) {
    refs[216].disabled = __next_216_disabled;
  }
  const __has_attr_216_disabled = refs[216].hasAttribute('disabled');
  if (__next_216_disabled) {
    if (!__has_attr_216_disabled) {
      refs[216].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_216_disabled) {
      refs[216].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_215(instance, scope, refs) {
  const __next_text_215 = String(
    (scope.latestSparkSaved() ? 'Kept for incubation ✓' : 'Keep this Spark') ?? '',
  );
  if (refs[215].data !== __next_text_215) {
    refs[215].data = __next_text_215;
  }
}
function updateRegion_conditional_218(instance, scope, refs) {
  updateConditional_218(instance, scope);
}
function updateRegion_attribute_222_class(instance, scope, refs) {
  const __value_222_class = 'kind-mark ' + scope.selectedNode.kind;
  if (
    __value_222_class === false ||
    __value_222_class === null ||
    __value_222_class === undefined
  ) {
    if (refs[222].hasAttribute('class')) {
      refs[222].removeAttribute('class');
    }
  } else if (__value_222_class === true) {
    if (!refs[222].hasAttribute('class')) {
      refs[222].setAttribute('class', '');
    }
  } else {
    refs[222].setAttribute('class', String(__value_222_class));
  }
}
function updateRegion_text_221(instance, scope, refs) {
  const __next_text_221 = String(scope.selectedNode.kind ?? '');
  if (refs[221].data !== __next_text_221) {
    refs[221].data = __next_text_221;
  }
}
function updateRegion_text_223(instance, scope, refs) {
  const __next_text_223 = String(scope.selectedNode.title ?? '');
  if (refs[223].data !== __next_text_223) {
    refs[223].data = __next_text_223;
  }
}
function updateRegion_text_225(instance, scope, refs) {
  const __next_text_225 = String(scope.selectedNode.body ?? '');
  if (refs[225].data !== __next_text_225) {
    refs[225].data = __next_text_225;
  }
}
function updateRegion_conditional_227(instance, scope, refs) {
  updateConditional_227(instance, scope);
}
function updateRegion_text_230(instance, scope, refs) {
  const __next_text_230 = String(scope.selectedNode.evidence.length ?? '');
  if (refs[230].data !== __next_text_230) {
    refs[230].data = __next_text_230;
  }
}
function updateRegion_text_231(instance, scope, refs) {
  const __next_text_231 = String((scope.selectedNode.evidence.length === 1 ? '' : 's') ?? '');
  if (refs[231].data !== __next_text_231) {
    refs[231].data = __next_text_231;
  }
}
function updateRegion_text_238(instance, scope, refs) {
  const __next_text_238 = String(scope.perspectiveName() ?? '');
  if (refs[238].data !== __next_text_238) {
    refs[238].data = __next_text_238;
  }
}
function updateRegion_text_242(instance, scope, refs) {
  const __next_text_242 = String(scope.perspectiveWelcome() ?? '');
  if (refs[242].data !== __next_text_242) {
    refs[242].data = __next_text_242;
  }
}
function updateRegion_attribute_250_class(instance, scope, refs) {
  const __value_250_class = scope.latestConversation() ? 'exchange' : 'exchange hidden';
  if (
    __value_250_class === false ||
    __value_250_class === null ||
    __value_250_class === undefined
  ) {
    if (refs[250].hasAttribute('class')) {
      refs[250].removeAttribute('class');
    }
  } else if (__value_250_class === true) {
    if (!refs[250].hasAttribute('class')) {
      refs[250].setAttribute('class', '');
    }
  } else {
    refs[250].setAttribute('class', String(__value_250_class));
  }
}
function updateRegion_text_244(instance, scope, refs) {
  const __next_text_244 = String(scope.latestPrompt() ?? '');
  if (refs[244].data !== __next_text_244) {
    refs[244].data = __next_text_244;
  }
}
function updateRegion_text_246(instance, scope, refs) {
  const __next_text_246 = String(scope.latestPerspective() ?? '');
  if (refs[246].data !== __next_text_246) {
    refs[246].data = __next_text_246;
  }
}
function updateRegion_text_248(instance, scope, refs) {
  const __next_text_248 = String(scope.latestResponse() ?? '');
  if (refs[248].data !== __next_text_248) {
    refs[248].data = __next_text_248;
  }
}
function updateRegion_attribute_252_value(instance, scope, refs) {
  const __value_252_value = scope.prompt;
  const __next_252_value = __value_252_value ?? '';
  const __next_string_252_value = String(__next_252_value);
  if (refs[252].value !== __next_string_252_value) {
    refs[252].value = __next_string_252_value;
  }
  refs[252].setAttribute('value', __next_string_252_value);
}
function updateRegion_attribute_253_disabled(instance, scope, refs) {
  const __value_253_disabled = !scope.selectedNode || scope.prompt.length < 3 || scope.busy;
  const __next_253_disabled = Boolean(__value_253_disabled);
  if (refs[253].disabled !== __next_253_disabled) {
    refs[253].disabled = __next_253_disabled;
  }
  const __has_attr_253_disabled = refs[253].hasAttribute('disabled');
  if (__next_253_disabled) {
    if (!__has_attr_253_disabled) {
      refs[253].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_253_disabled) {
      refs[253].removeAttribute('disabled');
    }
  }
}
function updateRegion_conditional_257(instance, scope, refs) {
  updateConditional_257(instance, scope);
}
function updateRegion_loop_265(instance, scope, refs) {
  updateForLoop_265(instance, scope);
}
function updateRegion_text_268(instance, scope, refs) {
  const __next_text_268 = String(scope.eventTime(scope.event.at) ?? '');
  if (refs[268].data !== __next_text_268) {
    refs[268].data = __next_text_268;
  }
}
function updateRegion_text_271(instance, scope, refs) {
  const __next_text_271 = String(scope.event.verb ?? '');
  if (refs[271].data !== __next_text_271) {
    refs[271].data = __next_text_271;
  }
}
function updateRegion_text_273(instance, scope, refs) {
  const __next_text_273 = String(scope.event.detail ?? '');
  if (refs[273].data !== __next_text_273) {
    refs[273].data = __next_text_273;
  }
}
function updateRegion_text_275(instance, scope, refs) {
  const __next_text_275 = String(scope.event.nodeIds.length ?? '');
  if (refs[275].data !== __next_text_275) {
    refs[275].data = __next_text_275;
  }
}
function updateRegion_text_276(instance, scope, refs) {
  const __next_text_276 = String((scope.event.nodeIds.length === 1 ? '' : 's') ?? '');
  if (refs[276].data !== __next_text_276) {
    refs[276].data = __next_text_276;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_text_0(instance, scope, refs);
  updateRegion_text_8(instance, scope, refs);
  updateRegion_attribute_11_disabled(instance, scope, refs);
  updateRegion_text_10(instance, scope, refs);
  updateRegion_conditional_13(instance, scope, refs);
  updateRegion_conditional_18(instance, scope, refs);
  updateRegion_conditional_31(instance, scope, refs);
  updateRegion_conditional_62(instance, scope, refs);
  updateRegion_conditional_257(instance, scope, refs);
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
    dirtySet.has('space') ||
    dirtyRegionSet.has(1)
  ) {
    updateRegion_text_0(instance, scope, refs);
  }
  if (
    dirtySet.has('busy') ||
    dirtySet.has('headerStatus') ||
    dirtySet.has('space') ||
    dirtyRegionSet.has(2)
  ) {
    updateRegion_text_8(instance, scope, refs);
  }
  if (dirtySet.has('seedChosen') || dirtyRegionSet.has(3)) {
    updateRegion_attribute_11_disabled(instance, scope, refs);
  }
  if (
    dirtySet.has('showLineage') ||
    dirtySet.has('space') ||
    dirtySet.has('lineageLabel') ||
    dirtyRegionSet.has(4)
  ) {
    updateRegion_text_10(instance, scope, refs);
  }
  if (dirtySet.has('errorMessage') || dirtyRegionSet.has(5)) {
    updateRegion_conditional_13(instance, scope, refs);
  }
  if (dirtySet.has('space') || dirtyRegionSet.has(6)) {
    updateRegion_conditional_18(instance, scope, refs);
  }
  if (
    dirtySet.has('space') ||
    dirtySet.has('seedChosen') ||
    dirtySet.has('seedDraft') ||
    dirtyRegionSet.has(7)
  ) {
    updateRegion_conditional_31(instance, scope, refs);
  }
  if (
    dirtySet.has('space') ||
    dirtySet.has('seedChosen') ||
    dirtySet.has('showLineage') ||
    dirtySet.has('seed') ||
    dirtySet.has('gravityLabel') ||
    dirtySet.has('gravity') ||
    dirtySet.has('agentClass') ||
    dirtySet.has('perspective') ||
    dirtySet.has('selectedIds') ||
    dirtySet.has('latestSpark') ||
    dirtySet.has('activeNodes') ||
    dirtySet.has('dormantCount') ||
    dirtySet.has('selectionHint') ||
    dirtySet.has('nodeClass') ||
    dirtySet.has('nodeAt') ||
    dirtySet.has('nodeStyle') ||
    dirtySet.has('nodeExcerpt') ||
    dirtySet.has('evidenceLabel') ||
    dirtySet.has('busy') ||
    dirtySet.has('selectedDormant') ||
    dirtySet.has('selectedNode') ||
    dirtySet.has('latestSparkPerspective') ||
    dirtySet.has('perspectiveLabel') ||
    dirtySet.has('latestSparkTitle') ||
    dirtySet.has('latestSparkBody') ||
    dirtySet.has('latestSparkTension') ||
    dirtySet.has('latestSparkSaved') ||
    dirtySet.has('perspectiveName') ||
    dirtySet.has('perspectiveWelcome') ||
    dirtySet.has('latestConversation') ||
    dirtySet.has('nodeConversations') ||
    dirtySet.has('latestPrompt') ||
    dirtySet.has('latestPerspective') ||
    dirtySet.has('latestResponse') ||
    dirtySet.has('prompt') ||
    dirtyRegionSet.has(8)
  ) {
    updateRegion_conditional_62(instance, scope, refs);
  }
  if (
    dirtySet.has('space') ||
    dirtySet.has('seedChosen') ||
    dirtySet.has('showLineage') ||
    dirtySet.has('reversedLineage') ||
    dirtySet.has('eventTime') ||
    dirtyRegionSet.has(9)
  ) {
    updateRegion_conditional_257(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[15] === true) {
  } else {
  }
  if (refs[20] === true) {
  } else {
  }
  if (refs[33] === true) {
  } else {
  }
  if (refs[64] === true) {
    if (refs[204] === true) {
    } else {
    }
    if (refs[220] === true) {
      if (refs[229] === true) {
      } else {
      }
    } else {
    }
  } else {
  }
  if (refs[259] === true) {
    const __records_267 = refs[267] ?? [];
    for (const record of __records_267) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
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
