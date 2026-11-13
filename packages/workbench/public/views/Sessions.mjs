import * as PageHeader from "../components/PageHeader.mjs";
import * as Status from "../components/Status.mjs";

function replaceBetween(start, end, content) {
  const parent = start.parentNode;
  if (!parent || parent !== end.parentNode) {
    throw new Error("Conditional boundary is detached");
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
    throw new Error("Boundary move target is detached");
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
    if (!Object.prototype.hasOwnProperty.call(afterScope, key) || !Object.is(beforeScope[key], afterScope[key])) {
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
  if (!dirtyState || typeof dirtyState !== "object") {
    return { bindings: [], paths: [] };
  }
  return {
    bindings: Array.isArray(dirtyState.bindings) ? dirtyState.bindings : [],
    paths: Array.isArray(dirtyState.paths) ? dirtyState.paths : [],
  };
}

const __weiv_observableBrand = Symbol.for("weiv.observable");

function __weiv_getObservableNode(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return null;
  }
  const node = Reflect.get(value, __weiv_observableBrand);
  if (!node || typeof node !== "object") {
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
    if (!pathRecord || pathRecord.rootId !== rootId || typeof pathRecord.path !== "string") continue;
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
      if (typeof instance.updateDirty === "function") {
        const scope = instance.refresh();
        instance.updateDirty({ bindings: [], paths: dirtyPaths }, scope);
      } else if (typeof instance.update === "function") {
        instance.update();
      }
    }
  });
}

