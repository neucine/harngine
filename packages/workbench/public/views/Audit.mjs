import * as PageHeader from "../components/PageHeader.mjs";
import { pretty as __weiv_import_pretty } from "../api.js";

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
function createForEntry_1(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment("for:item:start");
  const end = document.createComment("for:item:end");
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ["option"]: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ["option"]: currentItem };
    updateRegion_attribute_5_value(instance, loopScope, entryRefs);
    updateRegion_text_4(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_5 = document.createElement("option");
  entryRefs[5] = __ref_5;
  __ref_5.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_4 = document.createTextNode("");
  entryRefs[4] = __ref_4;
  __ref_5.append(__ref_4);
  fragment.append(__ref_5);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_1(instance, scope) {
  const refs = instance.refs;
  const iterable = (scope.categories) ?? [];
  const previous = refs[3] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[2]);
    } else {
      record = createForEntry_1(instance, scope, item, refs[2]);
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
  refs[3] = nextRecords;
}

function mountProjectedSlot_10_0(start, end, ownerInstance) {
  const instance = { refs: [], refresh: () => ownerInstance.refresh(), update: () => ownerInstance.update() };
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  const __ref_7 = document.createElement("label");
  refs[7] = __ref_7;
  __ref_7.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_7.setAttribute("class", "pill");
  __ref_7.append(document.createTextNode("Category\n        "));
  const __ref_6 = document.createElement("select");
  refs[6] = __ref_6;
  __ref_6.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_6.addEventListener("change", (event) => {
    const resolved = instance.refresh().categoryChange;
    if (typeof resolved === "function") {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_0 = document.createElement("option");
  refs[0] = __ref_0;
  __ref_0.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_0.setAttribute("value", "");
  __ref_0.append(document.createTextNode("All"));
  __ref_6.append(__ref_0);
  const __ref_1 = document.createComment("for:start");
  const __ref_2 = document.createComment("for:end");
  refs[1] = __ref_1;
  refs[2] = __ref_2;
  refs[3] = [];
  __ref_6.append(__ref_1);
  __ref_6.append(__ref_2);
  __ref_7.append(__ref_6);
  fragment.append(__ref_7);
  replaceBetween(start, end, fragment);
  function update() {
    const refs = instance.refs;
    const scope = instance.refresh();
    updateRegion_attribute_6_value(instance, scope, refs);
    updateRegion_loop_1(instance, scope, refs);
  }
  function destroy() {
    const refs = instance.refs;
    const __records_3 = refs[3] ?? [];
    for (const record of __records_3) {
      if (record.handle && typeof record.handle.destroy === "function") {
        record.handle.destroy();
      } else if (typeof record.destroy === "function") {
        record.destroy();
      }
    }
  }
  update();
  return { update, destroy, start, end };
}

function createForEntry_16(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment("for:item:start");
  const end = document.createComment("for:item:end");
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ["entry"]: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ["entry"]: currentItem };
    updateRegion_text_19(instance, loopScope, entryRefs);
    updateRegion_text_21(instance, loopScope, entryRefs);
    updateRegion_text_24(instance, loopScope, entryRefs);
    updateRegion_text_26(instance, loopScope, entryRefs);
    updateRegion_text_29(instance, loopScope, entryRefs);
    updateRegion_text_32(instance, loopScope, entryRefs);
    updateRegion_text_36(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_39 = document.createElement("div");
  entryRefs[39] = __ref_39;
  __ref_39.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_39.setAttribute("class", "entry");
  const __ref_23 = document.createElement("div");
  entryRefs[23] = __ref_23;
  __ref_23.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_23.setAttribute("class", "toolbar");
  const __ref_20 = document.createElement("b");
  entryRefs[20] = __ref_20;
  __ref_20.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_19 = document.createTextNode("");
  entryRefs[19] = __ref_19;
  __ref_20.append(__ref_19);
  __ref_23.append(__ref_20);
  const __ref_22 = document.createElement("span");
  entryRefs[22] = __ref_22;
  __ref_22.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_22.setAttribute("class", "pill");
  const __ref_21 = document.createTextNode("");
  entryRefs[21] = __ref_21;
  __ref_22.append(__ref_21);
  __ref_23.append(__ref_22);
  __ref_39.append(__ref_23);
  const __ref_25 = document.createElement("div");
  entryRefs[25] = __ref_25;
  __ref_25.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_25.setAttribute("class", "muted mono");
  const __ref_24 = document.createTextNode("");
  entryRefs[24] = __ref_24;
  __ref_25.append(__ref_24);
  __ref_39.append(__ref_25);
  const __ref_28 = document.createElement("div");
  entryRefs[28] = __ref_28;
  __ref_28.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_28.setAttribute("class", "meta");
  const __ref_27 = document.createElement("span");
  entryRefs[27] = __ref_27;
  __ref_27.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_27.setAttribute("class", "pill");
  const __ref_26 = document.createTextNode("");
  entryRefs[26] = __ref_26;
  __ref_27.append(__ref_26);
  __ref_28.append(__ref_27);
  __ref_39.append(__ref_28);
  const __ref_30 = document.createElement("div");
  entryRefs[30] = __ref_30;
  __ref_30.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_30.append(document.createTextNode("Outcome: "));
  const __ref_29 = document.createTextNode("");
  entryRefs[29] = __ref_29;
  __ref_30.append(__ref_29);
  __ref_39.append(__ref_30);
  const __ref_34 = document.createElement("div");
  entryRefs[34] = __ref_34;
  __ref_34.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_31 = document.createElement("span");
  entryRefs[31] = __ref_31;
  __ref_31.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_31.setAttribute("class", "label");
  __ref_31.append(document.createTextNode("Reason"));
  __ref_34.append(__ref_31);
  const __ref_33 = document.createElement("div");
  entryRefs[33] = __ref_33;
  __ref_33.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_32 = document.createTextNode("");
  entryRefs[32] = __ref_32;
  __ref_33.append(__ref_32);
  __ref_34.append(__ref_33);
  __ref_39.append(__ref_34);
  const __ref_38 = document.createElement("details");
  entryRefs[38] = __ref_38;
  __ref_38.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_35 = document.createElement("summary");
  entryRefs[35] = __ref_35;
  __ref_35.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_35.append(document.createTextNode("Entry details"));
  __ref_38.append(__ref_35);
  const __ref_37 = document.createElement("pre");
  entryRefs[37] = __ref_37;
  __ref_37.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_36 = document.createTextNode("");
  entryRefs[36] = __ref_36;
  __ref_37.append(__ref_36);
  __ref_38.append(__ref_37);
  __ref_39.append(__ref_38);
  fragment.append(__ref_39);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_16(instance, scope) {
  const refs = instance.refs;
  const iterable = (scope.props.entries) ?? [];
  const previous = refs[18] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[17]);
    } else {
      record = createForEntry_16(instance, scope, item, refs[17]);
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
  refs[18] = nextRecords;
}

function createConditionalFragment_40(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_43 = document.createElement("div");
    refs[43] = __ref_43;
    __ref_43.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
    __ref_43.setAttribute("class", "muted");
    __ref_43.append(document.createTextNode("No audit entries match this filter."));
    fragment.append(__ref_43);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_40(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_40(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.props.entries.length);
  if (refs[42] !== next) {
    const previous = refs[42];
    destroyConditionalBranch_40(instance, previous === true);
    refs[42] = next;
    replaceBetween(refs[40], refs[41], createConditionalFragment_40(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_44(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_47 = document.createElement("button");
    refs[47] = __ref_47;
    __ref_47.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
    __ref_47.addEventListener("click", (event) => {
      const resolved = scope.more;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_47.append(document.createTextNode("Load more"));
    fragment.append(__ref_47);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_44(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_44(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.next);
  if (refs[46] !== next) {
    const previous = refs[46];
    destroyConditionalBranch_44(instance, previous === true);
    refs[46] = next;
    replaceBetween(refs[44], refs[45], createConditionalFragment_44(instance, scope, next));
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
  let categories = [
  "work",
  "decision",
  "authorization",
  "guardrail",
  "attempt",
  "interaction",
  "session"
  ];
  function categoryChange(event) {
  emit("category", event.target.value);
  }
  function more() {
  emit("more", props.next);
  }
  const pretty = __weiv_getTrackedRoot("pretty", __weiv_import_pretty);
  props = __weiv_getTrackedRoot("props", props);
  categories = __weiv_getTrackedRoot("categories", categories);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.pretty = pretty;
    __weiv_scope.props = props;
    __weiv_scope.categories = categories;
    __weiv_scope.categoryChange = categoryChange;
    __weiv_scope.more = more;
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
    __weiv_register(pretty);
    return () => {
      for (const __weiv_unsubscribe of __weiv_unsubscribes) {
        __weiv_unsubscribe();
      }
    };
  }
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, setBoundaryRunner: __weiv_setBoundaryRunner, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "wA725F3677121BF9F";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.entries", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.entries.length", parentPathId: 2 }, { pathId: 4, rootId: 1, path: "props.next", parentPathId: 1 }], regions: [{ regionId: 2, trackedPathIds: [3] }, { regionId: 3, trackedPathIds: [2] }, { regionId: 4, trackedPathIds: [3] }, { regionId: 5, trackedPathIds: [4] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_50 = document.createElement("div");
  refs[50] = __ref_50;
  __ref_50.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_8 = document.createComment("component:start");
  const __ref_9 = document.createComment("component:end");
  refs[8] = __ref_8;
  refs[9] = __ref_9;
  __ref_50.append(__ref_8);
  __ref_50.append(__ref_9);
  const __props_10 = {"title": 'Audit', "subtitle": 'Payload-safe operational evidence across Work, policy, Attempts, Interactions, and Sessions.'};
  const __slots_10 = { default: { mountIntoBoundary: (start, end) => mountProjectedSlot_10_0(start, end, instance) } };
  refs[10] = PageHeader.mountIntoBoundary(__ref_8, __ref_9, __props_10, undefined, __slots_10);
  const __ref_49 = document.createElement("section");
  refs[49] = __ref_49;
  __ref_49.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_49.setAttribute("class", "panel");
  const __ref_15 = document.createElement("div");
  refs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_15.setAttribute("class", "section-head");
  const __ref_14 = document.createElement("div");
  refs[14] = __ref_14;
  __ref_14.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_11 = document.createElement("h2");
  refs[11] = __ref_11;
  __ref_11.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_11.append(document.createTextNode("Retained evidence"));
  __ref_14.append(__ref_11);
  const __ref_13 = document.createElement("div");
  refs[13] = __ref_13;
  __ref_13.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_13.setAttribute("class", "muted");
  const __ref_12 = document.createTextNode("");
  refs[12] = __ref_12;
  __ref_13.append(__ref_12);
  __ref_13.append(document.createTextNode(" entries loaded"));
  __ref_14.append(__ref_13);
  __ref_15.append(__ref_14);
  __ref_49.append(__ref_15);
  const __ref_48 = document.createElement("div");
  refs[48] = __ref_48;
  __ref_48.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_48.setAttribute("class", "timeline");
  const __ref_16 = document.createComment("for:start");
  const __ref_17 = document.createComment("for:end");
  refs[16] = __ref_16;
  refs[17] = __ref_17;
  refs[18] = [];
  __ref_48.append(__ref_16);
  __ref_48.append(__ref_17);
  const __ref_40 = document.createComment("if:start");
  const __ref_41 = document.createComment("if:end");
  refs[40] = __ref_40;
  refs[41] = __ref_41;
  refs[42] = undefined;
  __ref_48.append(__ref_40);
  __ref_48.append(__ref_41);
  const __ref_44 = document.createComment("if:start");
  const __ref_45 = document.createComment("if:end");
  refs[44] = __ref_44;
  refs[45] = __ref_45;
  refs[46] = undefined;
  __ref_48.append(__ref_44);
  __ref_48.append(__ref_45);
  __ref_49.append(__ref_48);
  __ref_50.append(__ref_49);
  fragment.append(__ref_50);
  return fragment;
}

function updateRegion_child_10(instance, scope, refs) {
  refs[10].setProps({"title": 'Audit', "subtitle": 'Payload-safe operational evidence across Work, policy, Attempts, Interactions, and Sessions.'});
  refs[10].setSlots({ default: { mountIntoBoundary: (start, end) => mountProjectedSlot_10_0(start, end, instance) } });
  refs[10].update();
}
function updateRegion_attribute_6_value(instance, scope, refs) {
  const __value_6_value = scope.props.category;
  const __next_6_value = __value_6_value ?? "";
  const __next_string_6_value = String(__next_6_value);
  if (refs[6].value !== __next_string_6_value) {
    refs[6].value = __next_string_6_value;
  }
  refs[6].setAttribute("value", __next_string_6_value);
}
function updateRegion_loop_1(instance, scope, refs) {
  updateForLoop_1(instance, scope);
}
function updateRegion_attribute_5_value(instance, scope, refs) {
  const __value_5_value = scope.option;
  const __next_5_value = __value_5_value ?? "";
  const __next_string_5_value = String(__next_5_value);
  if (refs[5].value !== __next_string_5_value) {
    refs[5].value = __next_string_5_value;
  }
  refs[5].setAttribute("value", __next_string_5_value);
}
function updateRegion_text_4(instance, scope, refs) {
  const __next_text_4 = String((scope.option) ?? "");
  if (refs[4].data !== __next_text_4) {
    refs[4].data = __next_text_4;
  }
}
function updateRegion_text_12(instance, scope, refs) {
  const __next_text_12 = String((scope.props.entries.length) ?? "");
  if (refs[12].data !== __next_text_12) {
    refs[12].data = __next_text_12;
  }
}
function updateRegion_loop_16(instance, scope, refs) {
  updateForLoop_16(instance, scope);
}
function updateRegion_text_19(instance, scope, refs) {
  const __next_text_19 = String((scope.entry.action) ?? "");
  if (refs[19].data !== __next_text_19) {
    refs[19].data = __next_text_19;
  }
}
function updateRegion_text_21(instance, scope, refs) {
  const __next_text_21 = String((scope.entry.category) ?? "");
  if (refs[21].data !== __next_text_21) {
    refs[21].data = __next_text_21;
  }
}
function updateRegion_text_24(instance, scope, refs) {
  const __next_text_24 = String((scope.entry.id) ?? "");
  if (refs[24].data !== __next_text_24) {
    refs[24].data = __next_text_24;
  }
}
function updateRegion_text_26(instance, scope, refs) {
  const __next_text_26 = String((scope.entry.correlationText) ?? "");
  if (refs[26].data !== __next_text_26) {
    refs[26].data = __next_text_26;
  }
}
function updateRegion_text_29(instance, scope, refs) {
  const __next_text_29 = String((scope.entry.outcome || '—') ?? "");
  if (refs[29].data !== __next_text_29) {
    refs[29].data = __next_text_29;
  }
}
function updateRegion_text_32(instance, scope, refs) {
  const __next_text_32 = String((scope.entry.reasonText) ?? "");
  if (refs[32].data !== __next_text_32) {
    refs[32].data = __next_text_32;
  }
}
function updateRegion_text_36(instance, scope, refs) {
  const __next_text_36 = String((scope.pretty(scope.entry)) ?? "");
  if (refs[36].data !== __next_text_36) {
    refs[36].data = __next_text_36;
  }
}
function updateRegion_conditional_40(instance, scope, refs) {
  updateConditional_40(instance, scope);
}
function updateRegion_conditional_44(instance, scope, refs) {
  updateConditional_44(instance, scope);
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_10(instance, scope, refs);
  updateRegion_text_12(instance, scope, refs);
  updateRegion_loop_16(instance, scope, refs);
  updateRegion_conditional_40(instance, scope, refs);
  updateRegion_conditional_44(instance, scope, refs);
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
  if (dirtySet.has("props") || dirtySet.has("categories") || dirtyRegionSet.has(1)) {
    updateRegion_child_10(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(2)) {
    updateRegion_text_12(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(3)) {
    updateRegion_loop_16(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(4)) {
    updateRegion_conditional_40(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(5)) {
    updateRegion_conditional_44(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[10] && typeof refs[10].destroy === "function") {
    refs[10].destroy();
  }
  const __records_18 = refs[18] ?? [];
  for (const record of __records_18) {
    if (record.handle && typeof record.handle.destroy === "function") {
      record.handle.destroy();
    } else if (typeof record.destroy === "function") {
      record.destroy();
    }
  }
  if (refs[42] === true) {
  } else {
  }
  if (refs[46] === true) {
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
