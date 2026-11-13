import * as PageHeader from "../components/PageHeader.mjs";
import * as Status from "../components/Status.mjs";
import { pretty as __weiv_import_pretty } from "../api.js";
import { short as __weiv_import_short } from "../api.js";

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
function createConditionalFragment_0(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_3 = document.createElement("button");
    refs[3] = __ref_3;
    __ref_3.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
    __ref_3.setAttribute("class", "primary");
    __ref_3.addEventListener("click", (event) => {
      const resolved = scope.session;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_3.append(document.createTextNode("\n        New Session\n      "));
    fragment.append(__ref_3);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_0(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_0(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.item.availability === 'available' && scope.props.item.kind === 'agent');
  if (refs[2] !== next) {
    const previous = refs[2];
    destroyConditionalBranch_0(instance, previous === true);
    refs[2] = next;
    replaceBetween(refs[0], refs[1], createConditionalFragment_0(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_4(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_7 = document.createElement("button");
    refs[7] = __ref_7;
    __ref_7.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
    __ref_7.addEventListener("click", (event) => {
      const resolved = scope.work;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_7.append(document.createTextNode("\n        Run once\n      "));
    fragment.append(__ref_7);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_4(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_4(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.item.availability === 'available' && scope.props.item.kind === 'agent');
  if (refs[6] !== next) {
    const previous = refs[6];
    destroyConditionalBranch_4(instance, previous === true);
    refs[6] = next;
    replaceBetween(refs[4], refs[5], createConditionalFragment_4(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_8(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_11 = document.createElement("button");
    refs[11] = __ref_11;
    __ref_11.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
    __ref_11.setAttribute("class", "primary");
    __ref_11.addEventListener("click", (event) => {
      const resolved = scope.work;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_11.append(document.createTextNode("\n        Start Work\n      "));
    fragment.append(__ref_11);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_8(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_8(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.item.availability === 'available' && scope.props.item.kind === 'workflow');
  if (refs[10] !== next) {
    const previous = refs[10];
    destroyConditionalBranch_8(instance, previous === true);
    refs[10] = next;
    replaceBetween(refs[8], refs[9], createConditionalFragment_8(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function mountProjectedSlot_14_0(start, end, ownerInstance) {
  const instance = { refs: [], refresh: () => ownerInstance.refresh(), update: () => ownerInstance.update() };
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  const __ref_0 = document.createComment("if:start");
  const __ref_1 = document.createComment("if:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  refs[2] = undefined;
  fragment.append(__ref_0);
  fragment.append(__ref_1);
  const __ref_4 = document.createComment("if:start");
  const __ref_5 = document.createComment("if:end");
  refs[4] = __ref_4;
  refs[5] = __ref_5;
  refs[6] = undefined;
  fragment.append(__ref_4);
  fragment.append(__ref_5);
  const __ref_8 = document.createComment("if:start");
  const __ref_9 = document.createComment("if:end");
  refs[8] = __ref_8;
  refs[9] = __ref_9;
  refs[10] = undefined;
  fragment.append(__ref_8);
  fragment.append(__ref_9);
  replaceBetween(start, end, fragment);
  function update() {
    const refs = instance.refs;
    const scope = instance.refresh();
    updateRegion_conditional_0(instance, scope, refs);
    updateRegion_conditional_4(instance, scope, refs);
    updateRegion_conditional_8(instance, scope, refs);
  }
  function destroy() {
    const refs = instance.refs;
    if (refs[2] === true) {
    } else {
    }
    if (refs[6] === true) {
    } else {
    }
    if (refs[10] === true) {
    } else {
    }
  }
  update();
  return { update, destroy, start, end };
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
  function session() {
  emit("new-session", props.item);
  }
  function work() {
  emit("start-work", props.item);
  }
  const pretty = __weiv_getTrackedRoot("pretty", __weiv_import_pretty);
  const short = __weiv_getTrackedRoot("short", __weiv_import_short);
  props = __weiv_getTrackedRoot("props", props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.pretty = pretty;
    __weiv_scope.short = short;
    __weiv_scope.props = props;
    __weiv_scope.session = session;
    __weiv_scope.work = work;
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
    __weiv_register(short);
    return () => {
      for (const __weiv_unsubscribe of __weiv_unsubscribes) {
        __weiv_unsubscribe();
      }
    };
  }
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, setBoundaryRunner: __weiv_setBoundaryRunner, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "w41EDDF3026834A25";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.item", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.item.id", parentPathId: 2 }, { pathId: 4, rootId: 1, path: "props.item.subtitle", parentPathId: 2 }, { pathId: 5, rootId: 1, path: "props.item.availability", parentPathId: 2 }, { pathId: 6, rootId: 1, path: "props.item.kind", parentPathId: 2 }, { pathId: 7, rootId: 1, path: "props.item.revision", parentPathId: 2 }, { pathId: 8, rootId: 1, path: "props.item.input", parentPathId: 2 }, { pathId: 9, rootId: 1, path: "props.item.objective", parentPathId: 2 }, { pathId: 10, rootId: 1, path: "props.item.output", parentPathId: 2 }, { pathId: 11, rootId: 1, path: "props.item.result", parentPathId: 2 }], regions: [{ regionId: 1, trackedPathIds: [3, 4] }, { regionId: 2, trackedPathIds: [5] }, { regionId: 3, trackedPathIds: [6] }, { regionId: 4, trackedPathIds: [7] }, { regionId: 5, trackedPathIds: [2] }, { regionId: 6, trackedPathIds: [6] }, { regionId: 7, trackedPathIds: [6, 8, 9] }, { regionId: 8, trackedPathIds: [6] }, { regionId: 9, trackedPathIds: [6, 10, 11] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_47 = document.createElement("div");
  refs[47] = __ref_47;
  __ref_47.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_12 = document.createComment("component:start");
  const __ref_13 = document.createComment("component:end");
  refs[12] = __ref_12;
  refs[13] = __ref_13;
  __ref_47.append(__ref_12);
  __ref_47.append(__ref_13);
  const __props_14 = {"title": instance.refresh().props.item.id, "subtitle": instance.refresh().props.item.subtitle};
  const __slots_14 = { default: { mountIntoBoundary: (start, end) => mountProjectedSlot_14_0(start, end, instance) } };
  refs[14] = PageHeader.mountIntoBoundary(__ref_12, __ref_13, __props_14, undefined, __slots_14);
  const __ref_46 = document.createElement("div");
  refs[46] = __ref_46;
  __ref_46.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_46.setAttribute("class", "split");
  const __ref_34 = document.createElement("div");
  refs[34] = __ref_34;
  __ref_34.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_34.setAttribute("class", "stack");
  const __ref_33 = document.createElement("section");
  refs[33] = __ref_33;
  __ref_33.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_33.setAttribute("class", "panel");
  const __ref_19 = document.createElement("div");
  refs[19] = __ref_19;
  __ref_19.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_19.setAttribute("class", "section-head");
  const __ref_15 = document.createElement("h2");
  refs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_15.append(document.createTextNode("Overview"));
  __ref_19.append(__ref_15);
  const __ref_16 = document.createComment("component:start");
  const __ref_17 = document.createComment("component:end");
  refs[16] = __ref_16;
  refs[17] = __ref_17;
  __ref_19.append(__ref_16);
  __ref_19.append(__ref_17);
  const __props_18 = {"value": instance.refresh().props.item.availability};
  refs[18] = Status.mountIntoBoundary(__ref_16, __ref_17, __props_18, undefined, undefined);
  __ref_33.append(__ref_19);
  const __ref_28 = document.createElement("div");
  refs[28] = __ref_28;
  __ref_28.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_28.setAttribute("class", "fact-list");
  const __ref_23 = document.createElement("div");
  refs[23] = __ref_23;
  __ref_23.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_23.setAttribute("class", "fact");
  const __ref_20 = document.createElement("span");
  refs[20] = __ref_20;
  __ref_20.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_20.setAttribute("class", "label");
  __ref_20.append(document.createTextNode("Type"));
  __ref_23.append(__ref_20);
  const __ref_22 = document.createElement("span");
  refs[22] = __ref_22;
  __ref_22.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_21 = document.createTextNode("");
  refs[21] = __ref_21;
  __ref_22.append(__ref_21);
  __ref_23.append(__ref_22);
  __ref_28.append(__ref_23);
  const __ref_27 = document.createElement("div");
  refs[27] = __ref_27;
  __ref_27.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_27.setAttribute("class", "fact");
  const __ref_24 = document.createElement("span");
  refs[24] = __ref_24;
  __ref_24.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_24.setAttribute("class", "label");
  __ref_24.append(document.createTextNode("Revision"));
  __ref_27.append(__ref_24);
  const __ref_26 = document.createElement("span");
  refs[26] = __ref_26;
  __ref_26.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_26.setAttribute("class", "mono");
  const __ref_25 = document.createTextNode("");
  refs[25] = __ref_25;
  __ref_26.append(__ref_25);
  __ref_27.append(__ref_26);
  __ref_28.append(__ref_27);
  __ref_33.append(__ref_28);
  const __ref_32 = document.createElement("details");
  refs[32] = __ref_32;
  __ref_32.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_32.setAttribute("class", "json-details");
  const __ref_29 = document.createElement("summary");
  refs[29] = __ref_29;
  __ref_29.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_29.append(document.createTextNode("View full configuration"));
  __ref_32.append(__ref_29);
  const __ref_31 = document.createElement("pre");
  refs[31] = __ref_31;
  __ref_31.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_30 = document.createTextNode("");
  refs[30] = __ref_30;
  __ref_31.append(__ref_30);
  __ref_32.append(__ref_31);
  __ref_33.append(__ref_32);
  __ref_34.append(__ref_33);
  __ref_46.append(__ref_34);
  const __ref_45 = document.createElement("aside");
  refs[45] = __ref_45;
  __ref_45.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_45.setAttribute("class", "stack");
  const __ref_44 = document.createElement("section");
  refs[44] = __ref_44;
  __ref_44.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_44.setAttribute("class", "panel");
  const __ref_35 = document.createElement("h2");
  refs[35] = __ref_35;
  __ref_35.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_35.append(document.createTextNode("Contracts"));
  __ref_44.append(__ref_35);
  const __ref_37 = document.createElement("h3");
  refs[37] = __ref_37;
  __ref_37.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_36 = document.createTextNode("");
  refs[36] = __ref_36;
  __ref_37.append(__ref_36);
  __ref_44.append(__ref_37);
  const __ref_39 = document.createElement("pre");
  refs[39] = __ref_39;
  __ref_39.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_38 = document.createTextNode("");
  refs[38] = __ref_38;
  __ref_39.append(__ref_38);
  __ref_44.append(__ref_39);
  const __ref_41 = document.createElement("h3");
  refs[41] = __ref_41;
  __ref_41.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_40 = document.createTextNode("");
  refs[40] = __ref_40;
  __ref_41.append(__ref_40);
  __ref_44.append(__ref_41);
  const __ref_43 = document.createElement("pre");
  refs[43] = __ref_43;
  __ref_43.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_42 = document.createTextNode("");
  refs[42] = __ref_42;
  __ref_43.append(__ref_42);
  __ref_44.append(__ref_43);
  __ref_45.append(__ref_44);
  __ref_46.append(__ref_45);
  __ref_47.append(__ref_46);
  fragment.append(__ref_47);
  return fragment;
}

function updateRegion_child_14(instance, scope, refs) {
  refs[14].setProps({"title": scope.props.item.id, "subtitle": scope.props.item.subtitle});
  refs[14].setSlots({ default: { mountIntoBoundary: (start, end) => mountProjectedSlot_14_0(start, end, instance) } });
  refs[14].update();
}
function updateRegion_conditional_0(instance, scope, refs) {
  updateConditional_0(instance, scope);
}
function updateRegion_conditional_4(instance, scope, refs) {
  updateConditional_4(instance, scope);
}
function updateRegion_conditional_8(instance, scope, refs) {
  updateConditional_8(instance, scope);
}
function updateRegion_child_18(instance, scope, refs) {
  refs[18].setProps({"value": scope.props.item.availability});
  refs[18].update();
}
function updateRegion_text_21(instance, scope, refs) {
  const __next_text_21 = String((scope.props.item.kind) ?? "");
  if (refs[21].data !== __next_text_21) {
    refs[21].data = __next_text_21;
  }
}
function updateRegion_text_25(instance, scope, refs) {
  const __next_text_25 = String((scope.props.item.revision) ?? "");
  if (refs[25].data !== __next_text_25) {
    refs[25].data = __next_text_25;
  }
}
function updateRegion_text_30(instance, scope, refs) {
  const __next_text_30 = String((scope.pretty(scope.props.item)) ?? "");
  if (refs[30].data !== __next_text_30) {
    refs[30].data = __next_text_30;
  }
}
function updateRegion_text_36(instance, scope, refs) {
  const __next_text_36 = String((scope.props.item.kind === 'tool' ? 'Input' : 'Objective') ?? "");
  if (refs[36].data !== __next_text_36) {
    refs[36].data = __next_text_36;
  }
}
function updateRegion_text_38(instance, scope, refs) {
  const __next_text_38 = String((scope.pretty(scope.props.item.kind === 'tool' ? scope.props.item.input : scope.props.item.objective)) ?? "");
  if (refs[38].data !== __next_text_38) {
    refs[38].data = __next_text_38;
  }
}
function updateRegion_text_40(instance, scope, refs) {
  const __next_text_40 = String((scope.props.item.kind === 'tool' ? 'Output' : 'Result') ?? "");
  if (refs[40].data !== __next_text_40) {
    refs[40].data = __next_text_40;
  }
}
function updateRegion_text_42(instance, scope, refs) {
  const __next_text_42 = String((scope.pretty(scope.props.item.kind === 'tool' ? scope.props.item.output : scope.props.item.result)) ?? "");
  if (refs[42].data !== __next_text_42) {
    refs[42].data = __next_text_42;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_14(instance, scope, refs);
  updateRegion_child_18(instance, scope, refs);
  updateRegion_text_21(instance, scope, refs);
  updateRegion_text_25(instance, scope, refs);
  updateRegion_text_30(instance, scope, refs);
  updateRegion_text_36(instance, scope, refs);
  updateRegion_text_38(instance, scope, refs);
  updateRegion_text_40(instance, scope, refs);
  updateRegion_text_42(instance, scope, refs);
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
  if (dirtySet.has("props") || dirtyRegionSet.has(1)) {
    updateRegion_child_14(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(2)) {
    updateRegion_child_18(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(3)) {
    updateRegion_text_21(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(4)) {
    updateRegion_text_25(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(5)) {
    updateRegion_text_30(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(6)) {
    updateRegion_text_36(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(7)) {
    updateRegion_text_38(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(8)) {
    updateRegion_text_40(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(9)) {
    updateRegion_text_42(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[14] && typeof refs[14].destroy === "function") {
    refs[14].destroy();
  }
  if (refs[18] && typeof refs[18].destroy === "function") {
    refs[18].destroy();
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