function __weiv_wrapTrackedValue(rootId, currentPath, value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  const proxy = new Proxy(value, {
    get(target, prop, receiver) {
      const result = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string") {
        return result;
      }
      const nextPath = currentPath ? `${currentPath}.${prop}` : prop;
      return __weiv_wrapTrackedValue(rootId, nextPath, result);
    },
    set(target, prop, nextValue, receiver) {
      const updated = Reflect.set(target, prop, nextValue, receiver);
      if (updated && typeof prop === "string") {
        const nextPath = currentPath ? `${currentPath}.${prop}` : prop;
        __weiv_markTrackedPathsForWrite(rootId, nextPath);
        __weiv_scheduleTrackedFlush();
      }
      return updated;
    },
    deleteProperty(target, prop) {
      const updated = Reflect.deleteProperty(target, prop);
      if (updated && typeof prop === "string") {
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
  return trackedStateGraph && Array.isArray(trackedStateGraph.roots) && trackedStateGraph.roots.length > 0;
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
    if (typeof instance.updateDirty === "function") {
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
  if (result && typeof result.then === "function") {
    return result.finally(() => {
      flushOwnedBoundary(instance, beforeScope);
    });
  }
  return result;
}
function createConditionalFragment_3(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_19 = document.createElement("div");
    refs[19] = __ref_19;
    __ref_19.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
    __ref_19.setAttribute("class", "grid");
    const __ref_6 = document.createComment("for:start");
    const __ref_7 = document.createComment("for:end");
    refs[6] = __ref_6;
    refs[7] = __ref_7;
    refs[8] = [];
    __ref_19.append(__ref_6);
    __ref_19.append(__ref_7);
    fragment.append(__ref_19);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_3(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_8 = refs[8] ?? [];
    for (const record of __records_8) {
      if (record.handle && typeof record.handle.destroy === "function") {
        record.handle.destroy();
      } else if (typeof record.destroy === "function") {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_3(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.items.length);
  if (refs[5] !== next) {
    const previous = refs[5];
    destroyConditionalBranch_3(instance, previous === true);
    refs[5] = next;
    replaceBetween(refs[3], refs[4], createConditionalFragment_3(instance, scope, next));
  }
  if (next) {
    updateRegion_loop_6(instance, scope, refs);
  } else {
  }
}

function createForEntry_6(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment("for:item:start");
  const end = document.createComment("for:item:end");
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ["item"]: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ["item"]: currentItem };
    updateRegion_attribute_18_href(instance, loopScope, entryRefs);
    updateRegion_text_10(instance, loopScope, entryRefs);
    updateRegion_text_12(instance, loopScope, entryRefs);
    updateRegion_attribute_15_class(instance, loopScope, entryRefs);
    updateRegion_text_14(instance, loopScope, entryRefs);
    updateRegion_attribute_16_class(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_18 = document.createElement("a");
  entryRefs[18] = __ref_18;
  __ref_18.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
  __ref_18.setAttribute("class", "card");
  const __ref_9 = document.createElement("div");
  entryRefs[9] = __ref_9;
  __ref_9.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
  __ref_9.setAttribute("class", "card-kind");
  __ref_9.append(document.createTextNode("Session"));
  __ref_18.append(__ref_9);
  const __ref_11 = document.createElement("h2");
  entryRefs[11] = __ref_11;
  __ref_11.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
  const __ref_10 = document.createTextNode("");
  entryRefs[10] = __ref_10;
  __ref_11.append(__ref_10);
  __ref_18.append(__ref_11);
  const __ref_13 = document.createElement("div");
  entryRefs[13] = __ref_13;
  __ref_13.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
  __ref_13.setAttribute("class", "muted");
  const __ref_12 = document.createTextNode("");
  entryRefs[12] = __ref_12;
  __ref_13.append(__ref_12);
  __ref_18.append(__ref_13);
  const __ref_17 = document.createElement("div");
  entryRefs[17] = __ref_17;
  __ref_17.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
  __ref_17.setAttribute("class", "meta");
  const __ref_15 = document.createElement("span");
  entryRefs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
  const __ref_14 = document.createTextNode("");
  entryRefs[14] = __ref_14;
  __ref_15.append(__ref_14);
  __ref_17.append(__ref_15);
  const __ref_16 = document.createElement("span");
  entryRefs[16] = __ref_16;
  __ref_16.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
  __ref_16.append(document.createTextNode("Work in progress"));
  __ref_17.append(__ref_16);
  __ref_18.append(__ref_17);
  fragment.append(__ref_18);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_6(instance, scope) {
  const refs = instance.refs;
  const iterable = (scope.props.items) ?? [];
  const previous = refs[8] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[7]);
    } else {
      record = createForEntry_6(instance, scope, item, refs[7]);
    }
    nextRecords.push(record);
  }
  for (const record of previousByKey.values()) {
    if (typeof record.destroy === "function") {
      record.destroy();
    }
    replaceBetween(record.start, record.end, document.createDocumentFragment());
    record.start.parentNode.removeChild(record.start);
    record.end.parentNode.removeChild(record.end);
  }
  refs[8] = nextRecords;
}

function createConditionalFragment_20(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_25 = document.createElement("div");
    refs[25] = __ref_25;
    __ref_25.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
    __ref_25.setAttribute("class", "empty");
    const __ref_23 = document.createElement("h2");
    refs[23] = __ref_23;
    __ref_23.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
    __ref_23.append(document.createTextNode("No Sessions yet"));
    __ref_25.append(__ref_23);
    const __ref_24 = document.createElement("p");
    refs[24] = __ref_24;
    __ref_24.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
    __ref_24.append(document.createTextNode("Open an Agent Definition to start a conversation."));
    __ref_25.append(__ref_24);
    fragment.append(__ref_25);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_20(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_20(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.props.items.length);
  if (refs[22] !== next) {
    const previous = refs[22];
    destroyConditionalBranch_20(instance, previous === true);
    refs[22] = next;
    replaceBetween(refs[20], refs[21], createConditionalFragment_20(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function setup(__weiv_props, __weiv_event_handlers = {}) {
  let props = __weiv_props;
  let __weiv_handlers = __weiv_event_handlers;
  let __weiv_runBoundary = (callback) => callback();
  const __weiv_wrapCallback = (callback) => {
    if (typeof callback !== "function") {
      return callback;
    }
    return (...args) => __weiv_runBoundary(() => callback(...args));
  };
  const setTimeout = (callback, ...args) => globalThis.setTimeout(__weiv_wrapCallback(callback), ...args);
  const setInterval = (callback, ...args) => globalThis.setInterval(__weiv_wrapCallback(callback), ...args);
  const queueMicrotask = (callback) => globalThis.queueMicrotask(__weiv_wrapCallback(callback));
  const requestAnimationFrame = (callback) => globalThis.requestAnimationFrame(__weiv_wrapCallback(callback));
  const emit = (name, payload) => {
    if (typeof __weiv_handlers[name] === "function") {
      return __weiv_handlers[name](payload);
    }
    return undefined;
  };
  props = __weiv_getTrackedRoot("props", props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    return __weiv_scope;
  }
  function __weiv_setProps(nextProps) {
    props = __weiv_getTrackedRoot("props", nextProps);
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
      if (!__weiv_node || __weiv_seen.has(__weiv_node) || !__weiv_node.listeners || typeof __weiv_node.listeners.add !== "function") {
        return;
      }
      __weiv_seen.add(__weiv_node);
      const __weiv_listener = () => {
        if (instance.destroyed) {
          return;
        }
        if (typeof instance.update === "function") {
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
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, setBoundaryRunner: __weiv_setBoundaryRunner, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "w8DA928688A50D0AC";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.items", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.items.length", parentPathId: 2 }], regions: [{ regionId: 2, trackedPathIds: [3] }, { regionId: 3, trackedPathIds: [3] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_26 = document.createElement("div");
  refs[26] = __ref_26;
  __ref_26.setAttribute("data-weiv-scope", "w8DA928688A50D0AC");
  const __ref_0 = document.createComment("component:start");
  const __ref_1 = document.createComment("component:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  __ref_26.append(__ref_0);
  __ref_26.append(__ref_1);
  const __props_2 = {"title": 'Sessions', "subtitle": 'Long-running conversations with an Agent and durable history.'};
  refs[2] = PageHeader.mountIntoBoundary(__ref_0, __ref_1, __props_2, undefined, undefined);
  const __ref_3 = document.createComment("if:start");
  const __ref_4 = document.createComment("if:end");
  refs[3] = __ref_3;
  refs[4] = __ref_4;
  refs[5] = undefined;
  __ref_26.append(__ref_3);
  __ref_26.append(__ref_4);
  const __ref_20 = document.createComment("if:start");
  const __ref_21 = document.createComment("if:end");
  refs[20] = __ref_20;
  refs[21] = __ref_21;
  refs[22] = undefined;
  __ref_26.append(__ref_20);
  __ref_26.append(__ref_21);
  fragment.append(__ref_26);
  return fragment;
}

function updateRegion_child_2(instance, scope, refs) {
  refs[2].setProps({"title": 'Sessions', "subtitle": 'Long-running conversations with an Agent and durable history.'});
  refs[2].update();
}
function updateRegion_conditional_3(instance, scope, refs) {
  updateConditional_3(instance, scope);
}
function updateRegion_loop_6(instance, scope, refs) {
  updateForLoop_6(instance, scope);
}
function updateRegion_attribute_18_href(instance, scope, refs) {
  const __value_18_href = scope.item.url;
  if (__value_18_href === false || __value_18_href === null || __value_18_href === undefined) {
    if (refs[18].hasAttribute("href")) { refs[18].removeAttribute("href"); }
  } else if (__value_18_href === true) {
    if (!refs[18].hasAttribute("href")) { refs[18].setAttribute("href", ""); }
  } else {
    refs[18].setAttribute("href", String(__value_18_href));
  }
}
function updateRegion_text_10(instance, scope, refs) {
  const __next_text_10 = String((scope.item.title) ?? "");
  if (refs[10].data !== __next_text_10) {
    refs[10].data = __next_text_10;
  }
}
function updateRegion_text_12(instance, scope, refs) {
  const __next_text_12 = String((scope.item.agent.id) ?? "");
  if (refs[12].data !== __next_text_12) {
    refs[12].data = __next_text_12;
  }
}
function updateRegion_attribute_15_class(instance, scope, refs) {
  const __value_15_class = 'pill ' + scope.item.status;
  if (__value_15_class === false || __value_15_class === null || __value_15_class === undefined) {
    if (refs[15].hasAttribute("class")) { refs[15].removeAttribute("class"); }
  } else if (__value_15_class === true) {
    if (!refs[15].hasAttribute("class")) { refs[15].setAttribute("class", ""); }
  } else {
    refs[15].setAttribute("class", String(__value_15_class));
  }
}
function updateRegion_text_14(instance, scope, refs) {
  const __next_text_14 = String((scope.item.status) ?? "");
  if (refs[14].data !== __next_text_14) {
    refs[14].data = __next_text_14;
  }
}
function updateRegion_attribute_16_class(instance, scope, refs) {
  const __value_16_class = scope.item.foregroundWorkId ? 'pill running' : 'hidden';
  if (__value_16_class === false || __value_16_class === null || __value_16_class === undefined) {
    if (refs[16].hasAttribute("class")) { refs[16].removeAttribute("class"); }
  } else if (__value_16_class === true) {
    if (!refs[16].hasAttribute("class")) { refs[16].setAttribute("class", ""); }
  } else {
    refs[16].setAttribute("class", String(__value_16_class));
  }
}
function updateRegion_conditional_20(instance, scope, refs) {
  updateConditional_20(instance, scope);
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_2(instance, scope, refs);
  updateRegion_conditional_3(instance, scope, refs);
  updateRegion_conditional_20(instance, scope, refs);
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
  if (dirtyRegionSet.has(1)) {
    updateRegion_child_2(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(2)) {
    updateRegion_conditional_3(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(3)) {
    updateRegion_conditional_20(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[2] && typeof refs[2].destroy === "function") {
    refs[2].destroy();
  }
  if (refs[5] === true) {
    const __records_8 = refs[8] ?? [];
    for (const record of __records_8) {
      if (record.handle && typeof record.handle.destroy === "function") {
        record.handle.destroy();
      } else if (typeof record.destroy === "function") {
        record.destroy();
      }
    }
  } else {
  }
  if (refs[22] === true) {
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
    setSlots: (nextSlots = {}) => { instance.slots = nextSlots; },
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
  instance.setSlots = (nextSlots = {}) => { instance.slots = nextSlots; };
  const fragment = createDom(instance);
  replaceBetween(start, end, fragment);
  instance.update = () => updateDom(instance);
  instance.updateDirty = (dirtyBindings, scope) => updateDirtyRegions(instance, dirtyBindings, scope);
  const __weiv_unsubscribeImportedObservables = typeof instance.subscribeImportedObservables === "function"
    ? instance.subscribeImportedObservables(instance)
    : null;
  instance.destroy = () => { if (typeof __weiv_unsubscribeImportedObservables === "function") __weiv_unsubscribeImportedObservables(); __weiv_unregisterTrackedSubscriber(instance); instance.destroyed = true; destroyDom(instance); replaceBetween(start, end, document.createDocumentFragment()); };
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
  const start = document.createComment("root:start");
  const end = document.createComment("root:end");
  target.replaceChildren(start, end);
  return mountIntoBoundary(start, end, props, eventHandlers, slots);
}
