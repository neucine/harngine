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
function createConditionalFragment_10(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_36 = document.createElement('section');
    refs[36] = __ref_36;
    __ref_36.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_36.setAttribute('class', 'entrance');
    const __ref_18 = document.createElement('div');
    refs[18] = __ref_18;
    __ref_18.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_18.setAttribute('class', 'entrance-art');
    const __ref_13 = document.createElement('div');
    refs[13] = __ref_13;
    __ref_13.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_13.setAttribute('class', 'orbit orbit-one');
    __ref_18.append(__ref_13);
    const __ref_14 = document.createElement('div');
    refs[14] = __ref_14;
    __ref_14.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_14.setAttribute('class', 'orbit orbit-two');
    __ref_18.append(__ref_14);
    const __ref_15 = document.createElement('span');
    refs[15] = __ref_15;
    __ref_15.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_15.setAttribute('class', 'star star-one');
    __ref_15.append(document.createTextNode('✦'));
    __ref_18.append(__ref_15);
    const __ref_16 = document.createElement('span');
    refs[16] = __ref_16;
    __ref_16.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_16.setAttribute('class', 'star star-two');
    __ref_16.append(document.createTextNode('·'));
    __ref_18.append(__ref_16);
    const __ref_17 = document.createElement('span');
    refs[17] = __ref_17;
    __ref_17.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_17.setAttribute('class', 'star star-three');
    __ref_17.append(document.createTextNode('✦'));
    __ref_18.append(__ref_17);
    __ref_36.append(__ref_18);
    const __ref_23 = document.createElement('div');
    refs[23] = __ref_23;
    __ref_23.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_23.setAttribute('class', 'entrance-copy');
    const __ref_19 = document.createElement('div');
    refs[19] = __ref_19;
    __ref_19.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_19.setAttribute('class', 'overline');
    __ref_19.append(document.createTextNode('A shared cultural world'));
    __ref_23.append(__ref_19);
    const __ref_21 = document.createElement('h1');
    refs[21] = __ref_21;
    __ref_21.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_21.append(document.createTextNode('The Museum'));
    const __ref_20 = document.createElement('br');
    refs[20] = __ref_20;
    __ref_20.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_21.append(__ref_20);
    __ref_21.append(document.createTextNode('of Nearby Things'));
    __ref_23.append(__ref_21);
    const __ref_22 = document.createElement('p');
    refs[22] = __ref_22;
    __ref_22.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_22.append(document.createTextNode('Together, discover what connects these objects.'));
    __ref_23.append(__ref_22);
    __ref_36.append(__ref_23);
    const __ref_35 = document.createElement('div');
    refs[35] = __ref_35;
    __ref_35.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_35.setAttribute('class', 'enter-card');
    const __ref_24 = document.createElement('div');
    refs[24] = __ref_24;
    __ref_24.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_24.setAttribute('class', 'expedition-mark');
    __ref_24.append(document.createTextNode('First expedition · about 3 minutes'));
    __ref_35.append(__ref_24);
    const __ref_25 = document.createElement('p');
    refs[25] = __ref_25;
    __ref_25.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_25.append(
      document.createTextNode(
        'Choose a lens, inspect two real artifacts, and pull a thread between them. The world will answer.',
      ),
    );
    __ref_35.append(__ref_25);
    const __ref_27 = document.createElement('label');
    refs[27] = __ref_27;
    __ref_27.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_27.append(document.createTextNode('What should we call you?'));
    const __ref_26 = document.createElement('input');
    refs[26] = __ref_26;
    __ref_26.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_26.setAttribute('maxlength', '32');
    __ref_26.setAttribute('placeholder', 'Your name');
    __ref_26.addEventListener('input', (event) => {
      const resolved = scope.updateName;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_27.append(__ref_26);
    __ref_35.append(__ref_27);
    const __ref_29 = document.createElement('button');
    refs[29] = __ref_29;
    __ref_29.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_29.addEventListener('click', (event) => {
      const resolved = scope.enterWorld;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_28 = document.createTextNode('');
    refs[28] = __ref_28;
    __ref_29.append(__ref_28);
    __ref_35.append(__ref_29);
    const __ref_30 = document.createComment('if:start');
    const __ref_31 = document.createComment('if:end');
    refs[30] = __ref_30;
    refs[31] = __ref_31;
    refs[32] = undefined;
    __ref_35.append(__ref_30);
    __ref_35.append(__ref_31);
    __ref_36.append(__ref_35);
    fragment.append(__ref_36);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_10(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[32] === true) {
    } else {
    }
  } else {
  }
}

function updateConditional_10(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.showEntrance);
  if (refs[12] !== next) {
    const previous = refs[12];
    destroyConditionalBranch_10(instance, previous === true);
    refs[12] = next;
    replaceBetween(refs[10], refs[11], createConditionalFragment_10(instance, scope, next));
  }
  if (next) {
    updateRegion_attribute_26_value(instance, scope, refs);
    updateRegion_attribute_29_disabled(instance, scope, refs);
    updateRegion_text_28(instance, scope, refs);
    updateRegion_conditional_30(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_30(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_34 = document.createElement('small');
    refs[34] = __ref_34;
    __ref_34.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_34.setAttribute('role', 'alert');
    const __ref_33 = document.createTextNode('');
    refs[33] = __ref_33;
    __ref_34.append(__ref_33);
    fragment.append(__ref_34);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_30(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_30(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.errorMessage);
  if (refs[32] !== next) {
    const previous = refs[32];
    destroyConditionalBranch_30(instance, previous === true);
    refs[32] = next;
    replaceBetween(refs[30], refs[31], createConditionalFragment_30(instance, scope, next));
  }
  if (next) {
    updateRegion_text_33(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_37(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_316 = document.createElement('main');
    refs[316] = __ref_316;
    __ref_316.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_316.setAttribute('class', 'world');
    const __ref_69 = document.createElement('aside');
    refs[69] = __ref_69;
    __ref_69.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_69.setAttribute('class', 'left-rail');
    const __ref_46 = document.createElement('div');
    refs[46] = __ref_46;
    __ref_46.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_46.setAttribute('class', 'you');
    const __ref_41 = document.createElement('span');
    refs[41] = __ref_41;
    __ref_41.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_40 = document.createTextNode('');
    refs[40] = __ref_40;
    __ref_41.append(__ref_40);
    __ref_46.append(__ref_41);
    const __ref_45 = document.createElement('div');
    refs[45] = __ref_45;
    __ref_45.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_43 = document.createElement('b');
    refs[43] = __ref_43;
    __ref_43.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_42 = document.createTextNode('');
    refs[42] = __ref_42;
    __ref_43.append(__ref_42);
    __ref_45.append(__ref_43);
    const __ref_44 = document.createElement('small');
    refs[44] = __ref_44;
    __ref_44.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_44.append(document.createTextNode('Your path is remembered'));
    __ref_45.append(__ref_44);
    __ref_46.append(__ref_45);
    __ref_69.append(__ref_46);
    const __ref_57 = document.createElement('section');
    refs[57] = __ref_57;
    __ref_57.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_47 = document.createElement('div');
    refs[47] = __ref_47;
    __ref_47.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_47.setAttribute('class', 'rail-title');
    __ref_47.append(document.createTextNode('Here now'));
    __ref_57.append(__ref_47);
    const __ref_56 = document.createElement('div');
    refs[56] = __ref_56;
    __ref_56.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_56.setAttribute('class', 'visitors');
    const __ref_48 = document.createComment('for:start');
    const __ref_49 = document.createComment('for:end');
    refs[48] = __ref_48;
    refs[49] = __ref_49;
    refs[50] = [];
    __ref_56.append(__ref_48);
    __ref_56.append(__ref_49);
    __ref_57.append(__ref_56);
    __ref_69.append(__ref_57);
    const __ref_65 = document.createElement('section');
    refs[65] = __ref_65;
    __ref_65.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_58 = document.createElement('div');
    refs[58] = __ref_58;
    __ref_58.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_58.setAttribute('class', 'rail-title');
    __ref_58.append(document.createTextNode('Motifs surfacing'));
    __ref_65.append(__ref_58);
    const __ref_64 = document.createElement('div');
    refs[64] = __ref_64;
    __ref_64.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_64.setAttribute('class', 'chips');
    const __ref_59 = document.createComment('for:start');
    const __ref_60 = document.createComment('for:end');
    refs[59] = __ref_59;
    refs[60] = __ref_60;
    refs[61] = [];
    __ref_64.append(__ref_59);
    __ref_64.append(__ref_60);
    __ref_65.append(__ref_64);
    __ref_69.append(__ref_65);
    const __ref_68 = document.createElement('button');
    refs[68] = __ref_68;
    __ref_68.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_68.setAttribute('class', 'how-link');
    __ref_68.addEventListener('click', (event) => {
      const resolved = scope.toggleHow;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_66 = document.createTextNode('');
    refs[66] = __ref_66;
    __ref_68.append(__ref_66);
    const __ref_67 = document.createElement('span');
    refs[67] = __ref_67;
    __ref_67.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_67.append(document.createTextNode('↗'));
    __ref_68.append(__ref_67);
    __ref_69.append(__ref_68);
    __ref_316.append(__ref_69);
    const __ref_315 = document.createElement('div');
    refs[315] = __ref_315;
    __ref_315.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_315.setAttribute('class', 'main-stage');
    const __ref_70 = document.createComment('if:start');
    const __ref_71 = document.createComment('if:end');
    refs[70] = __ref_70;
    refs[71] = __ref_71;
    refs[72] = undefined;
    __ref_315.append(__ref_70);
    __ref_315.append(__ref_71);
    const __ref_75 = document.createComment('if:start');
    const __ref_76 = document.createComment('if:end');
    refs[75] = __ref_75;
    refs[76] = __ref_76;
    refs[77] = undefined;
    __ref_315.append(__ref_75);
    __ref_315.append(__ref_76);
    const __ref_113 = document.createComment('if:start');
    const __ref_114 = document.createComment('if:end');
    refs[113] = __ref_113;
    refs[114] = __ref_114;
    refs[115] = undefined;
    __ref_315.append(__ref_113);
    __ref_315.append(__ref_114);
    __ref_316.append(__ref_315);
    fragment.append(__ref_316);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_37(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_50 = refs[50] ?? [];
    for (const record of __records_50) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_61 = refs[61] ?? [];
    for (const record of __records_61) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    if (refs[72] === true) {
    } else {
    }
    if (refs[77] === true) {
      if (refs[98] === true) {
      } else {
      }
      const __records_102 = refs[102] ?? [];
      for (const record of __records_102) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
    } else {
    }
    if (refs[115] === true) {
      if (refs[118] === true) {
        if (refs[130] === true) {
        } else {
        }
        if (refs[148] === true) {
        } else {
        }
        if (refs[159] === true) {
        } else {
        }
        if (refs[175] === true) {
        } else {
        }
        if (refs[190] === true) {
        } else {
        }
      } else {
      }
      if (refs[202] === true) {
        if (refs[212] === true) {
        } else {
        }
      } else {
      }
      const __records_222 = refs[222] ?? [];
      for (const record of __records_222) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
      const __records_266 = refs[266] ?? [];
      for (const record of __records_266) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
      if (refs[276] === true) {
      } else {
      }
      if (refs[290] === true) {
      } else {
      }
      const __records_294 = refs[294] ?? [];
      for (const record of __records_294) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
      const __records_304 = refs[304] ?? [];
      for (const record of __records_304) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
    } else {
    }
  } else {
  }
}

function updateConditional_37(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.data);
  if (refs[39] !== next) {
    const previous = refs[39];
    destroyConditionalBranch_37(instance, previous === true);
    refs[39] = next;
    replaceBetween(refs[37], refs[38], createConditionalFragment_37(instance, scope, next));
  }
  if (next) {
    updateRegion_text_40(instance, scope, refs);
    updateRegion_text_42(instance, scope, refs);
    updateRegion_loop_48(instance, scope, refs);
    updateRegion_loop_59(instance, scope, refs);
    updateRegion_text_66(instance, scope, refs);
    updateRegion_conditional_70(instance, scope, refs);
    updateRegion_conditional_75(instance, scope, refs);
    updateRegion_conditional_113(instance, scope, refs);
  } else {
  }
}

function createForEntry_48(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['visitor']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['visitor']: currentItem };
    updateRegion_text_51(instance, loopScope, entryRefs);
    updateRegion_text_53(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_55 = document.createElement('div');
  entryRefs[55] = __ref_55;
  __ref_55.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_55.setAttribute('class', 'visitor');
  const __ref_52 = document.createElement('i');
  entryRefs[52] = __ref_52;
  __ref_52.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_51 = document.createTextNode('');
  entryRefs[51] = __ref_51;
  __ref_52.append(__ref_51);
  __ref_55.append(__ref_52);
  const __ref_54 = document.createElement('span');
  entryRefs[54] = __ref_54;
  __ref_54.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_53 = document.createTextNode('');
  entryRefs[53] = __ref_53;
  __ref_54.append(__ref_53);
  __ref_55.append(__ref_54);
  fragment.append(__ref_55);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_48(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.data.visitors ?? [];
  const previous = refs[50] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[49]);
    } else {
      record = createForEntry_48(instance, scope, item, refs[49]);
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
  refs[50] = nextRecords;
}

function createForEntry_59(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['motif']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['motif']: currentItem };
    updateRegion_text_62(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_63 = document.createElement('span');
  entryRefs[63] = __ref_63;
  __ref_63.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_62 = document.createTextNode('');
  entryRefs[62] = __ref_62;
  __ref_63.append(__ref_62);
  fragment.append(__ref_63);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_59(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.data.facets.motifs ?? [];
  const previous = refs[61] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[60]);
    } else {
      record = createForEntry_59(instance, scope, item, refs[60]);
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
  refs[61] = nextRecords;
}

function createConditionalFragment_70(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_74 = document.createElement('div');
    refs[74] = __ref_74;
    __ref_74.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_74.setAttribute('class', 'error');
    __ref_74.setAttribute('role', 'alert');
    const __ref_73 = document.createTextNode('');
    refs[73] = __ref_73;
    __ref_74.append(__ref_73);
    fragment.append(__ref_74);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_70(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_70(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.errorMessage);
  if (refs[72] !== next) {
    const previous = refs[72];
    destroyConditionalBranch_70(instance, previous === true);
    refs[72] = next;
    replaceBetween(refs[70], refs[71], createConditionalFragment_70(instance, scope, next));
  }
  if (next) {
    updateRegion_text_73(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_75(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_112 = document.createElement('section');
    refs[112] = __ref_112;
    __ref_112.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_112.setAttribute('class', 'how-view');
    const __ref_78 = document.createElement('div');
    refs[78] = __ref_78;
    __ref_78.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_78.setAttribute('class', 'overline');
    __ref_78.append(document.createTextNode('Under the surface'));
    __ref_112.append(__ref_78);
    const __ref_80 = document.createElement('h1');
    refs[80] = __ref_80;
    __ref_80.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_80.append(document.createTextNode('A world that remembers'));
    const __ref_79 = document.createElement('br');
    refs[79] = __ref_79;
    __ref_79.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_80.append(__ref_79);
    __ref_80.append(document.createTextNode('without keeping score.'));
    __ref_112.append(__ref_80);
    const __ref_81 = document.createElement('p');
    refs[81] = __ref_81;
    __ref_81.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_81.setAttribute('class', 'lede');
    __ref_81.append(
      document.createTextNode(
        'Quest uses durable, private perspectives and shared world reactions. The machinery stays beneath the experience; no trace decides what a visitor must think.',
      ),
    );
    __ref_112.append(__ref_81);
    const __ref_94 = document.createElement('div');
    refs[94] = __ref_94;
    __ref_94.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_94.setAttribute('class', 'how-grid');
    const __ref_85 = document.createElement('article');
    refs[85] = __ref_85;
    __ref_85.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_82 = document.createElement('span');
    refs[82] = __ref_82;
    __ref_82.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_82.append(document.createTextNode('01'));
    __ref_85.append(__ref_82);
    const __ref_83 = document.createElement('h3');
    refs[83] = __ref_83;
    __ref_83.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_83.append(document.createTextNode('Your perspective travels with you'));
    __ref_85.append(__ref_83);
    const __ref_84 = document.createElement('p');
    refs[84] = __ref_84;
    __ref_84.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_84.append(
      document.createTextNode(
        'Each visitor has a private, durable companion that remembers where they have wandered and offers a different question on return.',
      ),
    );
    __ref_85.append(__ref_84);
    __ref_94.append(__ref_85);
    const __ref_89 = document.createElement('article');
    refs[89] = __ref_89;
    __ref_89.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_86 = document.createElement('span');
    refs[86] = __ref_86;
    __ref_86.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_86.append(document.createTextNode('02'));
    __ref_89.append(__ref_86);
    const __ref_87 = document.createElement('h3');
    refs[87] = __ref_87;
    __ref_87.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_87.append(document.createTextNode('Meaning changes the shared world'));
    __ref_89.append(__ref_87);
    const __ref_88 = document.createElement('p');
    refs[88] = __ref_88;
    __ref_88.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_88.append(
      document.createTextNode(
        'Leave a thought or draw a connection. A durable reaction listens across both source records and lets a new correspondence surface for everyone.',
      ),
    );
    __ref_89.append(__ref_88);
    __ref_94.append(__ref_89);
    const __ref_93 = document.createElement('article');
    refs[93] = __ref_93;
    __ref_93.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_90 = document.createElement('span');
    refs[90] = __ref_90;
    __ref_90.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_90.append(document.createTextNode('03'));
    __ref_93.append(__ref_90);
    const __ref_91 = document.createElement('h3');
    refs[91] = __ref_91;
    __ref_91.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_91.append(document.createTextNode('Facts keep their roots'));
    __ref_93.append(__ref_91);
    const __ref_92 = document.createElement('p');
    refs[92] = __ref_92;
    __ref_92.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_92.append(
      document.createTextNode(
        'Objects and dates remain attached to museum records. Interpretations are visibly human; they never masquerade as collection facts.',
      ),
    );
    __ref_93.append(__ref_92);
    __ref_94.append(__ref_93);
    __ref_112.append(__ref_94);
    const __ref_111 = document.createElement('section');
    refs[111] = __ref_111;
    __ref_111.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_111.setAttribute('class', 'memory-ledger');
    const __ref_95 = document.createElement('h2');
    refs[95] = __ref_95;
    __ref_95.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_95.append(document.createTextNode('Recent world reactions'));
    __ref_111.append(__ref_95);
    const __ref_96 = document.createComment('if:start');
    const __ref_97 = document.createComment('if:end');
    refs[96] = __ref_96;
    refs[97] = __ref_97;
    refs[98] = undefined;
    __ref_111.append(__ref_96);
    __ref_111.append(__ref_97);
    const __ref_100 = document.createComment('for:start');
    const __ref_101 = document.createComment('for:end');
    refs[100] = __ref_100;
    refs[101] = __ref_101;
    refs[102] = [];
    __ref_111.append(__ref_100);
    __ref_111.append(__ref_101);
    __ref_112.append(__ref_111);
    fragment.append(__ref_112);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_75(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[98] === true) {
    } else {
    }
    const __records_102 = refs[102] ?? [];
    for (const record of __records_102) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_75(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.showHow);
  if (refs[77] !== next) {
    const previous = refs[77];
    destroyConditionalBranch_75(instance, previous === true);
    refs[77] = next;
    replaceBetween(refs[75], refs[76], createConditionalFragment_75(instance, scope, next));
  }
  if (next) {
    updateRegion_conditional_96(instance, scope, refs);
    updateRegion_loop_100(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_96(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_99 = document.createElement('div');
    refs[99] = __ref_99;
    __ref_99.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_99.setAttribute('class', 'quiet');
    __ref_99.append(document.createTextNode('The world is waiting for its first new association.'));
    fragment.append(__ref_99);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_96(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_96(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.data.reactions.length === 0);
  if (refs[98] !== next) {
    const previous = refs[98];
    destroyConditionalBranch_96(instance, previous === true);
    refs[98] = next;
    replaceBetween(refs[96], refs[97], createConditionalFragment_96(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createForEntry_100(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['reaction']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['reaction']: currentItem };
    updateRegion_text_104(instance, loopScope, entryRefs);
    updateRegion_text_106(instance, loopScope, entryRefs);
    updateRegion_text_107(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_110 = document.createElement('article');
  entryRefs[110] = __ref_110;
  __ref_110.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_110.setAttribute('class', 'ledger-row');
  const __ref_103 = document.createElement('i');
  entryRefs[103] = __ref_103;
  __ref_103.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_103.append(document.createTextNode('✦'));
  __ref_110.append(__ref_103);
  const __ref_109 = document.createElement('div');
  entryRefs[109] = __ref_109;
  __ref_109.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_105 = document.createElement('p');
  entryRefs[105] = __ref_105;
  __ref_105.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_104 = document.createTextNode('');
  entryRefs[104] = __ref_104;
  __ref_105.append(__ref_104);
  __ref_109.append(__ref_105);
  const __ref_108 = document.createElement('small');
  entryRefs[108] = __ref_108;
  __ref_108.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_108.append(document.createTextNode('Remembered after '));
  const __ref_106 = document.createTextNode('');
  entryRefs[106] = __ref_106;
  __ref_108.append(__ref_106);
  __ref_108.append(document.createTextNode(' wandered here · Work '));
  const __ref_107 = document.createTextNode('');
  entryRefs[107] = __ref_107;
  __ref_108.append(__ref_107);
  __ref_109.append(__ref_108);
  __ref_110.append(__ref_109);
  fragment.append(__ref_110);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_100(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.data.reactions ?? [];
  const previous = refs[102] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[101]);
    } else {
      record = createForEntry_100(instance, scope, item, refs[101]);
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
  refs[102] = nextRecords;
}

function createConditionalFragment_113(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_314 = document.createElement('div');
    refs[314] = __ref_314;
    __ref_314.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_116 = document.createComment('if:start');
    const __ref_117 = document.createComment('if:end');
    refs[116] = __ref_116;
    refs[117] = __ref_117;
    refs[118] = undefined;
    __ref_314.append(__ref_116);
    __ref_314.append(__ref_117);
    const __ref_200 = document.createComment('if:start');
    const __ref_201 = document.createComment('if:end');
    refs[200] = __ref_200;
    refs[201] = __ref_201;
    refs[202] = undefined;
    __ref_314.append(__ref_200);
    __ref_314.append(__ref_201);
    const __ref_236 = document.createElement('section');
    refs[236] = __ref_236;
    __ref_236.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_236.setAttribute('class', 'constellation');
    __ref_236.setAttribute('aria-label', 'Museum object constellation');
    const __ref_220 = document.createComment('for:start');
    const __ref_221 = document.createComment('for:end');
    refs[220] = __ref_220;
    refs[221] = __ref_221;
    refs[222] = [];
    __ref_236.append(__ref_220);
    __ref_236.append(__ref_221);
    const __ref_233 = document.createElement('div');
    refs[233] = __ref_233;
    __ref_233.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_233.setAttribute('class', 'thread-line thread-a');
    __ref_236.append(__ref_233);
    const __ref_234 = document.createElement('div');
    refs[234] = __ref_234;
    __ref_234.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_234.setAttribute('class', 'thread-line thread-b');
    __ref_236.append(__ref_234);
    const __ref_235 = document.createElement('div');
    refs[235] = __ref_235;
    __ref_235.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_235.setAttribute('class', 'thread-line thread-c');
    __ref_236.append(__ref_235);
    __ref_314.append(__ref_236);
    const __ref_273 = document.createElement('section');
    refs[273] = __ref_273;
    __ref_273.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_273.setAttribute('class', 'encounter');
    const __ref_255 = document.createElement('div');
    refs[255] = __ref_255;
    __ref_255.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_255.setAttribute('class', 'object-view');
    const __ref_240 = document.createElement('div');
    refs[240] = __ref_240;
    __ref_240.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_240.setAttribute('class', 'object-image');
    const __ref_237 = document.createElement('img');
    refs[237] = __ref_237;
    __ref_237.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_240.append(__ref_237);
    const __ref_239 = document.createElement('span');
    refs[239] = __ref_239;
    __ref_239.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_238 = document.createTextNode('');
    refs[238] = __ref_238;
    __ref_239.append(__ref_238);
    __ref_240.append(__ref_239);
    __ref_255.append(__ref_240);
    const __ref_254 = document.createElement('div');
    refs[254] = __ref_254;
    __ref_254.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_254.setAttribute('class', 'object-story');
    const __ref_242 = document.createElement('div');
    refs[242] = __ref_242;
    __ref_242.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_242.setAttribute('class', 'overline');
    __ref_242.append(document.createTextNode('You are near · Met '));
    const __ref_241 = document.createTextNode('');
    refs[241] = __ref_241;
    __ref_242.append(__ref_241);
    __ref_254.append(__ref_242);
    const __ref_244 = document.createElement('h2');
    refs[244] = __ref_244;
    __ref_244.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_243 = document.createTextNode('');
    refs[243] = __ref_243;
    __ref_244.append(__ref_243);
    __ref_254.append(__ref_244);
    const __ref_247 = document.createElement('p');
    refs[247] = __ref_247;
    __ref_247.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_247.setAttribute('class', 'maker');
    const __ref_245 = document.createTextNode('');
    refs[245] = __ref_245;
    __ref_247.append(__ref_245);
    __ref_247.append(document.createTextNode(' · '));
    const __ref_246 = document.createTextNode('');
    refs[246] = __ref_246;
    __ref_247.append(__ref_246);
    __ref_254.append(__ref_247);
    const __ref_249 = document.createElement('p');
    refs[249] = __ref_249;
    __ref_249.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_248 = document.createTextNode('');
    refs[248] = __ref_248;
    __ref_249.append(__ref_248);
    __ref_254.append(__ref_249);
    const __ref_253 = document.createElement('div');
    refs[253] = __ref_253;
    __ref_253.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_253.setAttribute('class', 'source-line');
    const __ref_251 = document.createElement('span');
    refs[251] = __ref_251;
    __ref_251.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_251.append(document.createTextNode('Collection record · '));
    const __ref_250 = document.createTextNode('');
    refs[250] = __ref_250;
    __ref_251.append(__ref_250);
    __ref_253.append(__ref_251);
    const __ref_252 = document.createElement('a');
    refs[252] = __ref_252;
    __ref_252.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_252.setAttribute('target', '_blank');
    __ref_252.setAttribute('rel', 'noreferrer');
    __ref_252.append(document.createTextNode('Visit The Met ↗'));
    __ref_253.append(__ref_252);
    __ref_254.append(__ref_253);
    __ref_255.append(__ref_254);
    __ref_273.append(__ref_255);
    const __ref_272 = document.createElement('aside');
    refs[272] = __ref_272;
    __ref_272.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_272.setAttribute('class', 'leave-something');
    const __ref_256 = document.createElement('div');
    refs[256] = __ref_256;
    __ref_256.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_256.setAttribute('class', 'overline');
    __ref_256.append(document.createTextNode('Leave something behind'));
    __ref_272.append(__ref_256);
    const __ref_257 = document.createElement('h3');
    refs[257] = __ref_257;
    __ref_257.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_257.append(document.createTextNode('What did this object make you notice?'));
    __ref_272.append(__ref_257);
    const __ref_258 = document.createElement('textarea');
    refs[258] = __ref_258;
    __ref_258.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_258.setAttribute('maxlength', '360');
    __ref_258.setAttribute('placeholder', 'An interpretation, a question, an image…');
    __ref_258.addEventListener('input', (event) => {
      const resolved = scope.updateThought;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_272.append(__ref_258);
    const __ref_259 = document.createElement('button');
    refs[259] = __ref_259;
    __ref_259.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_259.addEventListener('click', (event) => {
      const resolved = scope.leaveThought;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_259.append(document.createTextNode('Let the world hear it'));
    __ref_272.append(__ref_259);
    const __ref_262 = document.createElement('div');
    refs[262] = __ref_262;
    __ref_262.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_262.setAttribute('class', 'or');
    const __ref_260 = document.createElement('span');
    refs[260] = __ref_260;
    __ref_260.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_262.append(__ref_260);
    __ref_262.append(document.createTextNode('or draw a trail'));
    const __ref_261 = document.createElement('span');
    refs[261] = __ref_261;
    __ref_261.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_262.append(__ref_261);
    __ref_272.append(__ref_262);
    const __ref_269 = document.createElement('select');
    refs[269] = __ref_269;
    __ref_269.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_269.addEventListener('change', (event) => {
      const resolved = scope.updateTrailTarget;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_263 = document.createElement('option');
    refs[263] = __ref_263;
    __ref_263.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_263.setAttribute('value', '');
    __ref_263.append(document.createTextNode('Choose another object'));
    __ref_269.append(__ref_263);
    const __ref_264 = document.createComment('for:start');
    const __ref_265 = document.createComment('for:end');
    refs[264] = __ref_264;
    refs[265] = __ref_265;
    refs[266] = [];
    __ref_269.append(__ref_264);
    __ref_269.append(__ref_265);
    __ref_272.append(__ref_269);
    const __ref_270 = document.createElement('input');
    refs[270] = __ref_270;
    __ref_270.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_270.setAttribute('maxlength', '120');
    __ref_270.setAttribute('placeholder', 'Name the connection');
    __ref_270.addEventListener('input', (event) => {
      const resolved = scope.updateTrail;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_272.append(__ref_270);
    const __ref_271 = document.createElement('button');
    refs[271] = __ref_271;
    __ref_271.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_271.setAttribute('class', 'secondary');
    __ref_271.addEventListener('click', (event) => {
      const resolved = scope.drawTrail;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_271.append(document.createTextNode('Make this path visible'));
    __ref_272.append(__ref_271);
    __ref_273.append(__ref_272);
    __ref_314.append(__ref_273);
    const __ref_274 = document.createComment('if:start');
    const __ref_275 = document.createComment('if:end');
    refs[274] = __ref_274;
    refs[275] = __ref_275;
    refs[276] = undefined;
    __ref_314.append(__ref_274);
    __ref_314.append(__ref_275);
    const __ref_313 = document.createElement('section');
    refs[313] = __ref_313;
    __ref_313.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_313.setAttribute('class', 'shared-memory');
    const __ref_287 = document.createElement('div');
    refs[287] = __ref_287;
    __ref_287.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_287.setAttribute('class', 'section-head');
    const __ref_283 = document.createElement('div');
    refs[283] = __ref_283;
    __ref_283.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_281 = document.createElement('div');
    refs[281] = __ref_281;
    __ref_281.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_281.setAttribute('class', 'overline');
    __ref_281.append(document.createTextNode('Shared memory'));
    __ref_283.append(__ref_281);
    const __ref_282 = document.createElement('h2');
    refs[282] = __ref_282;
    __ref_282.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_282.append(document.createTextNode('What people have left nearby'));
    __ref_283.append(__ref_282);
    __ref_287.append(__ref_283);
    const __ref_286 = document.createElement('small');
    refs[286] = __ref_286;
    __ref_286.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_284 = document.createTextNode('');
    refs[284] = __ref_284;
    __ref_286.append(__ref_284);
    __ref_286.append(document.createTextNode(' interpretations · '));
    const __ref_285 = document.createTextNode('');
    refs[285] = __ref_285;
    __ref_286.append(__ref_285);
    __ref_286.append(document.createTextNode(' visitor trails'));
    __ref_287.append(__ref_286);
    __ref_313.append(__ref_287);
    const __ref_288 = document.createComment('if:start');
    const __ref_289 = document.createComment('if:end');
    refs[288] = __ref_288;
    refs[289] = __ref_289;
    refs[290] = undefined;
    __ref_313.append(__ref_288);
    __ref_313.append(__ref_289);
    const __ref_301 = document.createElement('div');
    refs[301] = __ref_301;
    __ref_301.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_301.setAttribute('class', 'thought-grid');
    const __ref_292 = document.createComment('for:start');
    const __ref_293 = document.createComment('for:end');
    refs[292] = __ref_292;
    refs[293] = __ref_293;
    refs[294] = [];
    __ref_301.append(__ref_292);
    __ref_301.append(__ref_293);
    __ref_313.append(__ref_301);
    const __ref_312 = document.createElement('div');
    refs[312] = __ref_312;
    __ref_312.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_312.setAttribute('class', 'trail-list');
    const __ref_302 = document.createComment('for:start');
    const __ref_303 = document.createComment('for:end');
    refs[302] = __ref_302;
    refs[303] = __ref_303;
    refs[304] = [];
    __ref_312.append(__ref_302);
    __ref_312.append(__ref_303);
    __ref_313.append(__ref_312);
    __ref_314.append(__ref_313);
    fragment.append(__ref_314);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_113(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[118] === true) {
      if (refs[130] === true) {
      } else {
      }
      if (refs[148] === true) {
      } else {
      }
      if (refs[159] === true) {
      } else {
      }
      if (refs[175] === true) {
      } else {
      }
      if (refs[190] === true) {
      } else {
      }
    } else {
    }
    if (refs[202] === true) {
      if (refs[212] === true) {
      } else {
      }
    } else {
    }
    const __records_222 = refs[222] ?? [];
    for (const record of __records_222) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_266 = refs[266] ?? [];
    for (const record of __records_266) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    if (refs[276] === true) {
    } else {
    }
    if (refs[290] === true) {
    } else {
    }
    const __records_294 = refs[294] ?? [];
    for (const record of __records_294) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_304 = refs[304] ?? [];
    for (const record of __records_304) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_113(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.showHow);
  if (refs[115] !== next) {
    const previous = refs[115];
    destroyConditionalBranch_113(instance, previous === true);
    refs[115] = next;
    replaceBetween(refs[113], refs[114], createConditionalFragment_113(instance, scope, next));
  }
  if (next) {
    updateRegion_conditional_116(instance, scope, refs);
    updateRegion_conditional_200(instance, scope, refs);
    updateRegion_loop_220(instance, scope, refs);
    updateRegion_attribute_237_src(instance, scope, refs);
    updateRegion_attribute_237_alt(instance, scope, refs);
    updateRegion_text_238(instance, scope, refs);
    updateRegion_text_241(instance, scope, refs);
    updateRegion_text_243(instance, scope, refs);
    updateRegion_text_245(instance, scope, refs);
    updateRegion_text_246(instance, scope, refs);
    updateRegion_text_248(instance, scope, refs);
    updateRegion_text_250(instance, scope, refs);
    updateRegion_attribute_252_href(instance, scope, refs);
    updateRegion_attribute_258_value(instance, scope, refs);
    updateRegion_attribute_259_disabled(instance, scope, refs);
    updateRegion_attribute_269_value(instance, scope, refs);
    updateRegion_loop_264(instance, scope, refs);
    updateRegion_attribute_270_value(instance, scope, refs);
    updateRegion_attribute_271_disabled(instance, scope, refs);
    updateRegion_conditional_274(instance, scope, refs);
    updateRegion_text_284(instance, scope, refs);
    updateRegion_text_285(instance, scope, refs);
    updateRegion_conditional_288(instance, scope, refs);
    updateRegion_loop_292(instance, scope, refs);
    updateRegion_loop_302(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_116(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_199 = document.createElement('section');
    refs[199] = __ref_199;
    __ref_199.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_199.setAttribute('class', 'guide-card');
    const __ref_122 = document.createElement('div');
    refs[122] = __ref_122;
    __ref_122.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_122.setAttribute('class', 'guide-progress');
    const __ref_119 = document.createElement('span');
    refs[119] = __ref_119;
    __ref_119.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_119.append(document.createTextNode('First expedition'));
    __ref_122.append(__ref_119);
    const __ref_121 = document.createElement('b');
    refs[121] = __ref_121;
    __ref_121.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_120 = document.createTextNode('');
    refs[120] = __ref_120;
    __ref_121.append(__ref_120);
    __ref_122.append(__ref_121);
    __ref_199.append(__ref_122);
    const __ref_127 = document.createElement('div');
    refs[127] = __ref_127;
    __ref_127.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_127.setAttribute('class', 'guide-head');
    const __ref_125 = document.createElement('div');
    refs[125] = __ref_125;
    __ref_125.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_123 = document.createElement('div');
    refs[123] = __ref_123;
    __ref_123.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_123.setAttribute('class', 'overline');
    __ref_123.append(document.createTextNode('A small purpose, not a right answer'));
    __ref_125.append(__ref_123);
    const __ref_124 = document.createElement('h1');
    refs[124] = __ref_124;
    __ref_124.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_124.append(document.createTextNode('Together, discover what connects these objects.'));
    __ref_125.append(__ref_124);
    __ref_127.append(__ref_125);
    const __ref_126 = document.createElement('p');
    refs[126] = __ref_126;
    __ref_126.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_126.append(
      document.createTextNode(
        'Your thread will become part of the shared world. Another visitor can follow it—or challenge it.',
      ),
    );
    __ref_127.append(__ref_126);
    __ref_199.append(__ref_127);
    const __ref_128 = document.createComment('if:start');
    const __ref_129 = document.createComment('if:end');
    refs[128] = __ref_128;
    refs[129] = __ref_129;
    refs[130] = undefined;
    __ref_199.append(__ref_128);
    __ref_199.append(__ref_129);
    const __ref_146 = document.createComment('if:start');
    const __ref_147 = document.createComment('if:end');
    refs[146] = __ref_146;
    refs[147] = __ref_147;
    refs[148] = undefined;
    __ref_199.append(__ref_146);
    __ref_199.append(__ref_147);
    const __ref_157 = document.createComment('if:start');
    const __ref_158 = document.createComment('if:end');
    refs[157] = __ref_157;
    refs[158] = __ref_158;
    refs[159] = undefined;
    __ref_199.append(__ref_157);
    __ref_199.append(__ref_158);
    const __ref_173 = document.createComment('if:start');
    const __ref_174 = document.createComment('if:end');
    refs[173] = __ref_173;
    refs[174] = __ref_174;
    refs[175] = undefined;
    __ref_199.append(__ref_173);
    __ref_199.append(__ref_174);
    const __ref_188 = document.createComment('if:start');
    const __ref_189 = document.createComment('if:end');
    refs[188] = __ref_188;
    refs[189] = __ref_189;
    refs[190] = undefined;
    __ref_199.append(__ref_188);
    __ref_199.append(__ref_189);
    fragment.append(__ref_199);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_116(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[130] === true) {
    } else {
    }
    if (refs[148] === true) {
    } else {
    }
    if (refs[159] === true) {
    } else {
    }
    if (refs[175] === true) {
    } else {
    }
    if (refs[190] === true) {
    } else {
    }
  } else {
  }
}

function updateConditional_116(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.guideActive);
  if (refs[118] !== next) {
    const previous = refs[118];
    destroyConditionalBranch_116(instance, previous === true);
    refs[118] = next;
    replaceBetween(refs[116], refs[117], createConditionalFragment_116(instance, scope, next));
  }
  if (next) {
    updateRegion_text_120(instance, scope, refs);
    updateRegion_conditional_128(instance, scope, refs);
    updateRegion_conditional_146(instance, scope, refs);
    updateRegion_conditional_157(instance, scope, refs);
    updateRegion_conditional_173(instance, scope, refs);
    updateRegion_conditional_188(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_128(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_145 = document.createElement('div');
    refs[145] = __ref_145;
    __ref_145.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_145.setAttribute('class', 'guide-action');
    const __ref_134 = document.createElement('div');
    refs[134] = __ref_134;
    __ref_134.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_131 = document.createElement('span');
    refs[131] = __ref_131;
    __ref_131.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_131.append(document.createTextNode('1 · Choose a lens'));
    __ref_134.append(__ref_131);
    const __ref_132 = document.createElement('h2');
    refs[132] = __ref_132;
    __ref_132.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_132.append(document.createTextNode('What will you look for?'));
    __ref_134.append(__ref_132);
    const __ref_133 = document.createElement('p');
    refs[133] = __ref_133;
    __ref_133.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_133.append(document.createTextNode('A lens changes the question, not the facts.'));
    __ref_134.append(__ref_133);
    __ref_145.append(__ref_134);
    const __ref_144 = document.createElement('div');
    refs[144] = __ref_144;
    __ref_144.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_144.setAttribute('class', 'lens-row');
    const __ref_137 = document.createElement('button');
    refs[137] = __ref_137;
    __ref_137.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_137.addEventListener('click', (event) => {
      const resolved = scope.choosePower;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_135 = document.createElement('b');
    refs[135] = __ref_135;
    __ref_135.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_135.append(document.createTextNode('Power'));
    __ref_137.append(__ref_135);
    const __ref_136 = document.createElement('small');
    refs[136] = __ref_136;
    __ref_136.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_136.append(document.createTextNode('Who gets to name, own, or command?'));
    __ref_137.append(__ref_136);
    __ref_144.append(__ref_137);
    const __ref_140 = document.createElement('button');
    refs[140] = __ref_140;
    __ref_140.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_140.addEventListener('click', (event) => {
      const resolved = scope.chooseMeasure;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_138 = document.createElement('b');
    refs[138] = __ref_138;
    __ref_138.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_138.append(document.createTextNode('Measure'));
    __ref_140.append(__ref_138);
    const __ref_139 = document.createElement('small');
    refs[139] = __ref_139;
    __ref_139.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_139.append(document.createTextNode('How is the world made graspable?'));
    __ref_140.append(__ref_139);
    __ref_144.append(__ref_140);
    const __ref_143 = document.createElement('button');
    refs[143] = __ref_143;
    __ref_143.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_143.addEventListener('click', (event) => {
      const resolved = scope.chooseMemory;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_141 = document.createElement('b');
    refs[141] = __ref_141;
    __ref_141.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_141.append(document.createTextNode('Memory'));
    __ref_143.append(__ref_141);
    const __ref_142 = document.createElement('small');
    refs[142] = __ref_142;
    __ref_142.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_142.append(document.createTextNode('What survives, and what disappears?'));
    __ref_143.append(__ref_142);
    __ref_144.append(__ref_143);
    __ref_145.append(__ref_144);
    fragment.append(__ref_145);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_128(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_128(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.guideStep === 1);
  if (refs[130] !== next) {
    const previous = refs[130];
    destroyConditionalBranch_128(instance, previous === true);
    refs[130] = next;
    replaceBetween(refs[128], refs[129], createConditionalFragment_128(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_146(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_156 = document.createElement('div');
    refs[156] = __ref_156;
    __ref_156.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_156.setAttribute('class', 'guide-action compact');
    const __ref_154 = document.createElement('div');
    refs[154] = __ref_154;
    __ref_154.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_150 = document.createElement('span');
    refs[150] = __ref_150;
    __ref_150.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_150.append(document.createTextNode('2 · Inspect one artifact through '));
    const __ref_149 = document.createTextNode('');
    refs[149] = __ref_149;
    __ref_150.append(__ref_149);
    __ref_154.append(__ref_150);
    const __ref_152 = document.createElement('h2');
    refs[152] = __ref_152;
    __ref_152.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_152.append(document.createTextNode('Begin with '));
    const __ref_151 = document.createTextNode('');
    refs[151] = __ref_151;
    __ref_152.append(__ref_151);
    __ref_152.append(document.createTextNode('.'));
    __ref_154.append(__ref_152);
    const __ref_153 = document.createElement('p');
    refs[153] = __ref_153;
    __ref_153.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_153.append(
      document.createTextNode(
        'Notice one detail in its image or record. There is no hidden answer.',
      ),
    );
    __ref_154.append(__ref_153);
    __ref_156.append(__ref_154);
    const __ref_155 = document.createElement('button');
    refs[155] = __ref_155;
    __ref_155.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_155.setAttribute('class', 'guide-primary');
    __ref_155.addEventListener('click', (event) => {
      const resolved = scope.beginThread;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_155.append(document.createTextNode('I noticed something →'));
    __ref_156.append(__ref_155);
    fragment.append(__ref_156);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_146(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_146(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.guideStep === 2);
  if (refs[148] !== next) {
    const previous = refs[148];
    destroyConditionalBranch_146(instance, previous === true);
    refs[148] = next;
    replaceBetween(refs[146], refs[147], createConditionalFragment_146(instance, scope, next));
  }
  if (next) {
    updateRegion_text_149(instance, scope, refs);
    updateRegion_text_151(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_157(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_172 = document.createElement('div');
    refs[172] = __ref_172;
    __ref_172.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_172.setAttribute('class', 'guide-action compact');
    const __ref_164 = document.createElement('div');
    refs[164] = __ref_164;
    __ref_164.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_160 = document.createElement('span');
    refs[160] = __ref_160;
    __ref_160.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_160.append(document.createTextNode('3 · Pull a thread'));
    __ref_164.append(__ref_160);
    const __ref_161 = document.createElement('h2');
    refs[161] = __ref_161;
    __ref_161.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_161.append(document.createTextNode('Choose a second object.'));
    __ref_164.append(__ref_161);
    const __ref_163 = document.createElement('p');
    refs[163] = __ref_163;
    __ref_163.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_163.append(
      document.createTextNode(
        'Which one changes what the first artifact means through the lens of ',
      ),
    );
    const __ref_162 = document.createTextNode('');
    refs[162] = __ref_162;
    __ref_163.append(__ref_162);
    __ref_163.append(document.createTextNode('?'));
    __ref_164.append(__ref_163);
    __ref_172.append(__ref_164);
    const __ref_171 = document.createElement('div');
    refs[171] = __ref_171;
    __ref_171.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_171.setAttribute('class', 'target-row');
    const __ref_166 = document.createElement('button');
    refs[166] = __ref_166;
    __ref_166.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_166.addEventListener('click', (event) => {
      const resolved = scope.chooseTargetZero;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_165 = document.createTextNode('');
    refs[165] = __ref_165;
    __ref_166.append(__ref_165);
    __ref_166.append(document.createTextNode(' →'));
    __ref_171.append(__ref_166);
    const __ref_168 = document.createElement('button');
    refs[168] = __ref_168;
    __ref_168.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_168.addEventListener('click', (event) => {
      const resolved = scope.chooseTargetOne;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_167 = document.createTextNode('');
    refs[167] = __ref_167;
    __ref_168.append(__ref_167);
    __ref_168.append(document.createTextNode(' →'));
    __ref_171.append(__ref_168);
    const __ref_170 = document.createElement('button');
    refs[170] = __ref_170;
    __ref_170.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_170.addEventListener('click', (event) => {
      const resolved = scope.chooseTargetTwo;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_169 = document.createTextNode('');
    refs[169] = __ref_169;
    __ref_170.append(__ref_169);
    __ref_170.append(document.createTextNode(' →'));
    __ref_171.append(__ref_170);
    __ref_172.append(__ref_171);
    fragment.append(__ref_172);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_157(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_157(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.guideStep === 3);
  if (refs[159] !== next) {
    const previous = refs[159];
    destroyConditionalBranch_157(instance, previous === true);
    refs[159] = next;
    replaceBetween(refs[157], refs[158], createConditionalFragment_157(instance, scope, next));
  }
  if (next) {
    updateRegion_text_162(instance, scope, refs);
    updateRegion_text_165(instance, scope, refs);
    updateRegion_text_167(instance, scope, refs);
    updateRegion_text_169(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_173(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_187 = document.createElement('div');
    refs[187] = __ref_187;
    __ref_187.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_187.setAttribute('class', 'guide-action connection-step');
    const __ref_180 = document.createElement('div');
    refs[180] = __ref_180;
    __ref_180.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_176 = document.createElement('span');
    refs[176] = __ref_176;
    __ref_176.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_176.append(document.createTextNode('4 · Make or challenge a connection'));
    __ref_180.append(__ref_176);
    const __ref_178 = document.createElement('h2');
    refs[178] = __ref_178;
    __ref_178.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_177 = document.createTextNode('');
    refs[177] = __ref_177;
    __ref_178.append(__ref_177);
    __ref_180.append(__ref_178);
    const __ref_179 = document.createElement('p');
    refs[179] = __ref_179;
    __ref_179.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_179.append(
      document.createTextNode(
        'Say what holds the two together—or why the obvious connection breaks.',
      ),
    );
    __ref_180.append(__ref_179);
    __ref_187.append(__ref_180);
    const __ref_183 = document.createElement('div');
    refs[183] = __ref_183;
    __ref_183.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_183.setAttribute('class', 'stance-row');
    const __ref_181 = document.createElement('button');
    refs[181] = __ref_181;
    __ref_181.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_181.addEventListener('click', (event) => {
      const resolved = scope.chooseMake;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_181.append(document.createTextNode('Make'));
    __ref_183.append(__ref_181);
    const __ref_182 = document.createElement('button');
    refs[182] = __ref_182;
    __ref_182.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_182.addEventListener('click', (event) => {
      const resolved = scope.chooseChallenge;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_182.append(document.createTextNode('Challenge'));
    __ref_183.append(__ref_182);
    __ref_187.append(__ref_183);
    const __ref_184 = document.createElement('input');
    refs[184] = __ref_184;
    __ref_184.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_184.setAttribute('maxlength', '120');
    __ref_184.setAttribute('placeholder', 'Because both… / Unlike the first…');
    __ref_184.addEventListener('input', (event) => {
      const resolved = scope.updateGuideReason;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_187.append(__ref_184);
    const __ref_186 = document.createElement('button');
    refs[186] = __ref_186;
    __ref_186.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_186.setAttribute('class', 'guide-primary');
    __ref_186.addEventListener('click', (event) => {
      const resolved = scope.revealEcho;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_185 = document.createTextNode('');
    refs[185] = __ref_185;
    __ref_186.append(__ref_185);
    __ref_187.append(__ref_186);
    fragment.append(__ref_187);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_173(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_173(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.guideStep === 4);
  if (refs[175] !== next) {
    const previous = refs[175];
    destroyConditionalBranch_173(instance, previous === true);
    refs[175] = next;
    replaceBetween(refs[173], refs[174], createConditionalFragment_173(instance, scope, next));
  }
  if (next) {
    updateRegion_text_177(instance, scope, refs);
    updateRegion_attribute_181_class(instance, scope, refs);
    updateRegion_attribute_182_class(instance, scope, refs);
    updateRegion_attribute_184_value(instance, scope, refs);
    updateRegion_attribute_186_disabled(instance, scope, refs);
    updateRegion_text_185(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_188(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_198 = document.createElement('div');
    refs[198] = __ref_198;
    __ref_198.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_198.setAttribute('class', 'guide-action echo-step');
    const __ref_196 = document.createElement('div');
    refs[196] = __ref_196;
    __ref_196.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_191 = document.createElement('span');
    refs[191] = __ref_191;
    __ref_191.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_191.append(document.createTextNode('✦ The world answered'));
    __ref_196.append(__ref_191);
    const __ref_192 = document.createElement('h2');
    refs[192] = __ref_192;
    __ref_192.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_192.append(document.createTextNode('Your thread is now part of the constellation.'));
    __ref_196.append(__ref_192);
    const __ref_194 = document.createElement('p');
    refs[194] = __ref_194;
    __ref_194.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_193 = document.createTextNode('');
    refs[193] = __ref_193;
    __ref_194.append(__ref_193);
    __ref_196.append(__ref_194);
    const __ref_195 = document.createElement('small');
    refs[195] = __ref_195;
    __ref_195.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_195.append(
      document.createTextNode('It will remain here for the next visitor to follow or challenge.'),
    );
    __ref_196.append(__ref_195);
    __ref_198.append(__ref_196);
    const __ref_197 = document.createElement('button');
    refs[197] = __ref_197;
    __ref_197.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_197.setAttribute('class', 'guide-primary');
    __ref_197.addEventListener('click', (event) => {
      const resolved = scope.finishGuide;
      if (typeof resolved === 'function') {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_197.append(document.createTextNode('Keep exploring freely →'));
    __ref_198.append(__ref_197);
    fragment.append(__ref_198);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_188(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_188(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.guideStep === 5);
  if (refs[190] !== next) {
    const previous = refs[190];
    destroyConditionalBranch_188(instance, previous === true);
    refs[190] = next;
    replaceBetween(refs[188], refs[189], createConditionalFragment_188(instance, scope, next));
  }
  if (next) {
    updateRegion_text_193(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_200(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_219 = document.createElement('section');
    refs[219] = __ref_219;
    __ref_219.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_219.setAttribute('class', 'world-intro');
    const __ref_209 = document.createElement('div');
    refs[209] = __ref_209;
    __ref_209.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_204 = document.createElement('div');
    refs[204] = __ref_204;
    __ref_204.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_204.setAttribute('class', 'overline');
    __ref_204.append(document.createTextNode('A living constellation · '));
    const __ref_203 = document.createTextNode('');
    refs[203] = __ref_203;
    __ref_204.append(__ref_203);
    __ref_209.append(__ref_204);
    const __ref_206 = document.createElement('h1');
    refs[206] = __ref_206;
    __ref_206.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_205 = document.createTextNode('');
    refs[205] = __ref_205;
    __ref_206.append(__ref_205);
    __ref_209.append(__ref_206);
    const __ref_208 = document.createElement('p');
    refs[208] = __ref_208;
    __ref_208.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_207 = document.createTextNode('');
    refs[207] = __ref_207;
    __ref_208.append(__ref_207);
    __ref_209.append(__ref_208);
    __ref_219.append(__ref_209);
    const __ref_210 = document.createComment('if:start');
    const __ref_211 = document.createComment('if:end');
    refs[210] = __ref_210;
    refs[211] = __ref_211;
    refs[212] = undefined;
    __ref_219.append(__ref_210);
    __ref_219.append(__ref_211);
    fragment.append(__ref_219);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_200(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[212] === true) {
    } else {
    }
  } else {
  }
}

function updateConditional_200(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.guideActive);
  if (refs[202] !== next) {
    const previous = refs[202];
    destroyConditionalBranch_200(instance, previous === true);
    refs[202] = next;
    replaceBetween(refs[200], refs[201], createConditionalFragment_200(instance, scope, next));
  }
  if (next) {
    updateRegion_text_203(instance, scope, refs);
    updateRegion_text_205(instance, scope, refs);
    updateRegion_text_207(instance, scope, refs);
    updateRegion_conditional_210(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_210(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_218 = document.createElement('div');
    refs[218] = __ref_218;
    __ref_218.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_218.setAttribute('class', 'return-note');
    const __ref_213 = document.createElement('span');
    refs[213] = __ref_213;
    __ref_213.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_213.append(document.createTextNode('The Keeper of Nearness'));
    __ref_218.append(__ref_213);
    const __ref_215 = document.createElement('p');
    refs[215] = __ref_215;
    __ref_215.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_214 = document.createTextNode('');
    refs[214] = __ref_214;
    __ref_215.append(__ref_214);
    __ref_218.append(__ref_215);
    const __ref_217 = document.createElement('b');
    refs[217] = __ref_217;
    __ref_217.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_216 = document.createTextNode('');
    refs[216] = __ref_216;
    __ref_217.append(__ref_216);
    __ref_218.append(__ref_217);
    fragment.append(__ref_218);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_210(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_210(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.perspective);
  if (refs[212] !== next) {
    const previous = refs[212];
    destroyConditionalBranch_210(instance, previous === true);
    refs[212] = next;
    replaceBetween(refs[210], refs[211], createConditionalFragment_210(instance, scope, next));
  }
  if (next) {
    updateRegion_text_214(instance, scope, refs);
    updateRegion_text_216(instance, scope, refs);
  } else {
  }
}

function createForEntry_220(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['item']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['item']: currentItem };
    updateRegion_attribute_232_class(instance, loopScope, entryRefs);
    updateRegion_attribute_232_title(instance, loopScope, entryRefs);
    updateRegion_attribute_223_src(instance, loopScope, entryRefs);
    updateRegion_text_224(instance, loopScope, entryRefs);
    updateRegion_text_226(instance, loopScope, entryRefs);
    updateRegion_text_228(instance, loopScope, entryRefs);
    updateRegion_text_229(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_232 = document.createElement('button');
  entryRefs[232] = __ref_232;
  __ref_232.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_232.addEventListener('click', (event) => {
    const resolved = loopScope.wanderTo(loopScope.item.id);
    if (typeof resolved === 'function') {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_223 = document.createElement('img');
  entryRefs[223] = __ref_223;
  __ref_223.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_223.setAttribute('alt', '');
  __ref_232.append(__ref_223);
  const __ref_225 = document.createElement('span');
  entryRefs[225] = __ref_225;
  __ref_225.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_225.setAttribute('class', 'node-number');
  const __ref_224 = document.createTextNode('');
  entryRefs[224] = __ref_224;
  __ref_225.append(__ref_224);
  __ref_232.append(__ref_225);
  const __ref_231 = document.createElement('span');
  entryRefs[231] = __ref_231;
  __ref_231.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_231.setAttribute('class', 'node-copy');
  const __ref_227 = document.createElement('b');
  entryRefs[227] = __ref_227;
  __ref_227.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_226 = document.createTextNode('');
  entryRefs[226] = __ref_226;
  __ref_227.append(__ref_226);
  __ref_231.append(__ref_227);
  const __ref_230 = document.createElement('small');
  entryRefs[230] = __ref_230;
  __ref_230.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_228 = document.createTextNode('');
  entryRefs[228] = __ref_228;
  __ref_230.append(__ref_228);
  __ref_230.append(document.createTextNode(' · '));
  const __ref_229 = document.createTextNode('');
  entryRefs[229] = __ref_229;
  __ref_230.append(__ref_229);
  __ref_231.append(__ref_230);
  __ref_232.append(__ref_231);
  fragment.append(__ref_232);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_220(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.data.objects ?? [];
  const previous = refs[222] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[221]);
    } else {
      record = createForEntry_220(instance, scope, item, refs[221]);
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
  refs[222] = nextRecords;
}

function createForEntry_264(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['item']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['item']: currentItem };
    updateRegion_attribute_268_value(instance, loopScope, entryRefs);
    updateRegion_text_267(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_268 = document.createElement('option');
  entryRefs[268] = __ref_268;
  __ref_268.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_267 = document.createTextNode('');
  entryRefs[267] = __ref_267;
  __ref_268.append(__ref_267);
  fragment.append(__ref_268);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_264(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.otherObjects ?? [];
  const previous = refs[266] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[265]);
    } else {
      record = createForEntry_264(instance, scope, item, refs[265]);
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
  refs[266] = nextRecords;
}

function createConditionalFragment_274(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_280 = document.createElement('section');
    refs[280] = __ref_280;
    __ref_280.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_280.setAttribute('class', 'bloom');
    const __ref_277 = document.createElement('span');
    refs[277] = __ref_277;
    __ref_277.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_277.append(document.createTextNode('✦ The constellation shifted'));
    __ref_280.append(__ref_277);
    const __ref_279 = document.createElement('p');
    refs[279] = __ref_279;
    __ref_279.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    const __ref_278 = document.createTextNode('');
    refs[278] = __ref_278;
    __ref_279.append(__ref_278);
    __ref_280.append(__ref_279);
    fragment.append(__ref_280);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_274(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_274(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.latestReaction);
  if (refs[276] !== next) {
    const previous = refs[276];
    destroyConditionalBranch_274(instance, previous === true);
    refs[276] = next;
    replaceBetween(refs[274], refs[275], createConditionalFragment_274(instance, scope, next));
  }
  if (next) {
    updateRegion_text_278(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_288(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_291 = document.createElement('div');
    refs[291] = __ref_291;
    __ref_291.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
    __ref_291.setAttribute('class', 'quiet');
    __ref_291.append(
      document.createTextNode(
        'No one has left words beside this object yet. Silence is part of the world too.',
      ),
    );
    fragment.append(__ref_291);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_288(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_288(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.nearbyThoughts.length === 0);
  if (refs[290] !== next) {
    const previous = refs[290];
    destroyConditionalBranch_288(instance, previous === true);
    refs[290] = next;
    replaceBetween(refs[288], refs[289], createConditionalFragment_288(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createForEntry_292(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment('for:item:start');
  const end = document.createComment('for:item:end');
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ['thought']: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ['thought']: currentItem };
    updateRegion_text_295(instance, loopScope, entryRefs);
    updateRegion_text_297(instance, loopScope, entryRefs);
    updateRegion_text_298(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_300 = document.createElement('blockquote');
  entryRefs[300] = __ref_300;
  __ref_300.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_296 = document.createElement('p');
  entryRefs[296] = __ref_296;
  __ref_296.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_296.append(document.createTextNode('“'));
  const __ref_295 = document.createTextNode('');
  entryRefs[295] = __ref_295;
  __ref_296.append(__ref_295);
  __ref_296.append(document.createTextNode('”'));
  __ref_300.append(__ref_296);
  const __ref_299 = document.createElement('footer');
  entryRefs[299] = __ref_299;
  __ref_299.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_297 = document.createTextNode('');
  entryRefs[297] = __ref_297;
  __ref_299.append(__ref_297);
  __ref_299.append(document.createTextNode(' · left here '));
  const __ref_298 = document.createTextNode('');
  entryRefs[298] = __ref_298;
  __ref_299.append(__ref_298);
  __ref_300.append(__ref_299);
  fragment.append(__ref_300);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_292(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.nearbyThoughts ?? [];
  const previous = refs[294] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[293]);
    } else {
      record = createForEntry_292(instance, scope, item, refs[293]);
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
  refs[294] = nextRecords;
}

function createForEntry_302(instance, scope, item, reference) {
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
    updateRegion_text_306(instance, loopScope, entryRefs);
    updateRegion_text_308(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_311 = document.createElement('article');
  entryRefs[311] = __ref_311;
  __ref_311.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_305 = document.createElement('i');
  entryRefs[305] = __ref_305;
  __ref_305.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_305.append(document.createTextNode('↝'));
  __ref_311.append(__ref_305);
  const __ref_310 = document.createElement('div');
  entryRefs[310] = __ref_310;
  __ref_310.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_307 = document.createElement('b');
  entryRefs[307] = __ref_307;
  __ref_307.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_306 = document.createTextNode('');
  entryRefs[306] = __ref_306;
  __ref_307.append(__ref_306);
  __ref_310.append(__ref_307);
  const __ref_309 = document.createElement('small');
  entryRefs[309] = __ref_309;
  __ref_309.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  const __ref_308 = document.createTextNode('');
  entryRefs[308] = __ref_308;
  __ref_309.append(__ref_308);
  __ref_310.append(__ref_309);
  __ref_311.append(__ref_310);
  fragment.append(__ref_311);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_302(instance, scope) {
  const refs = instance.refs;
  const iterable = scope.nearbyTrails ?? [];
  const previous = refs[304] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[303]);
    } else {
      record = createForEntry_302(instance, scope, item, refs[303]);
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
  refs[304] = nextRecords;
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
  let selected = {
    id: 0,
    title: '',
    maker: '',
    date: '',
    material: '',
    kind: '',
    image: '',
    source: {},
  };
  let otherObjects = [];
  let nearbyThoughts = [];
  let nearbyTrails = [];
  let perspective = null;
  let initialized = false;
  let busy = false;
  let showEntrance = true;
  let showHow = false;
  let errorMessage = '';
  let draftName = '';
  let draftThought = '';
  let trailTarget = '';
  let draftTrail = '';
  let latestReaction = '';
  let auth = null;
  let guideActive = true;
  let guideStep = 1;
  let guideLens = '';
  let guideFrom = 444408;
  let guideTo = 0;
  let guideStance = '';
  let guideReason = '';
  let guideChoices = [{ title: '' }, { title: '' }, { title: '' }];
  function boot() {
    if (!initialized && typeof window !== 'undefined') {
      initialized = true;
      const saved = window.localStorage.getItem('quest-world-visitor');
      if (saved) {
        try {
          auth = JSON.parse(saved);
        } catch {
          auth = null;
        }
      }
      guideActive = window.localStorage.getItem('quest-first-expedition') !== 'complete';
      if (auth) queueMicrotask(returnToWorld);
      window.setInterval(() => {
        if (auth && !busy && !showEntrance) load();
      }, 3500);
    }
    return '';
  }
  async function api(path, body) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'x-quest-token': props.token,
        ...(auth ? { 'x-visitor-token': auth.visitorToken } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'The world could not answer');
    return value;
  }
  async function enterWorld() {
    if (busy) return;
    busy = true;
    try {
      const result = await api('/api/visitors', { name: draftName });
      auth = {
        visitorId: result.visitorId,
        visitorToken: result.visitorToken,
      };
      window.localStorage.setItem('quest-world-visitor', JSON.stringify(auth));
      perspective = result.perspective;
      showEntrance = false;
      await load();
    } catch (error) {
      errorMessage = message(error);
    } finally {
      busy = false;
    }
  }
  async function returnToWorld() {
    busy = true;
    try {
      const result = await api('/api/return', {});
      perspective = result.perspective;
      showEntrance = false;
      await load();
    } catch (error) {
      window.localStorage.removeItem('quest-world-visitor');
      auth = null;
      showEntrance = true;
      errorMessage = message(error);
    } finally {
      busy = false;
    }
  }
  async function load() {
    try {
      applyState(await api('/api/world'));
    } catch (error) {
      errorMessage = message(error);
    }
  }
  function applyState(next) {
    data = next;
    selected = next.objects.find((item) => item.id === next.selectedObjectId) || next.objects[0];
    otherObjects = next.objects.filter((item) => item.id !== selected.id);
    nearbyThoughts = next.interpretations.filter((item) => item.object_id === selected.id);
    nearbyTrails = next.connections.filter(
      (item) => item.from === selected.id || item.to === selected.id,
    );
    errorMessage = '';
  }
  async function wanderTo(objectId) {
    if (busy || objectId === selected.id) return;
    busy = true;
    latestReaction = '';
    try {
      const result = await api('/api/wander', { objectId });
      perspective = result.perspective;
      await load();
    } catch (error) {
      errorMessage = message(error);
    } finally {
      busy = false;
    }
  }
  async function leaveThought() {
    if (busy) return;
    busy = true;
    try {
      const result = await api('/api/interpret', {
        objectId: selected.id,
        text: draftThought,
      });
      latestReaction = result.text;
      draftThought = '';
      await load();
    } catch (error) {
      errorMessage = message(error);
    } finally {
      busy = false;
    }
  }
  async function drawTrail() {
    if (busy) return;
    busy = true;
    try {
      const result = await api('/api/connect', {
        from: selected.id,
        to: Number(trailTarget),
        label: draftTrail,
      });
      latestReaction = result.text;
      draftTrail = '';
      trailTarget = '';
      await load();
    } catch (error) {
      errorMessage = message(error);
    } finally {
      busy = false;
    }
  }
  function updateName(event) {
    draftName = fieldValue(event);
  }
  function updateThought(event) {
    draftThought = fieldValue(event);
  }
  function updateTrail(event) {
    draftTrail = fieldValue(event);
  }
  function updateTrailTarget(event) {
    trailTarget = fieldValue(event);
  }
  function updateGuideReason(event) {
    guideReason = fieldValue(event);
  }
  function fieldValue(event) {
    return event.currentTarget.value;
  }
  function message(error) {
    return error instanceof Error ? error.message : 'The world could not answer';
  }
  function toggleHow() {
    showHow = !showHow;
  }
  function initial(name) {
    return name.slice(0, 1).toUpperCase();
  }
  function presenceLabel() {
    return data
      ? `${data.visitors.length} ${data.visitors.length === 1 ? 'visitor' : 'visitors'} in the world`
      : 'World waking';
  }
  function objectClass(id) {
    return `object-node${id === selected.id ? ' selected' : ''}${data.visits.includes(id) ? ' visited' : ''}`;
  }
  function nodeNumber(id) {
    return String(data.objects.findIndex((item) => item.id === id) + 1).padStart(2, '0');
  }
  function visitorTrailCount() {
    return data.connections.filter((trail) => trail.origin === 'visitor').length;
  }
  function trailOrigin(trail) {
    return trail.origin === 'visitor'
      ? `A path drawn by ${trail.visitor_name}`
      : 'A curatorial trail';
  }
  function shortId(value) {
    return value ? value.slice(-8) : '';
  }
  function tooShort(value) {
    return value.length < 3;
  }
  function guideProgress() {
    return guideStep === 5 ? 'Echo revealed' : `${guideStep} of 4`;
  }
  function choosePower() {
    chooseLens('Power');
  }
  function chooseMeasure() {
    chooseLens('Measure');
  }
  function chooseMemory() {
    chooseLens('Memory');
  }
  function chooseLens(lens) {
    guideLens = lens;
    guideFrom = selected.id;
    guideChoices = data.objects.filter((item) => item.id !== guideFrom);
    guideStep = 2;
  }
  function beginThread() {
    guideStep = 3;
  }
  function chooseTargetZero() {
    chooseTarget(0);
  }
  function chooseTargetOne() {
    chooseTarget(1);
  }
  function chooseTargetTwo() {
    chooseTarget(2);
  }
  function chooseTarget(index) {
    guideTo = guideChoices[index].id;
    guideStep = 4;
  }
  function chooseMake() {
    guideStance = 'Make';
  }
  function chooseChallenge() {
    guideStance = 'Challenge';
  }
  function stanceClass(value) {
    return value === guideStance ? 'active' : '';
  }
  function guidePair() {
    const left = data.objects.find((item) => item.id === guideFrom);
    const right = data.objects.find((item) => item.id === guideTo);
    return left && right ? `${left.title} ↝ ${right.title}` : 'Two objects, one thread';
  }
  async function revealEcho() {
    if (busy || !guideTo || !guideStance || tooShort(guideReason)) return;
    busy = true;
    try {
      const label = `${guideStance} through ${guideLens}: ${guideReason}`;
      const result = await api('/api/connect', {
        from: guideFrom,
        to: guideTo,
        label,
      });
      latestReaction = result.text;
      guideStep = 5;
      await load();
    } catch (error) {
      errorMessage = message(error);
    } finally {
      busy = false;
    }
  }
  function finishGuide() {
    guideActive = false;
    window.localStorage.setItem('quest-first-expedition', 'complete');
  }
  function relativeTime(value) {
    const minutes = Math.max(0, Math.round((Date.now() - value) / 6e4));
    return minutes < 1 ? 'just now' : minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;
  }
  props = __weiv_getTrackedRoot('props', props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    __weiv_scope.data = data;
    __weiv_scope.selected = selected;
    __weiv_scope.otherObjects = otherObjects;
    __weiv_scope.nearbyThoughts = nearbyThoughts;
    __weiv_scope.nearbyTrails = nearbyTrails;
    __weiv_scope.perspective = perspective;
    __weiv_scope.initialized = initialized;
    __weiv_scope.busy = busy;
    __weiv_scope.showEntrance = showEntrance;
    __weiv_scope.showHow = showHow;
    __weiv_scope.errorMessage = errorMessage;
    __weiv_scope.draftName = draftName;
    __weiv_scope.draftThought = draftThought;
    __weiv_scope.trailTarget = trailTarget;
    __weiv_scope.draftTrail = draftTrail;
    __weiv_scope.latestReaction = latestReaction;
    __weiv_scope.auth = auth;
    __weiv_scope.guideActive = guideActive;
    __weiv_scope.guideStep = guideStep;
    __weiv_scope.guideLens = guideLens;
    __weiv_scope.guideFrom = guideFrom;
    __weiv_scope.guideTo = guideTo;
    __weiv_scope.guideStance = guideStance;
    __weiv_scope.guideReason = guideReason;
    __weiv_scope.guideChoices = guideChoices;
    __weiv_scope.boot = boot;
    __weiv_scope.api = api;
    __weiv_scope.enterWorld = enterWorld;
    __weiv_scope.returnToWorld = returnToWorld;
    __weiv_scope.load = load;
    __weiv_scope.applyState = applyState;
    __weiv_scope.wanderTo = wanderTo;
    __weiv_scope.leaveThought = leaveThought;
    __weiv_scope.drawTrail = drawTrail;
    __weiv_scope.updateName = updateName;
    __weiv_scope.updateThought = updateThought;
    __weiv_scope.updateTrail = updateTrail;
    __weiv_scope.updateTrailTarget = updateTrailTarget;
    __weiv_scope.updateGuideReason = updateGuideReason;
    __weiv_scope.fieldValue = fieldValue;
    __weiv_scope.message = message;
    __weiv_scope.toggleHow = toggleHow;
    __weiv_scope.initial = initial;
    __weiv_scope.presenceLabel = presenceLabel;
    __weiv_scope.objectClass = objectClass;
    __weiv_scope.nodeNumber = nodeNumber;
    __weiv_scope.visitorTrailCount = visitorTrailCount;
    __weiv_scope.trailOrigin = trailOrigin;
    __weiv_scope.shortId = shortId;
    __weiv_scope.tooShort = tooShort;
    __weiv_scope.guideProgress = guideProgress;
    __weiv_scope.choosePower = choosePower;
    __weiv_scope.chooseMeasure = chooseMeasure;
    __weiv_scope.chooseMemory = chooseMemory;
    __weiv_scope.chooseLens = chooseLens;
    __weiv_scope.beginThread = beginThread;
    __weiv_scope.chooseTargetZero = chooseTargetZero;
    __weiv_scope.chooseTargetOne = chooseTargetOne;
    __weiv_scope.chooseTargetTwo = chooseTargetTwo;
    __weiv_scope.chooseTarget = chooseTarget;
    __weiv_scope.chooseMake = chooseMake;
    __weiv_scope.chooseChallenge = chooseChallenge;
    __weiv_scope.stanceClass = stanceClass;
    __weiv_scope.guidePair = guidePair;
    __weiv_scope.revealEcho = revealEcho;
    __weiv_scope.finishGuide = finishGuide;
    __weiv_scope.relativeTime = relativeTime;
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

export const scopeId = 'wA579BFDD41CFAA32';
export const css =
  '\n  [data-weiv-scope="wA579BFDD41CFAA32"]:global(:root), [data-weiv-scope="wA579BFDD41CFAA32"] :global(:root) { --night:#121815; --forest:#1d2823; --paper:#f0eadb; --cream:#faf6eb; --ink:#17201d; --gold:#d5ad5c; --rust:#9b4c3d; --sage:#91a99a; --line:#d8cfbb; }\n  [data-weiv-scope="wA579BFDD41CFAA32"]:global(*), [data-weiv-scope="wA579BFDD41CFAA32"] :global(*) { box-sizing:border-box; }\n  [data-weiv-scope="wA579BFDD41CFAA32"]:global(body), [data-weiv-scope="wA579BFDD41CFAA32"] :global(body) { margin:0; background:var(--night); color:var(--ink); font-family:Inter,ui-sans-serif,system-ui,sans-serif; }\n  [data-weiv-scope="wA579BFDD41CFAA32"]:global(button), [data-weiv-scope="wA579BFDD41CFAA32"] :global(button), [data-weiv-scope="wA579BFDD41CFAA32"]:global(input), [data-weiv-scope="wA579BFDD41CFAA32"] :global(input), [data-weiv-scope="wA579BFDD41CFAA32"]:global(textarea), [data-weiv-scope="wA579BFDD41CFAA32"] :global(textarea), [data-weiv-scope="wA579BFDD41CFAA32"]:global(select), [data-weiv-scope="wA579BFDD41CFAA32"] :global(select) { font:inherit; }\n  [data-weiv-scope="wA579BFDD41CFAA32"].bootstrap, [data-weiv-scope="wA579BFDD41CFAA32"] .bootstrap {display:none}[data-weiv-scope="wA579BFDD41CFAA32"].world-shell, [data-weiv-scope="wA579BFDD41CFAA32"] .world-shell {min-height:100vh;background:var(--paper);background-image:radial-gradient(#614e3420 1px,transparent 1px);background-size:20px 20px}[data-weiv-scope="wA579BFDD41CFAA32"].mast, [data-weiv-scope="wA579BFDD41CFAA32"] .mast {position:sticky;z-index:10;top:0;height:64px;padding:0 3.5vw;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;background:#121815f5;color:#fff;border-bottom:1px solid #ffffff15;backdrop-filter:blur(10px)}[data-weiv-scope="wA579BFDD41CFAA32"].brand, [data-weiv-scope="wA579BFDD41CFAA32"] .brand {display:flex;gap:10px;align-items:center;text-transform:uppercase;letter-spacing:.13em;font-size:12px;font-weight:700}[data-weiv-scope="wA579BFDD41CFAA32"].brand i, [data-weiv-scope="wA579BFDD41CFAA32"] .brand i {display:grid;place-items:center;width:31px;height:31px;border:1px solid var(--gold);border-radius:50%;color:var(--gold);font:16px Georgia;font-style:normal}[data-weiv-scope="wA579BFDD41CFAA32"].world-name, [data-weiv-scope="wA579BFDD41CFAA32"] .world-name {font:16px Georgia;color:#eae2d1}[data-weiv-scope="wA579BFDD41CFAA32"].presence, [data-weiv-scope="wA579BFDD41CFAA32"] .presence {justify-self:end;display:flex;gap:9px;align-items:center;color:#b8c1bb;font-size:10px}[data-weiv-scope="wA579BFDD41CFAA32"].presence i, [data-weiv-scope="wA579BFDD41CFAA32"] .presence i {width:6px;height:6px;border-radius:50%;background:#80a888;box-shadow:0 0 0 4px #80a88820}[data-weiv-scope="wA579BFDD41CFAA32"].entrance, [data-weiv-scope="wA579BFDD41CFAA32"] .entrance {position:relative;min-height:calc(100vh - 64px);padding:8vh 8vw;overflow:hidden;display:grid;grid-template-columns:1.2fr .8fr;align-content:center;gap:8vw;background:var(--forest);color:white}[data-weiv-scope="wA579BFDD41CFAA32"].entrance-copy, [data-weiv-scope="wA579BFDD41CFAA32"] .entrance-copy {position:relative;z-index:2}[data-weiv-scope="wA579BFDD41CFAA32"].overline, [data-weiv-scope="wA579BFDD41CFAA32"] .overline {text-transform:uppercase;letter-spacing:.18em;font-size:9px;font-weight:800;color:var(--rust)}[data-weiv-scope="wA579BFDD41CFAA32"].entrance .overline, [data-weiv-scope="wA579BFDD41CFAA32"] .entrance .overline {color:#e0bd73}[data-weiv-scope="wA579BFDD41CFAA32"].entrance h1, [data-weiv-scope="wA579BFDD41CFAA32"] .entrance h1, [data-weiv-scope="wA579BFDD41CFAA32"].world-intro h1, [data-weiv-scope="wA579BFDD41CFAA32"] .world-intro h1, [data-weiv-scope="wA579BFDD41CFAA32"].how-view>h1, [data-weiv-scope="wA579BFDD41CFAA32"] .how-view>h1 {margin:14px 0 24px;font:normal clamp(56px,8vw,105px)/.86 Georgia,serif;letter-spacing:-.06em}[data-weiv-scope="wA579BFDD41CFAA32"].entrance-copy p, [data-weiv-scope="wA579BFDD41CFAA32"] .entrance-copy p {max-width:660px;font:24px/1.5 Georgia;color:#e2ded2}[data-weiv-scope="wA579BFDD41CFAA32"].enter-card, [data-weiv-scope="wA579BFDD41CFAA32"] .enter-card {position:relative;z-index:2;padding:30px;background:var(--cream);color:var(--ink);box-shadow:0 30px 90px #0005}[data-weiv-scope="wA579BFDD41CFAA32"].expedition-mark, [data-weiv-scope="wA579BFDD41CFAA32"] .expedition-mark {margin-bottom:10px;color:var(--rust);font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}[data-weiv-scope="wA579BFDD41CFAA32"].enter-card p, [data-weiv-scope="wA579BFDD41CFAA32"] .enter-card p {margin:0 0 25px;font:18px/1.5 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].enter-card label, [data-weiv-scope="wA579BFDD41CFAA32"] .enter-card label {display:block;margin-bottom:7px;color:#716b60;font-size:10px;text-transform:uppercase;letter-spacing:.12em}[data-weiv-scope="wA579BFDD41CFAA32"].enter-card input, [data-weiv-scope="wA579BFDD41CFAA32"] .enter-card input {width:100%;padding:14px;border:1px solid var(--line);background:white}[data-weiv-scope="wA579BFDD41CFAA32"].enter-card button, [data-weiv-scope="wA579BFDD41CFAA32"] .enter-card button, [data-weiv-scope="wA579BFDD41CFAA32"].leave-something button, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something button {width:100%;margin-top:11px;padding:13px;border:0;background:var(--rust);color:white;font-weight:700;cursor:pointer}[data-weiv-scope="wA579BFDD41CFAA32"].enter-card small, [data-weiv-scope="wA579BFDD41CFAA32"] .enter-card small {display:block;margin-top:10px;color:var(--rust)}[data-weiv-scope="wA579BFDD41CFAA32"].entrance-art, [data-weiv-scope="wA579BFDD41CFAA32"] .entrance-art {position:absolute;inset:0;opacity:.6}[data-weiv-scope="wA579BFDD41CFAA32"].orbit, [data-weiv-scope="wA579BFDD41CFAA32"] .orbit {position:absolute;border:1px solid #dabf7d22;border-radius:50%}[data-weiv-scope="wA579BFDD41CFAA32"].orbit-one, [data-weiv-scope="wA579BFDD41CFAA32"] .orbit-one {width:70vw;height:70vw;left:-20vw;top:-25vw}[data-weiv-scope="wA579BFDD41CFAA32"].orbit-two, [data-weiv-scope="wA579BFDD41CFAA32"] .orbit-two {width:50vw;height:50vw;right:-10vw;bottom:-25vw}[data-weiv-scope="wA579BFDD41CFAA32"].star, [data-weiv-scope="wA579BFDD41CFAA32"] .star {position:absolute;color:var(--gold)}[data-weiv-scope="wA579BFDD41CFAA32"].star-one, [data-weiv-scope="wA579BFDD41CFAA32"] .star-one {left:22%;top:24%;font-size:28px}[data-weiv-scope="wA579BFDD41CFAA32"].star-two, [data-weiv-scope="wA579BFDD41CFAA32"] .star-two {left:63%;top:15%;font-size:55px}[data-weiv-scope="wA579BFDD41CFAA32"].star-three, [data-weiv-scope="wA579BFDD41CFAA32"] .star-three {right:14%;bottom:20%;font-size:17px}[data-weiv-scope="wA579BFDD41CFAA32"].world, [data-weiv-scope="wA579BFDD41CFAA32"] .world {display:grid;grid-template-columns:230px minmax(0,1fr);max-width:1700px;margin:auto}[data-weiv-scope="wA579BFDD41CFAA32"].left-rail, [data-weiv-scope="wA579BFDD41CFAA32"] .left-rail {position:sticky;top:64px;height:calc(100vh - 64px);padding:28px 20px;display:flex;flex-direction:column;border-right:1px solid var(--line);background:#f4efe2}[data-weiv-scope="wA579BFDD41CFAA32"].you, [data-weiv-scope="wA579BFDD41CFAA32"] .you {display:flex;gap:10px;align-items:center;padding-bottom:24px;border-bottom:1px solid var(--line)}[data-weiv-scope="wA579BFDD41CFAA32"].you>span, [data-weiv-scope="wA579BFDD41CFAA32"] .you>span, [data-weiv-scope="wA579BFDD41CFAA32"].visitor i, [data-weiv-scope="wA579BFDD41CFAA32"] .visitor i {display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--forest);color:white;font-style:normal;font-size:11px}[data-weiv-scope="wA579BFDD41CFAA32"].you b, [data-weiv-scope="wA579BFDD41CFAA32"] .you b, [data-weiv-scope="wA579BFDD41CFAA32"].you small, [data-weiv-scope="wA579BFDD41CFAA32"] .you small {display:block}[data-weiv-scope="wA579BFDD41CFAA32"].you small, [data-weiv-scope="wA579BFDD41CFAA32"] .you small {color:#827b6e;font-size:9px}[data-weiv-scope="wA579BFDD41CFAA32"].left-rail section, [data-weiv-scope="wA579BFDD41CFAA32"] .left-rail section {margin-top:25px}[data-weiv-scope="wA579BFDD41CFAA32"].rail-title, [data-weiv-scope="wA579BFDD41CFAA32"] .rail-title {text-transform:uppercase;letter-spacing:.13em;font-size:9px;color:#81796a;margin-bottom:11px}[data-weiv-scope="wA579BFDD41CFAA32"].visitors, [data-weiv-scope="wA579BFDD41CFAA32"] .visitors {display:grid;gap:8px}[data-weiv-scope="wA579BFDD41CFAA32"].visitor, [data-weiv-scope="wA579BFDD41CFAA32"] .visitor {display:flex;gap:8px;align-items:center;font-size:11px}[data-weiv-scope="wA579BFDD41CFAA32"].visitor i, [data-weiv-scope="wA579BFDD41CFAA32"] .visitor i {width:24px;height:24px;background:#5c7467;font-size:9px}[data-weiv-scope="wA579BFDD41CFAA32"].chips, [data-weiv-scope="wA579BFDD41CFAA32"] .chips {display:flex;flex-wrap:wrap;gap:5px}[data-weiv-scope="wA579BFDD41CFAA32"].chips span, [data-weiv-scope="wA579BFDD41CFAA32"] .chips span {padding:4px 7px;border:1px solid #cfc4ad;border-radius:20px;font-size:9px;color:#675f54}[data-weiv-scope="wA579BFDD41CFAA32"].how-link, [data-weiv-scope="wA579BFDD41CFAA32"] .how-link {margin-top:auto;padding:11px 3px;border:0;border-top:1px solid var(--line);background:transparent;text-align:left;color:#44594d;font-size:11px;cursor:pointer}[data-weiv-scope="wA579BFDD41CFAA32"].how-link span, [data-weiv-scope="wA579BFDD41CFAA32"] .how-link span {float:right}[data-weiv-scope="wA579BFDD41CFAA32"].main-stage, [data-weiv-scope="wA579BFDD41CFAA32"] .main-stage {padding:38px clamp(25px,4vw,65px) 80px;min-width:0}[data-weiv-scope="wA579BFDD41CFAA32"].error, [data-weiv-scope="wA579BFDD41CFAA32"] .error {padding:12px;margin-bottom:16px;background:#f5dcd5;color:#833a2e}[data-weiv-scope="wA579BFDD41CFAA32"].world-intro, [data-weiv-scope="wA579BFDD41CFAA32"] .world-intro {display:grid;grid-template-columns:1.2fr .8fr;gap:50px;align-items:end}[data-weiv-scope="wA579BFDD41CFAA32"].world-intro h1, [data-weiv-scope="wA579BFDD41CFAA32"] .world-intro h1 {font-size:clamp(46px,6vw,82px);margin:10px 0 15px}[data-weiv-scope="wA579BFDD41CFAA32"].world-intro>div>p, [data-weiv-scope="wA579BFDD41CFAA32"] .world-intro>div>p {max-width:680px;margin:0;color:#6f6a60;font:17px/1.6 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].return-note, [data-weiv-scope="wA579BFDD41CFAA32"] .return-note {padding:20px;border-left:2px solid var(--gold);background:#f8f3e7}[data-weiv-scope="wA579BFDD41CFAA32"].return-note span, [data-weiv-scope="wA579BFDD41CFAA32"] .return-note span {color:var(--rust);font-size:9px;text-transform:uppercase;letter-spacing:.12em}[data-weiv-scope="wA579BFDD41CFAA32"].return-note p, [data-weiv-scope="wA579BFDD41CFAA32"] .return-note p {margin:9px 0;color:#3d463f;font:15px/1.5 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].return-note b, [data-weiv-scope="wA579BFDD41CFAA32"] .return-note b {font-size:11px;color:#59685e}[data-weiv-scope="wA579BFDD41CFAA32"].guide-card, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-card {padding:28px;background:var(--forest);color:white;border:1px solid #ffffff18;box-shadow:0 22px 70px #24312924}[data-weiv-scope="wA579BFDD41CFAA32"].guide-progress, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-progress {display:flex;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid #ffffff1a;color:#d5caa9;font-size:9px;text-transform:uppercase;letter-spacing:.16em}[data-weiv-scope="wA579BFDD41CFAA32"].guide-head, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-head {display:grid;grid-template-columns:1.4fr .6fr;gap:35px;align-items:end;padding:24px 0}[data-weiv-scope="wA579BFDD41CFAA32"].guide-head .overline, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-head .overline {color:var(--gold)}[data-weiv-scope="wA579BFDD41CFAA32"].guide-head h1, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-head h1 {max-width:780px;margin:8px 0 0;font:normal clamp(34px,4.3vw,62px)/.96 Georgia;letter-spacing:-.04em}[data-weiv-scope="wA579BFDD41CFAA32"].guide-head>p, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-head>p {margin:0;color:#b9c2bc;font:15px/1.5 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].guide-action, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-action {padding:22px;background:var(--cream);color:var(--ink)}[data-weiv-scope="wA579BFDD41CFAA32"].guide-action>div>span, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-action>div>span {color:var(--rust);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.14em}[data-weiv-scope="wA579BFDD41CFAA32"].guide-action h2, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-action h2 {margin:6px 0;font:27px/1.15 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].guide-action p, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-action p {margin:5px 0;color:#6e695f;font:14px/1.5 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].lens-row, [data-weiv-scope="wA579BFDD41CFAA32"] .lens-row {display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:18px}[data-weiv-scope="wA579BFDD41CFAA32"].lens-row button, [data-weiv-scope="wA579BFDD41CFAA32"] .lens-row button {padding:15px;border:1px solid var(--line);background:white;text-align:left;cursor:pointer}[data-weiv-scope="wA579BFDD41CFAA32"].lens-row b, [data-weiv-scope="wA579BFDD41CFAA32"] .lens-row b, [data-weiv-scope="wA579BFDD41CFAA32"].lens-row small, [data-weiv-scope="wA579BFDD41CFAA32"] .lens-row small {display:block}[data-weiv-scope="wA579BFDD41CFAA32"].lens-row b, [data-weiv-scope="wA579BFDD41CFAA32"] .lens-row b {margin-bottom:5px;color:var(--rust);font:19px Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].lens-row small, [data-weiv-scope="wA579BFDD41CFAA32"] .lens-row small {color:#746e62;font-size:10px;line-height:1.4}[data-weiv-scope="wA579BFDD41CFAA32"].guide-action.compact, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-action.compact {display:flex;justify-content:space-between;gap:25px;align-items:center}[data-weiv-scope="wA579BFDD41CFAA32"].guide-primary, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-primary {padding:12px 18px;border:0;background:var(--rust);color:white;font-weight:700;cursor:pointer}[data-weiv-scope="wA579BFDD41CFAA32"].guide-primary:disabled, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-primary:disabled {opacity:.45}[data-weiv-scope="wA579BFDD41CFAA32"].target-row, [data-weiv-scope="wA579BFDD41CFAA32"] .target-row {display:grid;min-width:340px;gap:6px}[data-weiv-scope="wA579BFDD41CFAA32"].target-row button, [data-weiv-scope="wA579BFDD41CFAA32"] .target-row button {padding:9px 12px;border:1px solid var(--line);background:white;text-align:left;color:var(--ink);cursor:pointer}[data-weiv-scope="wA579BFDD41CFAA32"].target-row button:hover, [data-weiv-scope="wA579BFDD41CFAA32"] .target-row button:hover {border-color:var(--rust);color:var(--rust)}[data-weiv-scope="wA579BFDD41CFAA32"].connection-step, [data-weiv-scope="wA579BFDD41CFAA32"] .connection-step {display:grid;grid-template-columns:1.2fr auto minmax(230px,.8fr) auto;gap:12px;align-items:center}[data-weiv-scope="wA579BFDD41CFAA32"].stance-row, [data-weiv-scope="wA579BFDD41CFAA32"] .stance-row {display:flex;gap:5px}[data-weiv-scope="wA579BFDD41CFAA32"].stance-row button, [data-weiv-scope="wA579BFDD41CFAA32"] .stance-row button {padding:9px 12px;border:1px solid var(--line);background:white;cursor:pointer}[data-weiv-scope="wA579BFDD41CFAA32"].stance-row button.active, [data-weiv-scope="wA579BFDD41CFAA32"] .stance-row button.active {background:var(--forest);color:white}[data-weiv-scope="wA579BFDD41CFAA32"].connection-step input, [data-weiv-scope="wA579BFDD41CFAA32"] .connection-step input {min-width:0;padding:11px;border:1px solid var(--line)}[data-weiv-scope="wA579BFDD41CFAA32"].echo-step, [data-weiv-scope="wA579BFDD41CFAA32"] .echo-step {display:flex;justify-content:space-between;gap:30px;align-items:center;background:#f3dfb5}[data-weiv-scope="wA579BFDD41CFAA32"].echo-step small, [data-weiv-scope="wA579BFDD41CFAA32"] .echo-step small {display:block;margin-top:10px;color:#7a6950}[data-weiv-scope="wA579BFDD41CFAA32"].constellation, [data-weiv-scope="wA579BFDD41CFAA32"] .constellation {position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin:30px 0}[data-weiv-scope="wA579BFDD41CFAA32"].object-node, [data-weiv-scope="wA579BFDD41CFAA32"] .object-node {position:relative;z-index:2;padding:0;border:1px solid #cfc5b1;background:#f8f4e9;text-align:left;cursor:pointer;transition:.25s;overflow:hidden}[data-weiv-scope="wA579BFDD41CFAA32"].object-node:hover, [data-weiv-scope="wA579BFDD41CFAA32"] .object-node:hover {transform:translateY(-4px);box-shadow:0 18px 45px #30271a22}[data-weiv-scope="wA579BFDD41CFAA32"].object-node.selected, [data-weiv-scope="wA579BFDD41CFAA32"] .object-node.selected {outline:3px solid var(--rust);outline-offset:2px}[data-weiv-scope="wA579BFDD41CFAA32"].object-node.visited:after, [data-weiv-scope="wA579BFDD41CFAA32"] .object-node.visited:after {content:\'visited\';position:absolute;top:9px;right:9px;padding:3px 6px;background:#18231fd9;color:white;text-transform:uppercase;letter-spacing:.1em;font-size:7px}[data-weiv-scope="wA579BFDD41CFAA32"].object-node img, [data-weiv-scope="wA579BFDD41CFAA32"] .object-node img {width:100%;height:155px;object-fit:cover;filter:saturate(.82)}[data-weiv-scope="wA579BFDD41CFAA32"].node-number, [data-weiv-scope="wA579BFDD41CFAA32"] .node-number {display:block;margin:10px 12px 2px;color:var(--rust);font:10px Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].node-copy, [data-weiv-scope="wA579BFDD41CFAA32"] .node-copy {display:block;padding:0 12px 14px}[data-weiv-scope="wA579BFDD41CFAA32"].node-copy b, [data-weiv-scope="wA579BFDD41CFAA32"] .node-copy b, [data-weiv-scope="wA579BFDD41CFAA32"].node-copy small, [data-weiv-scope="wA579BFDD41CFAA32"] .node-copy small {display:block}[data-weiv-scope="wA579BFDD41CFAA32"].node-copy b, [data-weiv-scope="wA579BFDD41CFAA32"] .node-copy b {min-height:39px;font:15px/1.2 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].node-copy small, [data-weiv-scope="wA579BFDD41CFAA32"] .node-copy small {margin-top:7px;color:#777064;font-size:9px}[data-weiv-scope="wA579BFDD41CFAA32"].thread-line, [data-weiv-scope="wA579BFDD41CFAA32"] .thread-line {position:absolute;z-index:1;top:75px;height:1px;background:#a7823d66;transform-origin:left}[data-weiv-scope="wA579BFDD41CFAA32"].thread-a, [data-weiv-scope="wA579BFDD41CFAA32"] .thread-a {left:20%;width:20%;transform:rotate(4deg)}[data-weiv-scope="wA579BFDD41CFAA32"].thread-b, [data-weiv-scope="wA579BFDD41CFAA32"] .thread-b {left:45%;width:21%;transform:rotate(-3deg)}[data-weiv-scope="wA579BFDD41CFAA32"].thread-c, [data-weiv-scope="wA579BFDD41CFAA32"] .thread-c {left:70%;width:18%;transform:rotate(5deg)}[data-weiv-scope="wA579BFDD41CFAA32"].encounter, [data-weiv-scope="wA579BFDD41CFAA32"] .encounter {display:grid;grid-template-columns:minmax(0,1.35fr) minmax(285px,.65fr);gap:18px}[data-weiv-scope="wA579BFDD41CFAA32"].object-view, [data-weiv-scope="wA579BFDD41CFAA32"] .object-view {display:grid;grid-template-columns:minmax(220px,.75fr) minmax(280px,1fr);background:var(--forest);color:white;min-height:390px}[data-weiv-scope="wA579BFDD41CFAA32"].object-image, [data-weiv-scope="wA579BFDD41CFAA32"] .object-image {position:relative}[data-weiv-scope="wA579BFDD41CFAA32"].object-image img, [data-weiv-scope="wA579BFDD41CFAA32"] .object-image img {width:100%;height:100%;min-height:390px;object-fit:cover}[data-weiv-scope="wA579BFDD41CFAA32"].object-image span, [data-weiv-scope="wA579BFDD41CFAA32"] .object-image span {position:absolute;left:13px;bottom:13px;padding:5px 8px;background:#121815d9;font-size:9px;text-transform:uppercase;letter-spacing:.1em}[data-weiv-scope="wA579BFDD41CFAA32"].object-story, [data-weiv-scope="wA579BFDD41CFAA32"] .object-story {display:flex;flex-direction:column;justify-content:center;padding:35px}[data-weiv-scope="wA579BFDD41CFAA32"].object-story .overline, [data-weiv-scope="wA579BFDD41CFAA32"] .object-story .overline {color:#e0bd73}[data-weiv-scope="wA579BFDD41CFAA32"].object-story h2, [data-weiv-scope="wA579BFDD41CFAA32"] .object-story h2 {margin:10px 0;font:normal 35px/1.05 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].object-story .maker, [data-weiv-scope="wA579BFDD41CFAA32"] .object-story .maker {color:#d8cba9}[data-weiv-scope="wA579BFDD41CFAA32"].object-story>p, [data-weiv-scope="wA579BFDD41CFAA32"] .object-story>p {font:14px/1.55 Georgia;color:#bdc5bf}[data-weiv-scope="wA579BFDD41CFAA32"].source-line, [data-weiv-scope="wA579BFDD41CFAA32"] .source-line {display:flex;justify-content:space-between;gap:12px;margin-top:20px;padding-top:14px;border-top:1px solid #ffffff20;font-size:9px;color:#aebbb3}[data-weiv-scope="wA579BFDD41CFAA32"].source-line a, [data-weiv-scope="wA579BFDD41CFAA32"] .source-line a {color:#e0bd73}[data-weiv-scope="wA579BFDD41CFAA32"].leave-something, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something {padding:23px;border:1px solid var(--line);background:var(--cream)}[data-weiv-scope="wA579BFDD41CFAA32"].leave-something h3, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something h3 {margin:7px 0 13px;font:24px/1.1 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].leave-something textarea, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something textarea, [data-weiv-scope="wA579BFDD41CFAA32"].leave-something input, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something input, [data-weiv-scope="wA579BFDD41CFAA32"].leave-something select, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something select {width:100%;padding:11px;border:1px solid var(--line);background:white;color:var(--ink)}[data-weiv-scope="wA579BFDD41CFAA32"].leave-something textarea, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something textarea {min-height:100px;resize:vertical}[data-weiv-scope="wA579BFDD41CFAA32"].leave-something button.secondary, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something button.secondary {background:#435b4e}[data-weiv-scope="wA579BFDD41CFAA32"].leave-something button:disabled, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something button:disabled, [data-weiv-scope="wA579BFDD41CFAA32"].enter-card button:disabled, [data-weiv-scope="wA579BFDD41CFAA32"] .enter-card button:disabled {opacity:.45;cursor:not-allowed}[data-weiv-scope="wA579BFDD41CFAA32"].or, [data-weiv-scope="wA579BFDD41CFAA32"] .or {display:flex;gap:8px;align-items:center;margin:18px 0;color:#9a9284;font-size:9px;text-transform:uppercase;letter-spacing:.1em}[data-weiv-scope="wA579BFDD41CFAA32"].or span, [data-weiv-scope="wA579BFDD41CFAA32"] .or span {flex:1;height:1px;background:var(--line)}[data-weiv-scope="wA579BFDD41CFAA32"].leave-something select, [data-weiv-scope="wA579BFDD41CFAA32"] .leave-something select {margin-bottom:8px}[data-weiv-scope="wA579BFDD41CFAA32"].bloom, [data-weiv-scope="wA579BFDD41CFAA32"] .bloom {margin-top:18px;padding:20px 24px;background:#733e36;color:white}[data-weiv-scope="wA579BFDD41CFAA32"].bloom span, [data-weiv-scope="wA579BFDD41CFAA32"] .bloom span {text-transform:uppercase;letter-spacing:.14em;font-size:9px;color:#e6c67f}[data-weiv-scope="wA579BFDD41CFAA32"].bloom p, [data-weiv-scope="wA579BFDD41CFAA32"] .bloom p {margin:8px 0 0;font:17px/1.45 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].shared-memory, [data-weiv-scope="wA579BFDD41CFAA32"] .shared-memory {margin-top:42px}[data-weiv-scope="wA579BFDD41CFAA32"].section-head, [data-weiv-scope="wA579BFDD41CFAA32"] .section-head {display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:16px}[data-weiv-scope="wA579BFDD41CFAA32"].section-head h2, [data-weiv-scope="wA579BFDD41CFAA32"] .section-head h2, [data-weiv-scope="wA579BFDD41CFAA32"].memory-ledger h2, [data-weiv-scope="wA579BFDD41CFAA32"] .memory-ledger h2 {margin:5px 0 0;font:30px Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].section-head small, [data-weiv-scope="wA579BFDD41CFAA32"] .section-head small {color:#7b7468}[data-weiv-scope="wA579BFDD41CFAA32"].quiet, [data-weiv-scope="wA579BFDD41CFAA32"] .quiet {padding:35px;border:1px dashed var(--line);color:#817a6d;text-align:center;font:15px Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].thought-grid, [data-weiv-scope="wA579BFDD41CFAA32"] .thought-grid {display:grid;grid-template-columns:repeat(3,1fr);gap:12px}[data-weiv-scope="wA579BFDD41CFAA32"].thought-grid blockquote, [data-weiv-scope="wA579BFDD41CFAA32"] .thought-grid blockquote {margin:0;padding:20px;background:var(--cream);border:1px solid var(--line)}[data-weiv-scope="wA579BFDD41CFAA32"].thought-grid p, [data-weiv-scope="wA579BFDD41CFAA32"] .thought-grid p {margin:0;font:17px/1.4 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].thought-grid footer, [data-weiv-scope="wA579BFDD41CFAA32"] .thought-grid footer {margin-top:16px;color:#817a6d;font-size:9px}[data-weiv-scope="wA579BFDD41CFAA32"].trail-list, [data-weiv-scope="wA579BFDD41CFAA32"] .trail-list {display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}[data-weiv-scope="wA579BFDD41CFAA32"].trail-list article, [data-weiv-scope="wA579BFDD41CFAA32"] .trail-list article {display:flex;gap:9px;align-items:center;padding:9px 12px;border:1px solid var(--line);background:#f7f1e4}[data-weiv-scope="wA579BFDD41CFAA32"].trail-list i, [data-weiv-scope="wA579BFDD41CFAA32"] .trail-list i {color:var(--rust);font-style:normal}[data-weiv-scope="wA579BFDD41CFAA32"].trail-list b, [data-weiv-scope="wA579BFDD41CFAA32"] .trail-list b, [data-weiv-scope="wA579BFDD41CFAA32"].trail-list small, [data-weiv-scope="wA579BFDD41CFAA32"] .trail-list small {display:block}[data-weiv-scope="wA579BFDD41CFAA32"].trail-list b, [data-weiv-scope="wA579BFDD41CFAA32"] .trail-list b {font-size:10px}[data-weiv-scope="wA579BFDD41CFAA32"].trail-list small, [data-weiv-scope="wA579BFDD41CFAA32"] .trail-list small {color:#827a6d;font-size:8px}[data-weiv-scope="wA579BFDD41CFAA32"].how-view>.overline, [data-weiv-scope="wA579BFDD41CFAA32"] .how-view>.overline {margin-top:5vh}[data-weiv-scope="wA579BFDD41CFAA32"].how-view>h1, [data-weiv-scope="wA579BFDD41CFAA32"] .how-view>h1 {font-size:clamp(52px,7vw,90px);margin:12px 0 22px}[data-weiv-scope="wA579BFDD41CFAA32"].how-view .lede, [data-weiv-scope="wA579BFDD41CFAA32"] .how-view .lede {max-width:720px;font:19px/1.6 Georgia;color:#666158}[data-weiv-scope="wA579BFDD41CFAA32"].how-grid, [data-weiv-scope="wA579BFDD41CFAA32"] .how-grid {display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:35px}[data-weiv-scope="wA579BFDD41CFAA32"].how-grid article, [data-weiv-scope="wA579BFDD41CFAA32"] .how-grid article {padding:24px;background:var(--cream);border:1px solid var(--line)}[data-weiv-scope="wA579BFDD41CFAA32"].how-grid span, [data-weiv-scope="wA579BFDD41CFAA32"] .how-grid span {color:var(--rust);font:20px Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].how-grid h3, [data-weiv-scope="wA579BFDD41CFAA32"] .how-grid h3 {font:23px/1.15 Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].how-grid p, [data-weiv-scope="wA579BFDD41CFAA32"] .how-grid p {color:#746e63;font-size:12px;line-height:1.55}[data-weiv-scope="wA579BFDD41CFAA32"].memory-ledger, [data-weiv-scope="wA579BFDD41CFAA32"] .memory-ledger {margin-top:30px}[data-weiv-scope="wA579BFDD41CFAA32"].ledger-row, [data-weiv-scope="wA579BFDD41CFAA32"] .ledger-row {display:grid;grid-template-columns:30px 1fr;gap:11px;padding:14px 0;border-top:1px solid var(--line)}[data-weiv-scope="wA579BFDD41CFAA32"].ledger-row i, [data-weiv-scope="wA579BFDD41CFAA32"] .ledger-row i {color:var(--rust);font-style:normal}[data-weiv-scope="wA579BFDD41CFAA32"].ledger-row p, [data-weiv-scope="wA579BFDD41CFAA32"] .ledger-row p {margin:0;font:15px Georgia}[data-weiv-scope="wA579BFDD41CFAA32"].ledger-row small, [data-weiv-scope="wA579BFDD41CFAA32"] .ledger-row small {color:#817a6e;font-size:9px}\n  @media(max-width:1100px){[data-weiv-scope="wA579BFDD41CFAA32"].constellation, [data-weiv-scope="wA579BFDD41CFAA32"] .constellation {grid-template-columns:repeat(2,1fr)}[data-weiv-scope="wA579BFDD41CFAA32"].thread-line, [data-weiv-scope="wA579BFDD41CFAA32"] .thread-line {display:none}[data-weiv-scope="wA579BFDD41CFAA32"].encounter, [data-weiv-scope="wA579BFDD41CFAA32"] .encounter, [data-weiv-scope="wA579BFDD41CFAA32"].world-intro, [data-weiv-scope="wA579BFDD41CFAA32"] .world-intro {grid-template-columns:1fr}[data-weiv-scope="wA579BFDD41CFAA32"].return-note, [data-weiv-scope="wA579BFDD41CFAA32"] .return-note {max-width:700px}[data-weiv-scope="wA579BFDD41CFAA32"].thought-grid, [data-weiv-scope="wA579BFDD41CFAA32"] .thought-grid {grid-template-columns:repeat(2,1fr)}[data-weiv-scope="wA579BFDD41CFAA32"].connection-step, [data-weiv-scope="wA579BFDD41CFAA32"] .connection-step {grid-template-columns:1fr 1fr}[data-weiv-scope="wA579BFDD41CFAA32"].connection-step>div:first-child, [data-weiv-scope="wA579BFDD41CFAA32"] .connection-step>div:first-child {grid-column:1/-1}}\n  @media(max-width:760px){[data-weiv-scope="wA579BFDD41CFAA32"].mast, [data-weiv-scope="wA579BFDD41CFAA32"] .mast {grid-template-columns:1fr auto}[data-weiv-scope="wA579BFDD41CFAA32"].world-name, [data-weiv-scope="wA579BFDD41CFAA32"] .world-name {display:none}[data-weiv-scope="wA579BFDD41CFAA32"].world, [data-weiv-scope="wA579BFDD41CFAA32"] .world {grid-template-columns:1fr}[data-weiv-scope="wA579BFDD41CFAA32"].left-rail, [data-weiv-scope="wA579BFDD41CFAA32"] .left-rail {position:static;height:auto;display:grid;grid-template-columns:1fr 1fr;padding:18px}[data-weiv-scope="wA579BFDD41CFAA32"].left-rail section, [data-weiv-scope="wA579BFDD41CFAA32"] .left-rail section {display:none}[data-weiv-scope="wA579BFDD41CFAA32"].how-link, [data-weiv-scope="wA579BFDD41CFAA32"] .how-link {margin:0;border:0;text-align:right}[data-weiv-scope="wA579BFDD41CFAA32"].main-stage, [data-weiv-scope="wA579BFDD41CFAA32"] .main-stage {padding:28px 16px 60px}[data-weiv-scope="wA579BFDD41CFAA32"].entrance, [data-weiv-scope="wA579BFDD41CFAA32"] .entrance {grid-template-columns:1fr;padding:45px 22px}[data-weiv-scope="wA579BFDD41CFAA32"].entrance h1, [data-weiv-scope="wA579BFDD41CFAA32"] .entrance h1 {font-size:57px}[data-weiv-scope="wA579BFDD41CFAA32"].enter-card, [data-weiv-scope="wA579BFDD41CFAA32"] .enter-card {max-width:520px}[data-weiv-scope="wA579BFDD41CFAA32"].guide-card, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-card {padding:17px}[data-weiv-scope="wA579BFDD41CFAA32"].guide-head, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-head, [data-weiv-scope="wA579BFDD41CFAA32"].lens-row, [data-weiv-scope="wA579BFDD41CFAA32"] .lens-row {grid-template-columns:1fr}[data-weiv-scope="wA579BFDD41CFAA32"].guide-action.compact, [data-weiv-scope="wA579BFDD41CFAA32"] .guide-action.compact, [data-weiv-scope="wA579BFDD41CFAA32"].echo-step, [data-weiv-scope="wA579BFDD41CFAA32"] .echo-step {display:grid}[data-weiv-scope="wA579BFDD41CFAA32"].target-row, [data-weiv-scope="wA579BFDD41CFAA32"] .target-row {min-width:0}[data-weiv-scope="wA579BFDD41CFAA32"].connection-step, [data-weiv-scope="wA579BFDD41CFAA32"] .connection-step {grid-template-columns:1fr}[data-weiv-scope="wA579BFDD41CFAA32"].connection-step>div:first-child, [data-weiv-scope="wA579BFDD41CFAA32"] .connection-step>div:first-child {grid-column:auto}[data-weiv-scope="wA579BFDD41CFAA32"].constellation, [data-weiv-scope="wA579BFDD41CFAA32"] .constellation {grid-template-columns:1fr 1fr}[data-weiv-scope="wA579BFDD41CFAA32"].object-node img, [data-weiv-scope="wA579BFDD41CFAA32"] .object-node img {height:125px}[data-weiv-scope="wA579BFDD41CFAA32"].object-view, [data-weiv-scope="wA579BFDD41CFAA32"] .object-view {grid-template-columns:1fr}[data-weiv-scope="wA579BFDD41CFAA32"].object-image img, [data-weiv-scope="wA579BFDD41CFAA32"] .object-image img {height:330px;min-height:0}[data-weiv-scope="wA579BFDD41CFAA32"].thought-grid, [data-weiv-scope="wA579BFDD41CFAA32"] .thought-grid, [data-weiv-scope="wA579BFDD41CFAA32"].how-grid, [data-weiv-scope="wA579BFDD41CFAA32"] .how-grid {grid-template-columns:1fr}[data-weiv-scope="wA579BFDD41CFAA32"].section-head, [data-weiv-scope="wA579BFDD41CFAA32"] .section-head {align-items:start;flex-direction:column}}\n  @media(max-width:480px){[data-weiv-scope="wA579BFDD41CFAA32"].constellation, [data-weiv-scope="wA579BFDD41CFAA32"] .constellation {grid-template-columns:1fr}[data-weiv-scope="wA579BFDD41CFAA32"].object-node, [data-weiv-scope="wA579BFDD41CFAA32"] .object-node {display:grid;grid-template-columns:110px 1fr}[data-weiv-scope="wA579BFDD41CFAA32"].object-node img, [data-weiv-scope="wA579BFDD41CFAA32"] .object-node img {width:110px;height:120px;grid-row:1/3}[data-weiv-scope="wA579BFDD41CFAA32"].node-copy b, [data-weiv-scope="wA579BFDD41CFAA32"] .node-copy b {min-height:0}[data-weiv-scope="wA579BFDD41CFAA32"].object-story h2, [data-weiv-scope="wA579BFDD41CFAA32"] .object-story h2 {font-size:29px}[data-weiv-scope="wA579BFDD41CFAA32"].mast, [data-weiv-scope="wA579BFDD41CFAA32"] .mast {padding:0 15px}[data-weiv-scope="wA579BFDD41CFAA32"].presence, [data-weiv-scope="wA579BFDD41CFAA32"] .presence {font-size:0}[data-weiv-scope="wA579BFDD41CFAA32"].presence i, [data-weiv-scope="wA579BFDD41CFAA32"] .presence i {display:block}}\n';

export const trackedStateGraph = { roots: [], paths: [], regions: [] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_317 = document.createElement('div');
  refs[317] = __ref_317;
  __ref_317.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_317.setAttribute('class', 'world-shell');
  const __ref_1 = document.createElement('span');
  refs[1] = __ref_1;
  __ref_1.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_1.setAttribute('class', 'bootstrap');
  const __ref_0 = document.createTextNode('');
  refs[0] = __ref_0;
  __ref_1.append(__ref_0);
  __ref_317.append(__ref_1);
  const __ref_9 = document.createElement('header');
  refs[9] = __ref_9;
  __ref_9.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_9.setAttribute('class', 'mast');
  const __ref_4 = document.createElement('div');
  refs[4] = __ref_4;
  __ref_4.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_4.setAttribute('class', 'brand');
  const __ref_2 = document.createElement('i');
  refs[2] = __ref_2;
  __ref_2.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_2.append(document.createTextNode('Q'));
  __ref_4.append(__ref_2);
  const __ref_3 = document.createElement('span');
  refs[3] = __ref_3;
  __ref_3.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_3.append(document.createTextNode('Quest'));
  __ref_4.append(__ref_3);
  __ref_9.append(__ref_4);
  const __ref_5 = document.createElement('div');
  refs[5] = __ref_5;
  __ref_5.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_5.setAttribute('class', 'world-name');
  __ref_5.append(document.createTextNode('The Museum of Nearby Things'));
  __ref_9.append(__ref_5);
  const __ref_8 = document.createElement('div');
  refs[8] = __ref_8;
  __ref_8.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_8.setAttribute('class', 'presence');
  const __ref_6 = document.createElement('i');
  refs[6] = __ref_6;
  __ref_6.setAttribute('data-weiv-scope', 'wA579BFDD41CFAA32');
  __ref_8.append(__ref_6);
  const __ref_7 = document.createTextNode('');
  refs[7] = __ref_7;
  __ref_8.append(__ref_7);
  __ref_9.append(__ref_8);
  __ref_317.append(__ref_9);
  const __ref_10 = document.createComment('if:start');
  const __ref_11 = document.createComment('if:end');
  refs[10] = __ref_10;
  refs[11] = __ref_11;
  refs[12] = undefined;
  __ref_317.append(__ref_10);
  __ref_317.append(__ref_11);
  const __ref_37 = document.createComment('if:start');
  const __ref_38 = document.createComment('if:end');
  refs[37] = __ref_37;
  refs[38] = __ref_38;
  refs[39] = undefined;
  __ref_317.append(__ref_37);
  __ref_317.append(__ref_38);
  fragment.append(__ref_317);
  return fragment;
}

function updateRegion_text_0(instance, scope, refs) {
  const __next_text_0 = String(scope.boot() ?? '');
  if (refs[0].data !== __next_text_0) {
    refs[0].data = __next_text_0;
  }
}
function updateRegion_text_7(instance, scope, refs) {
  const __next_text_7 = String(
    (scope.busy ? 'The world is listening…' : scope.presenceLabel()) ?? '',
  );
  if (refs[7].data !== __next_text_7) {
    refs[7].data = __next_text_7;
  }
}
function updateRegion_conditional_10(instance, scope, refs) {
  updateConditional_10(instance, scope);
}
function updateRegion_attribute_26_value(instance, scope, refs) {
  const __value_26_value = scope.draftName;
  const __next_26_value = __value_26_value ?? '';
  const __next_string_26_value = String(__next_26_value);
  if (refs[26].value !== __next_string_26_value) {
    refs[26].value = __next_string_26_value;
  }
  refs[26].setAttribute('value', __next_string_26_value);
}
function updateRegion_attribute_29_disabled(instance, scope, refs) {
  const __value_29_disabled = scope.busy;
  const __next_29_disabled = Boolean(__value_29_disabled);
  if (refs[29].disabled !== __next_29_disabled) {
    refs[29].disabled = __next_29_disabled;
  }
  const __has_attr_29_disabled = refs[29].hasAttribute('disabled');
  if (__next_29_disabled) {
    if (!__has_attr_29_disabled) {
      refs[29].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_29_disabled) {
      refs[29].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_28(instance, scope, refs) {
  const __next_text_28 = String((scope.busy ? 'Opening…' : 'Begin the first expedition') ?? '');
  if (refs[28].data !== __next_text_28) {
    refs[28].data = __next_text_28;
  }
}
function updateRegion_conditional_30(instance, scope, refs) {
  updateConditional_30(instance, scope);
}
function updateRegion_text_33(instance, scope, refs) {
  const __next_text_33 = String(scope.errorMessage ?? '');
  if (refs[33].data !== __next_text_33) {
    refs[33].data = __next_text_33;
  }
}
function updateRegion_conditional_37(instance, scope, refs) {
  updateConditional_37(instance, scope);
}
function updateRegion_text_40(instance, scope, refs) {
  const __next_text_40 = String(scope.initial(scope.data.visitor.name) ?? '');
  if (refs[40].data !== __next_text_40) {
    refs[40].data = __next_text_40;
  }
}
function updateRegion_text_42(instance, scope, refs) {
  const __next_text_42 = String(scope.data.visitor.name ?? '');
  if (refs[42].data !== __next_text_42) {
    refs[42].data = __next_text_42;
  }
}
function updateRegion_loop_48(instance, scope, refs) {
  updateForLoop_48(instance, scope);
}
function updateRegion_text_51(instance, scope, refs) {
  const __next_text_51 = String(scope.initial(scope.visitor.name) ?? '');
  if (refs[51].data !== __next_text_51) {
    refs[51].data = __next_text_51;
  }
}
function updateRegion_text_53(instance, scope, refs) {
  const __next_text_53 = String(scope.visitor.name ?? '');
  if (refs[53].data !== __next_text_53) {
    refs[53].data = __next_text_53;
  }
}
function updateRegion_loop_59(instance, scope, refs) {
  updateForLoop_59(instance, scope);
}
function updateRegion_text_62(instance, scope, refs) {
  const __next_text_62 = String(scope.motif ?? '');
  if (refs[62].data !== __next_text_62) {
    refs[62].data = __next_text_62;
  }
}
function updateRegion_text_66(instance, scope, refs) {
  const __next_text_66 = String(
    (scope.showHow ? 'Return to the world' : 'How this world lives') ?? '',
  );
  if (refs[66].data !== __next_text_66) {
    refs[66].data = __next_text_66;
  }
}
function updateRegion_conditional_70(instance, scope, refs) {
  updateConditional_70(instance, scope);
}
function updateRegion_text_73(instance, scope, refs) {
  const __next_text_73 = String(scope.errorMessage ?? '');
  if (refs[73].data !== __next_text_73) {
    refs[73].data = __next_text_73;
  }
}
function updateRegion_conditional_75(instance, scope, refs) {
  updateConditional_75(instance, scope);
}
function updateRegion_conditional_96(instance, scope, refs) {
  updateConditional_96(instance, scope);
}
function updateRegion_loop_100(instance, scope, refs) {
  updateForLoop_100(instance, scope);
}
function updateRegion_text_104(instance, scope, refs) {
  const __next_text_104 = String(scope.reaction.body ?? '');
  if (refs[104].data !== __next_text_104) {
    refs[104].data = __next_text_104;
  }
}
function updateRegion_text_106(instance, scope, refs) {
  const __next_text_106 = String(scope.reaction.visitor_name ?? '');
  if (refs[106].data !== __next_text_106) {
    refs[106].data = __next_text_106;
  }
}
function updateRegion_text_107(instance, scope, refs) {
  const __next_text_107 = String(scope.shortId(scope.reaction.work_id) ?? '');
  if (refs[107].data !== __next_text_107) {
    refs[107].data = __next_text_107;
  }
}
function updateRegion_conditional_113(instance, scope, refs) {
  updateConditional_113(instance, scope);
}
function updateRegion_conditional_116(instance, scope, refs) {
  updateConditional_116(instance, scope);
}
function updateRegion_text_120(instance, scope, refs) {
  const __next_text_120 = String(scope.guideProgress() ?? '');
  if (refs[120].data !== __next_text_120) {
    refs[120].data = __next_text_120;
  }
}
function updateRegion_conditional_128(instance, scope, refs) {
  updateConditional_128(instance, scope);
}
function updateRegion_conditional_146(instance, scope, refs) {
  updateConditional_146(instance, scope);
}
function updateRegion_text_149(instance, scope, refs) {
  const __next_text_149 = String(scope.guideLens ?? '');
  if (refs[149].data !== __next_text_149) {
    refs[149].data = __next_text_149;
  }
}
function updateRegion_text_151(instance, scope, refs) {
  const __next_text_151 = String(scope.selected.title ?? '');
  if (refs[151].data !== __next_text_151) {
    refs[151].data = __next_text_151;
  }
}
function updateRegion_conditional_157(instance, scope, refs) {
  updateConditional_157(instance, scope);
}
function updateRegion_text_162(instance, scope, refs) {
  const __next_text_162 = String(scope.guideLens ?? '');
  if (refs[162].data !== __next_text_162) {
    refs[162].data = __next_text_162;
  }
}
function updateRegion_text_165(instance, scope, refs) {
  const __next_text_165 = String(scope.guideChoices[0].title ?? '');
  if (refs[165].data !== __next_text_165) {
    refs[165].data = __next_text_165;
  }
}
function updateRegion_text_167(instance, scope, refs) {
  const __next_text_167 = String(scope.guideChoices[1].title ?? '');
  if (refs[167].data !== __next_text_167) {
    refs[167].data = __next_text_167;
  }
}
function updateRegion_text_169(instance, scope, refs) {
  const __next_text_169 = String(scope.guideChoices[2].title ?? '');
  if (refs[169].data !== __next_text_169) {
    refs[169].data = __next_text_169;
  }
}
function updateRegion_conditional_173(instance, scope, refs) {
  updateConditional_173(instance, scope);
}
function updateRegion_text_177(instance, scope, refs) {
  const __next_text_177 = String(scope.guidePair() ?? '');
  if (refs[177].data !== __next_text_177) {
    refs[177].data = __next_text_177;
  }
}
function updateRegion_attribute_181_class(instance, scope, refs) {
  const __value_181_class = scope.stanceClass('Make');
  if (
    __value_181_class === false ||
    __value_181_class === null ||
    __value_181_class === undefined
  ) {
    if (refs[181].hasAttribute('class')) {
      refs[181].removeAttribute('class');
    }
  } else if (__value_181_class === true) {
    if (!refs[181].hasAttribute('class')) {
      refs[181].setAttribute('class', '');
    }
  } else {
    refs[181].setAttribute('class', String(__value_181_class));
  }
}
function updateRegion_attribute_182_class(instance, scope, refs) {
  const __value_182_class = scope.stanceClass('Challenge');
  if (
    __value_182_class === false ||
    __value_182_class === null ||
    __value_182_class === undefined
  ) {
    if (refs[182].hasAttribute('class')) {
      refs[182].removeAttribute('class');
    }
  } else if (__value_182_class === true) {
    if (!refs[182].hasAttribute('class')) {
      refs[182].setAttribute('class', '');
    }
  } else {
    refs[182].setAttribute('class', String(__value_182_class));
  }
}
function updateRegion_attribute_184_value(instance, scope, refs) {
  const __value_184_value = scope.guideReason;
  const __next_184_value = __value_184_value ?? '';
  const __next_string_184_value = String(__next_184_value);
  if (refs[184].value !== __next_string_184_value) {
    refs[184].value = __next_string_184_value;
  }
  refs[184].setAttribute('value', __next_string_184_value);
}
function updateRegion_attribute_186_disabled(instance, scope, refs) {
  const __value_186_disabled =
    scope.busy || !scope.guideStance || scope.tooShort(scope.guideReason);
  const __next_186_disabled = Boolean(__value_186_disabled);
  if (refs[186].disabled !== __next_186_disabled) {
    refs[186].disabled = __next_186_disabled;
  }
  const __has_attr_186_disabled = refs[186].hasAttribute('disabled');
  if (__next_186_disabled) {
    if (!__has_attr_186_disabled) {
      refs[186].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_186_disabled) {
      refs[186].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_185(instance, scope, refs) {
  const __next_text_185 = String(
    (scope.busy ? 'Listening across the collection…' : 'Reveal the echo') ?? '',
  );
  if (refs[185].data !== __next_text_185) {
    refs[185].data = __next_text_185;
  }
}
function updateRegion_conditional_188(instance, scope, refs) {
  updateConditional_188(instance, scope);
}
function updateRegion_text_193(instance, scope, refs) {
  const __next_text_193 = String(scope.latestReaction ?? '');
  if (refs[193].data !== __next_text_193) {
    refs[193].data = __next_text_193;
  }
}
function updateRegion_conditional_200(instance, scope, refs) {
  updateConditional_200(instance, scope);
}
function updateRegion_text_203(instance, scope, refs) {
  const __next_text_203 = String(scope.data.mode ?? '');
  if (refs[203].data !== __next_text_203) {
    refs[203].data = __next_text_203;
  }
}
function updateRegion_text_205(instance, scope, refs) {
  const __next_text_205 = String(scope.data.world.title ?? '');
  if (refs[205].data !== __next_text_205) {
    refs[205].data = __next_text_205;
  }
}
function updateRegion_text_207(instance, scope, refs) {
  const __next_text_207 = String(scope.data.world.invitation ?? '');
  if (refs[207].data !== __next_text_207) {
    refs[207].data = __next_text_207;
  }
}
function updateRegion_conditional_210(instance, scope, refs) {
  updateConditional_210(instance, scope);
}
function updateRegion_text_214(instance, scope, refs) {
  const __next_text_214 = String(scope.perspective.message ?? '');
  if (refs[214].data !== __next_text_214) {
    refs[214].data = __next_text_214;
  }
}
function updateRegion_text_216(instance, scope, refs) {
  const __next_text_216 = String(scope.perspective.question ?? '');
  if (refs[216].data !== __next_text_216) {
    refs[216].data = __next_text_216;
  }
}
function updateRegion_loop_220(instance, scope, refs) {
  updateForLoop_220(instance, scope);
}
function updateRegion_attribute_232_class(instance, scope, refs) {
  const __value_232_class = scope.objectClass(scope.item.id);
  if (
    __value_232_class === false ||
    __value_232_class === null ||
    __value_232_class === undefined
  ) {
    if (refs[232].hasAttribute('class')) {
      refs[232].removeAttribute('class');
    }
  } else if (__value_232_class === true) {
    if (!refs[232].hasAttribute('class')) {
      refs[232].setAttribute('class', '');
    }
  } else {
    refs[232].setAttribute('class', String(__value_232_class));
  }
}
function updateRegion_attribute_232_title(instance, scope, refs) {
  const __value_232_title = 'Wander to ' + scope.item.title;
  if (
    __value_232_title === false ||
    __value_232_title === null ||
    __value_232_title === undefined
  ) {
    if (refs[232].hasAttribute('title')) {
      refs[232].removeAttribute('title');
    }
  } else if (__value_232_title === true) {
    if (!refs[232].hasAttribute('title')) {
      refs[232].setAttribute('title', '');
    }
  } else {
    refs[232].setAttribute('title', String(__value_232_title));
  }
}
function updateRegion_attribute_223_src(instance, scope, refs) {
  const __value_223_src = scope.item.image;
  if (__value_223_src === false || __value_223_src === null || __value_223_src === undefined) {
    if (refs[223].hasAttribute('src')) {
      refs[223].removeAttribute('src');
    }
  } else if (__value_223_src === true) {
    if (!refs[223].hasAttribute('src')) {
      refs[223].setAttribute('src', '');
    }
  } else {
    refs[223].setAttribute('src', String(__value_223_src));
  }
}
function updateRegion_text_224(instance, scope, refs) {
  const __next_text_224 = String(scope.nodeNumber(scope.item.id) ?? '');
  if (refs[224].data !== __next_text_224) {
    refs[224].data = __next_text_224;
  }
}
function updateRegion_text_226(instance, scope, refs) {
  const __next_text_226 = String(scope.item.title ?? '');
  if (refs[226].data !== __next_text_226) {
    refs[226].data = __next_text_226;
  }
}
function updateRegion_text_228(instance, scope, refs) {
  const __next_text_228 = String(scope.item.date ?? '');
  if (refs[228].data !== __next_text_228) {
    refs[228].data = __next_text_228;
  }
}
function updateRegion_text_229(instance, scope, refs) {
  const __next_text_229 = String(scope.item.place ?? '');
  if (refs[229].data !== __next_text_229) {
    refs[229].data = __next_text_229;
  }
}
function updateRegion_attribute_237_src(instance, scope, refs) {
  const __value_237_src = scope.selected.image;
  if (__value_237_src === false || __value_237_src === null || __value_237_src === undefined) {
    if (refs[237].hasAttribute('src')) {
      refs[237].removeAttribute('src');
    }
  } else if (__value_237_src === true) {
    if (!refs[237].hasAttribute('src')) {
      refs[237].setAttribute('src', '');
    }
  } else {
    refs[237].setAttribute('src', String(__value_237_src));
  }
}
function updateRegion_attribute_237_alt(instance, scope, refs) {
  const __value_237_alt = scope.selected.title;
  if (__value_237_alt === false || __value_237_alt === null || __value_237_alt === undefined) {
    if (refs[237].hasAttribute('alt')) {
      refs[237].removeAttribute('alt');
    }
  } else if (__value_237_alt === true) {
    if (!refs[237].hasAttribute('alt')) {
      refs[237].setAttribute('alt', '');
    }
  } else {
    refs[237].setAttribute('alt', String(__value_237_alt));
  }
}
function updateRegion_text_238(instance, scope, refs) {
  const __next_text_238 = String(scope.selected.kind ?? '');
  if (refs[238].data !== __next_text_238) {
    refs[238].data = __next_text_238;
  }
}
function updateRegion_text_241(instance, scope, refs) {
  const __next_text_241 = String(scope.selected.id ?? '');
  if (refs[241].data !== __next_text_241) {
    refs[241].data = __next_text_241;
  }
}
function updateRegion_text_243(instance, scope, refs) {
  const __next_text_243 = String(scope.selected.title ?? '');
  if (refs[243].data !== __next_text_243) {
    refs[243].data = __next_text_243;
  }
}
function updateRegion_text_245(instance, scope, refs) {
  const __next_text_245 = String(scope.selected.maker ?? '');
  if (refs[245].data !== __next_text_245) {
    refs[245].data = __next_text_245;
  }
}
function updateRegion_text_246(instance, scope, refs) {
  const __next_text_246 = String(scope.selected.date ?? '');
  if (refs[246].data !== __next_text_246) {
    refs[246].data = __next_text_246;
  }
}
function updateRegion_text_248(instance, scope, refs) {
  const __next_text_248 = String(scope.selected.material ?? '');
  if (refs[248].data !== __next_text_248) {
    refs[248].data = __next_text_248;
  }
}
function updateRegion_text_250(instance, scope, refs) {
  const __next_text_250 = String(scope.selected.source.mode ?? '');
  if (refs[250].data !== __next_text_250) {
    refs[250].data = __next_text_250;
  }
}
function updateRegion_attribute_252_href(instance, scope, refs) {
  const __value_252_href = scope.selected.source.sourceLink;
  if (__value_252_href === false || __value_252_href === null || __value_252_href === undefined) {
    if (refs[252].hasAttribute('href')) {
      refs[252].removeAttribute('href');
    }
  } else if (__value_252_href === true) {
    if (!refs[252].hasAttribute('href')) {
      refs[252].setAttribute('href', '');
    }
  } else {
    refs[252].setAttribute('href', String(__value_252_href));
  }
}
function updateRegion_attribute_258_value(instance, scope, refs) {
  const __value_258_value = scope.draftThought;
  const __next_258_value = __value_258_value ?? '';
  const __next_string_258_value = String(__next_258_value);
  if (refs[258].value !== __next_string_258_value) {
    refs[258].value = __next_string_258_value;
  }
  refs[258].setAttribute('value', __next_string_258_value);
}
function updateRegion_attribute_259_disabled(instance, scope, refs) {
  const __value_259_disabled = scope.busy || scope.tooShort(scope.draftThought);
  const __next_259_disabled = Boolean(__value_259_disabled);
  if (refs[259].disabled !== __next_259_disabled) {
    refs[259].disabled = __next_259_disabled;
  }
  const __has_attr_259_disabled = refs[259].hasAttribute('disabled');
  if (__next_259_disabled) {
    if (!__has_attr_259_disabled) {
      refs[259].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_259_disabled) {
      refs[259].removeAttribute('disabled');
    }
  }
}
function updateRegion_attribute_269_value(instance, scope, refs) {
  const __value_269_value = scope.trailTarget;
  const __next_269_value = __value_269_value ?? '';
  const __next_string_269_value = String(__next_269_value);
  if (refs[269].value !== __next_string_269_value) {
    refs[269].value = __next_string_269_value;
  }
  refs[269].setAttribute('value', __next_string_269_value);
}
function updateRegion_loop_264(instance, scope, refs) {
  updateForLoop_264(instance, scope);
}
function updateRegion_attribute_268_value(instance, scope, refs) {
  const __value_268_value = scope.item.id;
  const __next_268_value = __value_268_value ?? '';
  const __next_string_268_value = String(__next_268_value);
  if (refs[268].value !== __next_string_268_value) {
    refs[268].value = __next_string_268_value;
  }
  refs[268].setAttribute('value', __next_string_268_value);
}
function updateRegion_text_267(instance, scope, refs) {
  const __next_text_267 = String(scope.item.title ?? '');
  if (refs[267].data !== __next_text_267) {
    refs[267].data = __next_text_267;
  }
}
function updateRegion_attribute_270_value(instance, scope, refs) {
  const __value_270_value = scope.draftTrail;
  const __next_270_value = __value_270_value ?? '';
  const __next_string_270_value = String(__next_270_value);
  if (refs[270].value !== __next_string_270_value) {
    refs[270].value = __next_string_270_value;
  }
  refs[270].setAttribute('value', __next_string_270_value);
}
function updateRegion_attribute_271_disabled(instance, scope, refs) {
  const __value_271_disabled = scope.busy || !scope.trailTarget || scope.tooShort(scope.draftTrail);
  const __next_271_disabled = Boolean(__value_271_disabled);
  if (refs[271].disabled !== __next_271_disabled) {
    refs[271].disabled = __next_271_disabled;
  }
  const __has_attr_271_disabled = refs[271].hasAttribute('disabled');
  if (__next_271_disabled) {
    if (!__has_attr_271_disabled) {
      refs[271].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_271_disabled) {
      refs[271].removeAttribute('disabled');
    }
  }
}
function updateRegion_conditional_274(instance, scope, refs) {
  updateConditional_274(instance, scope);
}
function updateRegion_text_278(instance, scope, refs) {
  const __next_text_278 = String(scope.latestReaction ?? '');
  if (refs[278].data !== __next_text_278) {
    refs[278].data = __next_text_278;
  }
}
function updateRegion_text_284(instance, scope, refs) {
  const __next_text_284 = String(scope.data.interpretations.length ?? '');
  if (refs[284].data !== __next_text_284) {
    refs[284].data = __next_text_284;
  }
}
function updateRegion_text_285(instance, scope, refs) {
  const __next_text_285 = String(scope.visitorTrailCount() ?? '');
  if (refs[285].data !== __next_text_285) {
    refs[285].data = __next_text_285;
  }
}
function updateRegion_conditional_288(instance, scope, refs) {
  updateConditional_288(instance, scope);
}
function updateRegion_loop_292(instance, scope, refs) {
  updateForLoop_292(instance, scope);
}
function updateRegion_text_295(instance, scope, refs) {
  const __next_text_295 = String(scope.thought.body ?? '');
  if (refs[295].data !== __next_text_295) {
    refs[295].data = __next_text_295;
  }
}
function updateRegion_text_297(instance, scope, refs) {
  const __next_text_297 = String(scope.thought.visitor_name ?? '');
  if (refs[297].data !== __next_text_297) {
    refs[297].data = __next_text_297;
  }
}
function updateRegion_text_298(instance, scope, refs) {
  const __next_text_298 = String(scope.relativeTime(scope.thought.created_at) ?? '');
  if (refs[298].data !== __next_text_298) {
    refs[298].data = __next_text_298;
  }
}
function updateRegion_loop_302(instance, scope, refs) {
  updateForLoop_302(instance, scope);
}
function updateRegion_text_306(instance, scope, refs) {
  const __next_text_306 = String(scope.trail.label ?? '');
  if (refs[306].data !== __next_text_306) {
    refs[306].data = __next_text_306;
  }
}
function updateRegion_text_308(instance, scope, refs) {
  const __next_text_308 = String(scope.trailOrigin(scope.trail) ?? '');
  if (refs[308].data !== __next_text_308) {
    refs[308].data = __next_text_308;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_text_0(instance, scope, refs);
  updateRegion_text_7(instance, scope, refs);
  updateRegion_conditional_10(instance, scope, refs);
  updateRegion_conditional_37(instance, scope, refs);
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
    dirtySet.has('auth') ||
    dirtySet.has('busy') ||
    dirtySet.has('initialized') ||
    dirtySet.has('load') ||
    dirtySet.has('returnToWorld') ||
    dirtySet.has('showEntrance') ||
    dirtyRegionSet.has(1)
  ) {
    updateRegion_text_0(instance, scope, refs);
  }
  if (
    dirtySet.has('busy') ||
    dirtySet.has('presenceLabel') ||
    dirtySet.has('data') ||
    dirtyRegionSet.has(2)
  ) {
    updateRegion_text_7(instance, scope, refs);
  }
  if (
    dirtySet.has('showEntrance') ||
    dirtySet.has('draftName') ||
    dirtySet.has('busy') ||
    dirtySet.has('errorMessage') ||
    dirtyRegionSet.has(3)
  ) {
    updateRegion_conditional_10(instance, scope, refs);
  }
  if (
    dirtySet.has('data') ||
    dirtySet.has('initial') ||
    dirtySet.has('showHow') ||
    dirtySet.has('errorMessage') ||
    dirtySet.has('shortId') ||
    dirtySet.has('guideActive') ||
    dirtySet.has('guideProgress') ||
    dirtySet.has('guideStep') ||
    dirtySet.has('guideLens') ||
    dirtySet.has('selected') ||
    dirtySet.has('guideChoices') ||
    dirtySet.has('guidePair') ||
    dirtySet.has('guideFrom') ||
    dirtySet.has('guideTo') ||
    dirtySet.has('stanceClass') ||
    dirtySet.has('guideStance') ||
    dirtySet.has('guideReason') ||
    dirtySet.has('busy') ||
    dirtySet.has('tooShort') ||
    dirtySet.has('latestReaction') ||
    dirtySet.has('perspective') ||
    dirtySet.has('objectClass') ||
    dirtySet.has('nodeNumber') ||
    dirtySet.has('draftThought') ||
    dirtySet.has('trailTarget') ||
    dirtySet.has('otherObjects') ||
    dirtySet.has('draftTrail') ||
    dirtySet.has('visitorTrailCount') ||
    dirtySet.has('nearbyThoughts') ||
    dirtySet.has('relativeTime') ||
    dirtySet.has('nearbyTrails') ||
    dirtySet.has('trailOrigin') ||
    dirtyRegionSet.has(4)
  ) {
    updateRegion_conditional_37(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[12] === true) {
    if (refs[32] === true) {
    } else {
    }
  } else {
  }
  if (refs[39] === true) {
    const __records_50 = refs[50] ?? [];
    for (const record of __records_50) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    const __records_61 = refs[61] ?? [];
    for (const record of __records_61) {
      if (record.handle && typeof record.handle.destroy === 'function') {
        record.handle.destroy();
      } else if (typeof record.destroy === 'function') {
        record.destroy();
      }
    }
    if (refs[72] === true) {
    } else {
    }
    if (refs[77] === true) {
      if (refs[98] === true) {
      } else {
      }
      const __records_102 = refs[102] ?? [];
      for (const record of __records_102) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
    } else {
    }
    if (refs[115] === true) {
      if (refs[118] === true) {
        if (refs[130] === true) {
        } else {
        }
        if (refs[148] === true) {
        } else {
        }
        if (refs[159] === true) {
        } else {
        }
        if (refs[175] === true) {
        } else {
        }
        if (refs[190] === true) {
        } else {
        }
      } else {
      }
      if (refs[202] === true) {
        if (refs[212] === true) {
        } else {
        }
      } else {
      }
      const __records_222 = refs[222] ?? [];
      for (const record of __records_222) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
      const __records_266 = refs[266] ?? [];
      for (const record of __records_266) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
      if (refs[276] === true) {
      } else {
      }
      if (refs[290] === true) {
      } else {
      }
      const __records_294 = refs[294] ?? [];
      for (const record of __records_294) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
      const __records_304 = refs[304] ?? [];
      for (const record of __records_304) {
        if (record.handle && typeof record.handle.destroy === 'function') {
          record.handle.destroy();
        } else if (typeof record.destroy === 'function') {
          record.destroy();
        }
      }
    } else {
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
