import * as Sidebar from "./components/Sidebar.mjs";
import * as InputDialog from "./components/InputDialog.mjs";
import * as Definitions from "./views/Definitions.mjs";
import * as Definition from "./views/Definition.mjs";
import * as Sessions from "./views/Sessions.mjs";
import * as Session from "./views/Session.mjs";
import * as Works from "./views/Works.mjs";
import * as Work from "./views/Work.mjs";
import * as Audit from "./views/Audit.mjs";
import { api as __weiv_import_api } from "./api.js";
import { pretty as __weiv_import_pretty } from "./api.js";
import { short as __weiv_import_short } from "./api.js";
import { terminal as __weiv_import_terminal } from "./api.js";
import { watch as __weiv_import_watch } from "./api.js";

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
    const __ref_7 = document.createElement("div");
    refs[7] = __ref_7;
    __ref_7.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    __ref_7.setAttribute("class", "error");
    __ref_7.setAttribute("role", "alert");
    const __ref_6 = document.createTextNode("");
    refs[6] = __ref_6;
    __ref_7.append(__ref_6);
    fragment.append(__ref_7);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_3(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_3(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.error);
  if (refs[5] !== next) {
    const previous = refs[5];
    destroyConditionalBranch_3(instance, previous === true);
    refs[5] = next;
    replaceBetween(refs[3], refs[4], createConditionalFragment_3(instance, scope, next));
  }
  if (next) {
    updateRegion_text_6(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_8(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_11 = document.createElement("div");
    refs[11] = __ref_11;
    __ref_11.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    __ref_11.setAttribute("class", "empty");
    __ref_11.append(document.createTextNode("Loading Workbench…"));
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
  const next = Boolean(scope.loading);
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

function createConditionalFragment_12(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_18 = document.createElement("div");
    refs[18] = __ref_18;
    __ref_18.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_15 = document.createComment("component:start");
    const __ref_16 = document.createComment("component:end");
    refs[15] = __ref_15;
    refs[16] = __ref_16;
    __ref_18.append(__ref_15);
    __ref_18.append(__ref_16);
    const __props_17 = {"items": scope.data, "history": scope.showHistory};
    const __handlers_17 = {"toggle-history": (payload) => { const resolved = scope.toggleHistory; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }};
    refs[17] = Definitions.mountIntoBoundary(__ref_15, __ref_16, __props_17, __handlers_17, undefined);
    fragment.append(__ref_18);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_12(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[17] && typeof refs[17].destroy === "function") {
      refs[17].destroy();
    }
  } else {
  }
}

function updateConditional_12(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.loading && scope.view === 'definitions');
  if (refs[14] !== next) {
    const previous = refs[14];
    destroyConditionalBranch_12(instance, previous === true);
    refs[14] = next;
    replaceBetween(refs[12], refs[13], createConditionalFragment_12(instance, scope, next));
  }
  if (next) {
    updateRegion_child_17(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_19(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_25 = document.createElement("div");
    refs[25] = __ref_25;
    __ref_25.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_22 = document.createComment("component:start");
    const __ref_23 = document.createComment("component:end");
    refs[22] = __ref_22;
    refs[23] = __ref_23;
    __ref_25.append(__ref_22);
    __ref_25.append(__ref_23);
    const __props_24 = {"item": scope.data};
    const __handlers_24 = {"new-session": (payload) => { const resolved = scope.newSession; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "start-work": (payload) => { const resolved = scope.startWork; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }};
    refs[24] = Definition.mountIntoBoundary(__ref_22, __ref_23, __props_24, __handlers_24, undefined);
    fragment.append(__ref_25);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_19(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[24] && typeof refs[24].destroy === "function") {
      refs[24].destroy();
    }
  } else {
  }
}

function updateConditional_19(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.loading && scope.view === 'definition');
  if (refs[21] !== next) {
    const previous = refs[21];
    destroyConditionalBranch_19(instance, previous === true);
    refs[21] = next;
    replaceBetween(refs[19], refs[20], createConditionalFragment_19(instance, scope, next));
  }
  if (next) {
    updateRegion_child_24(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_26(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_32 = document.createElement("div");
    refs[32] = __ref_32;
    __ref_32.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_29 = document.createComment("component:start");
    const __ref_30 = document.createComment("component:end");
    refs[29] = __ref_29;
    refs[30] = __ref_30;
    __ref_32.append(__ref_29);
    __ref_32.append(__ref_30);
    const __props_31 = {"items": scope.data};
    refs[31] = Sessions.mountIntoBoundary(__ref_29, __ref_30, __props_31, undefined, undefined);
    fragment.append(__ref_32);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_26(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[31] && typeof refs[31].destroy === "function") {
      refs[31].destroy();
    }
  } else {
  }
}

function updateConditional_26(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.loading && scope.view === 'sessions');
  if (refs[28] !== next) {
    const previous = refs[28];
    destroyConditionalBranch_26(instance, previous === true);
    refs[28] = next;
    replaceBetween(refs[26], refs[27], createConditionalFragment_26(instance, scope, next));
  }
  if (next) {
    updateRegion_child_31(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_33(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_39 = document.createElement("div");
    refs[39] = __ref_39;
    __ref_39.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_36 = document.createComment("component:start");
    const __ref_37 = document.createComment("component:end");
    refs[36] = __ref_36;
    refs[37] = __ref_37;
    __ref_39.append(__ref_36);
    __ref_39.append(__ref_37);
    const __props_38 = {"item": scope.data};
    const __handlers_38 = {"send": (payload) => { const resolved = scope.sendMessage; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "close": (payload) => { const resolved = scope.closeSession; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "respond": (payload) => { const resolved = scope.respond; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "question": (payload) => { const resolved = scope.question; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }};
    refs[38] = Session.mountIntoBoundary(__ref_36, __ref_37, __props_38, __handlers_38, undefined);
    fragment.append(__ref_39);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_33(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[38] && typeof refs[38].destroy === "function") {
      refs[38].destroy();
    }
  } else {
  }
}

function updateConditional_33(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.loading && scope.view === 'session');
  if (refs[35] !== next) {
    const previous = refs[35];
    destroyConditionalBranch_33(instance, previous === true);
    refs[35] = next;
    replaceBetween(refs[33], refs[34], createConditionalFragment_33(instance, scope, next));
  }
  if (next) {
    updateRegion_child_38(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_40(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_46 = document.createElement("div");
    refs[46] = __ref_46;
    __ref_46.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_43 = document.createComment("component:start");
    const __ref_44 = document.createComment("component:end");
    refs[43] = __ref_43;
    refs[44] = __ref_44;
    __ref_46.append(__ref_43);
    __ref_46.append(__ref_44);
    const __props_45 = {"items": scope.data};
    refs[45] = Works.mountIntoBoundary(__ref_43, __ref_44, __props_45, undefined, undefined);
    fragment.append(__ref_46);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_40(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[45] && typeof refs[45].destroy === "function") {
      refs[45].destroy();
    }
  } else {
  }
}

function updateConditional_40(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.loading && scope.view === 'works');
  if (refs[42] !== next) {
    const previous = refs[42];
    destroyConditionalBranch_40(instance, previous === true);
    refs[42] = next;
    replaceBetween(refs[40], refs[41], createConditionalFragment_40(instance, scope, next));
  }
  if (next) {
    updateRegion_child_45(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_47(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_53 = document.createElement("div");
    refs[53] = __ref_53;
    __ref_53.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_50 = document.createComment("component:start");
    const __ref_51 = document.createComment("component:end");
    refs[50] = __ref_50;
    refs[51] = __ref_51;
    __ref_53.append(__ref_50);
    __ref_53.append(__ref_51);
    const __props_52 = {"item": scope.data, "entries": scope.inspection, "detail": scope.detail, "next": scope.inspectionNext, "preview": scope.preview};
    const __handlers_52 = {"cancel": (payload) => { const resolved = scope.cancelWork; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "detail": (payload) => { const resolved = scope.changeDetail; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "more": (payload) => { const resolved = scope.moreInspection; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "respond": (payload) => { const resolved = scope.respond; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "question": (payload) => { const resolved = scope.question; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }};
    refs[52] = Work.mountIntoBoundary(__ref_50, __ref_51, __props_52, __handlers_52, undefined);
    fragment.append(__ref_53);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_47(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[52] && typeof refs[52].destroy === "function") {
      refs[52].destroy();
    }
  } else {
  }
}

function updateConditional_47(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.loading && scope.view === 'work');
  if (refs[49] !== next) {
    const previous = refs[49];
    destroyConditionalBranch_47(instance, previous === true);
    refs[49] = next;
    replaceBetween(refs[47], refs[48], createConditionalFragment_47(instance, scope, next));
  }
  if (next) {
    updateRegion_child_52(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_54(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_60 = document.createElement("div");
    refs[60] = __ref_60;
    __ref_60.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_57 = document.createComment("component:start");
    const __ref_58 = document.createComment("component:end");
    refs[57] = __ref_57;
    refs[58] = __ref_58;
    __ref_60.append(__ref_57);
    __ref_60.append(__ref_58);
    const __props_59 = {"entries": scope.data, "category": scope.category, "next": scope.auditNext};
    const __handlers_59 = {"category": (payload) => { const resolved = scope.changeCategory; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "more": (payload) => { const resolved = scope.moreAudit; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }};
    refs[59] = Audit.mountIntoBoundary(__ref_57, __ref_58, __props_59, __handlers_59, undefined);
    fragment.append(__ref_60);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_54(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[59] && typeof refs[59].destroy === "function") {
      refs[59].destroy();
    }
  } else {
  }
}

function updateConditional_54(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.loading && scope.view === 'audit');
  if (refs[56] !== next) {
    const previous = refs[56];
    destroyConditionalBranch_54(instance, previous === true);
    refs[56] = next;
    replaceBetween(refs[54], refs[55], createConditionalFragment_54(instance, scope, next));
  }
  if (next) {
    updateRegion_child_59(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_61(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_67 = document.createElement("div");
    refs[67] = __ref_67;
    __ref_67.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_64 = document.createElement("h1");
    refs[64] = __ref_64;
    __ref_64.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    __ref_64.append(document.createTextNode("Not found"));
    __ref_67.append(__ref_64);
    const __ref_66 = document.createElement("p");
    refs[66] = __ref_66;
    __ref_66.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_65 = document.createTextNode("");
    refs[65] = __ref_65;
    __ref_66.append(__ref_65);
    __ref_67.append(__ref_66);
    fragment.append(__ref_67);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_61(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_61(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.loading && scope.view === 'missing');
  if (refs[63] !== next) {
    const previous = refs[63];
    destroyConditionalBranch_61(instance, previous === true);
    refs[63] = next;
    replaceBetween(refs[61], refs[62], createConditionalFragment_61(instance, scope, next));
  }
  if (next) {
    updateRegion_text_65(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_69(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_75 = document.createElement("div");
    refs[75] = __ref_75;
    __ref_75.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_72 = document.createComment("component:start");
    const __ref_73 = document.createComment("component:end");
    refs[72] = __ref_72;
    refs[73] = __ref_73;
    __ref_75.append(__ref_72);
    __ref_75.append(__ref_73);
    const __props_74 = {"open": scope.inputOpen, "title": scope.inputTitle, "help": scope.inputHelp, "initial": scope.inputInitial, "fields": scope.inputFields};
    const __handlers_74 = {"cancel": (payload) => { const resolved = scope.dismissInput; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "submit": (payload) => { const resolved = scope.submitInput; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }};
    refs[74] = InputDialog.mountIntoBoundary(__ref_72, __ref_73, __props_74, __handlers_74, undefined);
    fragment.append(__ref_75);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_69(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[74] && typeof refs[74].destroy === "function") {
      refs[74].destroy();
    }
  } else {
  }
}

function updateConditional_69(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.inputOpen);
  if (refs[71] !== next) {
    const previous = refs[71];
    destroyConditionalBranch_69(instance, previous === true);
    refs[71] = next;
    replaceBetween(refs[69], refs[70], createConditionalFragment_69(instance, scope, next));
  }
  if (next) {
    updateRegion_child_74(instance, scope, refs);
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
  let missingPath = "";
  let active = "definitions";
  let view = "";
  let data = null;
  let loading = true;
  let error = "";
  let connected = true;
  let connectionNote = "public App API";
  let source = null;
  let showHistory = false;
  let inspection = [];
  let detail = "story";
  let inspectionNext = "";
  let preview = "";
  let auditNext = "";
  let category = "";
  let inputOpen = false;
  let inputTitle = "";
  let inputHelp = "";
  let inputInitial = "null";
  let inputFields = [];
  let inputSchema = null;
  let inputSubmit = null;
  function prepareSession(value) {
  return {
  ...value,
  recentMessages: (value.recentMessages || []).map((message) => ({
  ...message,
  workUrl: message.workId ? "/work/" + encodeURIComponent(message.workId) : ""
  }))
  };
  }
  function prepareWork(value) {
  return {
  ...value,
  subtitle: value.definition.id + " · " + short(value.id)
  };
  }
  function parts() {
  return location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  }
  function navigate(path) {
  history.pushState({}, "", path);
  return load();
  }
  function closeWatch() {
  source?.close();
  source = null;
  }
  function showError(cause) {
  error = (cause?.code ? cause.code + " · " : "") + (cause?.message || String(cause));
  }
  function schemaValue(schema) {
  if (schema?.default !== undefined) return schema.default;
  if (schema?.type === "object") return Object.fromEntries(Object.entries(schema.properties || {}).map(([name, child]) => [name, schemaValue(child)]));
  if (schema?.type === "array") return [];
  if (schema?.type === "boolean") return false;
  if (schema?.type === "number" || schema?.type === "integer") return 0;
  return "";
  }
  function fieldsFor(schema, value, path = "") {
  if (schema?.type === "object") return Object.entries(schema.properties || {}).flatMap(([name, child]) => fieldsFor(child, value?.[name], path ? path + "." + name : name));
  return [{
  label: path || "Value",
  path,
  type: schema?.type || "string",
  value: schema?.type === "array" || schema?.type === "object" ? pretty(value) : String(value ?? "")
  }];
  }
  function openInput(title, schema, help, submit) {
  const value = schemaValue(schema);
  inputTitle = title;
  inputHelp = help;
  inputSchema = schema;
  inputInitial = pretty(value);
  inputFields = fieldsFor(schema, value);
  inputSubmit = submit;
  inputOpen = true;
  }
  function dismissInput() {
  inputOpen = false;
  }
  async function submitInput(value) {
  try {
  await inputSubmit?.(value);
  inputOpen = false;
  } catch (cause) {
  showError(cause);
  }
  }
  function newSession(item) {
  openInput("New Session", {
  type: "string",
  default: item.id
  }, "Choose a title for this Agent Session.", async (title) => {
  const session = await api("/sessions", {
  method: "POST",
  body: JSON.stringify({
  agent: {
  object: item.object,
  kind: item.kind,
  id: item.id,
  revision: item.revision
  },
  title
  })
  });
  return navigate("/sessions/" + encodeURIComponent(session.id));
  });
  }
  function startWork(item) {
  openInput("Start " + item.id, item.objective, "The server validates this value against the Definition contract.", async (objective) => {
  const work = await api("/works", {
  method: "POST",
  body: JSON.stringify({
  definition: {
  object: item.object,
  kind: item.kind,
  id: item.id,
  revision: item.revision
  },
  objective
  })
  });
  return navigate("/work/" + encodeURIComponent(work.id));
  });
  }
  function question(value) {
  openInput("Reply to question", value.item.response, value.item.prompt, async (response) => respond({
  ...value,
  id: value.item.id,
  response
  }));
  }
  async function respond(value) {
  try {
  await api("/works/" + encodeURIComponent(value.work) + "/interactions/" + encodeURIComponent(value.id) + "/response", {
  method: "POST",
  body: JSON.stringify({ response: value.response })
  });
  } catch (cause) {
  showError(cause);
  }
  }
  async function sendMessage(value) {
  try {
  await api("/sessions/" + encodeURIComponent(value.id) + "/messages", {
  method: "POST",
  body: JSON.stringify({
  content: value.content,
  delivery: value.delivery
  })
  });
  } catch (cause) {
  showError(cause);
  }
  }
  async function closeSession(id) {
  try {
  await api("/sessions/" + encodeURIComponent(id) + "/close", {
  method: "POST",
  body: "{}"
  });
  await load();
  } catch (cause) {
  showError(cause);
  }
  }
  async function cancelWork(id) {
  try {
  await api("/works/" + encodeURIComponent(id) + "/cancel", {
  method: "POST",
  body: JSON.stringify({ reason: "Canceled from Workbench" })
  });
  } catch (cause) {
  showError(cause);
  }
  }
  async function loadInspection(after = "") {
  if (view !== "work") return;
  try {
  const page = await api("/works/" + encodeURIComponent(data.id) + "/inspection?detail=" + detail + "&limit=100" + (after ? "&after=" + encodeURIComponent(after) : ""));
  inspection = after ? [...inspection, ...page.entries] : page.entries;
  inspectionNext = page.hasMore ? page.next || "" : "";
  } catch (cause) {
  showError(cause);
  }
  }
  function changeDetail(value) {
  detail = value;
  return loadInspection();
  }
  function moreInspection(after) {
  return loadInspection(after);
  }
  async function loadAudit(after = "") {
  const query = "limit=50" + (category ? "&category=" + encodeURIComponent(category) : "") + (after ? "&after=" + encodeURIComponent(after) : "");
  const page = await api("/audit?" + query);
  const entries = page.entries.map((entry) => ({
  ...entry,
  correlationText: Object.entries(entry.correlation || {}).map(([name, value]) => name + " · " + value).join(" · "),
  reasonText: entry.reason ? entry.reason.code + " · " + entry.reason.message : "—"
  }));
  data = after ? [...data, ...entries] : entries;
  auditNext = page.next || "";
  }
  function changeCategory(value) {
  return navigate("/audit" + (value ? "?category=" + encodeURIComponent(value) : ""));
  }
  async function moreAudit(after) {
  try {
  await loadAudit(after);
  } catch (cause) {
  showError(cause);
  }
  }
  function toggleHistory() {
  return navigate(showHistory ? "/definitions" : "/definitions?history=1");
  }
  async function load() {
  closeWatch();
  error = "";
  loading = true;
  preview = "";
  inspection = [];
  inspectionNext = "";
  const route = parts();
  try {
  if (!route.length) {
  await navigate("/definitions");
  return;
  }
  active = route[0] === "definitions" ? "definitions" : route[0] === "sessions" ? "sessions" : route[0] === "audit" ? "audit" : "work";
  if (route[0] === "definitions" && route.length === 1) {
  view = "definitions";
  showHistory = new URLSearchParams(location.search).get("history") === "1";
  data = (await api("/definitions?" + (showHistory ? "" : "availability=available&") + "limit=100")).definitions;
  } else if (route[0] === "definitions" && route.length === 4) {
  view = "definition";
  const definition = await api("/definitions/" + route.slice(1).map(encodeURIComponent).join("/"));
  data = {
  ...definition,
  subtitle: definition.kind + " · " + short(definition.revision)
  };
  } else if (route[0] === "sessions" && route.length === 1) {
  view = "sessions";
  data = (await api("/sessions?limit=100")).sessions.map((item) => ({
  ...item,
  url: "/sessions/" + encodeURIComponent(item.id)
  }));
  } else if (route[0] === "sessions" && route.length === 2) {
  view = "session";
  data = prepareSession(await api("/sessions/" + encodeURIComponent(route[1])));
  source = watch("sessions", route[1], (value) => queueMicrotask(() => {
  data = prepareSession(value);
  connected = true;
  connectionNote = "Live updates";
  }), () => queueMicrotask(() => {
  connected = false;
  connectionNote = "Last durable state shown";
  }));
  } else if (route[0] === "work" && route.length === 1) {
  view = "works";
  data = (await api("/works?limit=100")).works.map((item) => ({
  ...item,
  url: "/work/" + encodeURIComponent(item.id)
  }));
  } else if (route[0] === "work" && route.length === 2) {
  view = "work";
  data = prepareWork(await api("/works/" + encodeURIComponent(route[1])));
  detail = "story";
  await loadInspection();
  if (!terminal.has(data.status)) {
  source = watch("works", route[1], (value) => queueMicrotask(() => {
  data = prepareWork(value);
  connected = true;
  connectionNote = "Live updates";
  if (terminal.has(value.status)) {
  preview = "";
  closeWatch();
  }
  }), () => queueMicrotask(() => {
  connected = false;
  connectionNote = "Last durable state shown";
  }));
  source.addEventListener("model.delta", (event) => {
  const delta = JSON.parse(event.data);
  if (delta.item?.type === "text" && delta.workId === data.id) queueMicrotask(() => {
  preview = (preview + delta.item.text).slice(-131072);
  });
  });
  } else connectionNote = "Durable terminal state";
  } else if (route[0] === "audit" && route.length === 1) {
  view = "audit";
  category = new URLSearchParams(location.search).get("category") || "";
  data = [];
  await loadAudit();
  } else {
  view = "missing";
  missingPath = location.pathname;
  data = null;
  }
  } catch (cause) {
  showError(cause);
  view = "missing";
  } finally {
  loading = false;
  }
  }
  document.addEventListener("click", (event) => {
  const anchor = event.target.closest?.("a[href^=\"/\"]");
  if (anchor && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
  event.preventDefault();
  queueMicrotask(() => navigate(anchor.pathname + anchor.search));
  }
  });
  addEventListener("popstate", () => queueMicrotask(() => load()));
  queueMicrotask(() => load());
  const api = __weiv_getTrackedRoot("api", __weiv_import_api);
  const pretty = __weiv_getTrackedRoot("pretty", __weiv_import_pretty);
  const short = __weiv_getTrackedRoot("short", __weiv_import_short);
  const terminal = __weiv_getTrackedRoot("terminal", __weiv_import_terminal);
  const watch = __weiv_getTrackedRoot("watch", __weiv_import_watch);
  props = __weiv_getTrackedRoot("props", props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.api = api;
    __weiv_scope.pretty = pretty;
    __weiv_scope.short = short;
    __weiv_scope.terminal = terminal;
    __weiv_scope.watch = watch;
    __weiv_scope.props = props;
    __weiv_scope.missingPath = missingPath;
    __weiv_scope.active = active;
    __weiv_scope.view = view;
    __weiv_scope.data = data;
    __weiv_scope.loading = loading;
    __weiv_scope.error = error;
    __weiv_scope.connected = connected;
    __weiv_scope.connectionNote = connectionNote;
    __weiv_scope.source = source;
    __weiv_scope.showHistory = showHistory;
    __weiv_scope.inspection = inspection;
    __weiv_scope.detail = detail;
    __weiv_scope.inspectionNext = inspectionNext;
    __weiv_scope.preview = preview;
    __weiv_scope.auditNext = auditNext;
    __weiv_scope.category = category;
    __weiv_scope.inputOpen = inputOpen;
    __weiv_scope.inputTitle = inputTitle;
    __weiv_scope.inputHelp = inputHelp;
    __weiv_scope.inputInitial = inputInitial;
    __weiv_scope.inputFields = inputFields;
    __weiv_scope.inputSchema = inputSchema;
    __weiv_scope.inputSubmit = inputSubmit;
    __weiv_scope.prepareSession = prepareSession;
    __weiv_scope.prepareWork = prepareWork;
    __weiv_scope.parts = parts;
    __weiv_scope.navigate = navigate;
    __weiv_scope.closeWatch = closeWatch;
    __weiv_scope.showError = showError;
    __weiv_scope.schemaValue = schemaValue;
    __weiv_scope.fieldsFor = fieldsFor;
    __weiv_scope.openInput = openInput;
    __weiv_scope.dismissInput = dismissInput;
    __weiv_scope.submitInput = submitInput;
    __weiv_scope.newSession = newSession;
    __weiv_scope.startWork = startWork;
    __weiv_scope.question = question;
    __weiv_scope.respond = respond;
    __weiv_scope.sendMessage = sendMessage;
    __weiv_scope.closeSession = closeSession;
    __weiv_scope.cancelWork = cancelWork;
    __weiv_scope.loadInspection = loadInspection;
    __weiv_scope.changeDetail = changeDetail;
    __weiv_scope.moreInspection = moreInspection;
    __weiv_scope.loadAudit = loadAudit;
    __weiv_scope.changeCategory = changeCategory;
    __weiv_scope.moreAudit = moreAudit;
    __weiv_scope.toggleHistory = toggleHistory;
    __weiv_scope.load = load;
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
    __weiv_register(api);
    __weiv_register(pretty);
    __weiv_register(short);
    __weiv_register(terminal);
    __weiv_register(watch);
    return () => {
      for (const __weiv_unsubscribe of __weiv_unsubscribes) {
        __weiv_unsubscribe();
      }
    };
  }
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, setBoundaryRunner: __weiv_setBoundaryRunner, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "w52BC126DEC420AC0";
export const css = "";

export const trackedStateGraph = { roots: [], paths: [], regions: [] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_76 = document.createElement("div");
  refs[76] = __ref_76;
  __ref_76.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
  __ref_76.setAttribute("class", "shell");
  const __ref_0 = document.createComment("component:start");
  const __ref_1 = document.createComment("component:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  __ref_76.append(__ref_0);
  __ref_76.append(__ref_1);
  const __props_2 = {"active": instance.refresh().active, "connected": instance.refresh().connected, "note": instance.refresh().connectionNote};
  refs[2] = Sidebar.mountIntoBoundary(__ref_0, __ref_1, __props_2, undefined, undefined);
  const __ref_68 = document.createElement("main");
  refs[68] = __ref_68;
  __ref_68.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
  const __ref_3 = document.createComment("if:start");
  const __ref_4 = document.createComment("if:end");
  refs[3] = __ref_3;
  refs[4] = __ref_4;
  refs[5] = undefined;
  __ref_68.append(__ref_3);
  __ref_68.append(__ref_4);
  const __ref_8 = document.createComment("if:start");
  const __ref_9 = document.createComment("if:end");
  refs[8] = __ref_8;
  refs[9] = __ref_9;
  refs[10] = undefined;
  __ref_68.append(__ref_8);
  __ref_68.append(__ref_9);
  const __ref_12 = document.createComment("if:start");
  const __ref_13 = document.createComment("if:end");
  refs[12] = __ref_12;
  refs[13] = __ref_13;
  refs[14] = undefined;
  __ref_68.append(__ref_12);
  __ref_68.append(__ref_13);
  const __ref_19 = document.createComment("if:start");
  const __ref_20 = document.createComment("if:end");
  refs[19] = __ref_19;
  refs[20] = __ref_20;
  refs[21] = undefined;
  __ref_68.append(__ref_19);
  __ref_68.append(__ref_20);
  const __ref_26 = document.createComment("if:start");
  const __ref_27 = document.createComment("if:end");
  refs[26] = __ref_26;
  refs[27] = __ref_27;
  refs[28] = undefined;
  __ref_68.append(__ref_26);
  __ref_68.append(__ref_27);
  const __ref_33 = document.createComment("if:start");
  const __ref_34 = document.createComment("if:end");
  refs[33] = __ref_33;
  refs[34] = __ref_34;
  refs[35] = undefined;
  __ref_68.append(__ref_33);
  __ref_68.append(__ref_34);
  const __ref_40 = document.createComment("if:start");
  const __ref_41 = document.createComment("if:end");
  refs[40] = __ref_40;
  refs[41] = __ref_41;
  refs[42] = undefined;
  __ref_68.append(__ref_40);
  __ref_68.append(__ref_41);
  const __ref_47 = document.createComment("if:start");
  const __ref_48 = document.createComment("if:end");
  refs[47] = __ref_47;
  refs[48] = __ref_48;
  refs[49] = undefined;
  __ref_68.append(__ref_47);
  __ref_68.append(__ref_48);
  const __ref_54 = document.createComment("if:start");
  const __ref_55 = document.createComment("if:end");
  refs[54] = __ref_54;
  refs[55] = __ref_55;
  refs[56] = undefined;
  __ref_68.append(__ref_54);
  __ref_68.append(__ref_55);
  const __ref_61 = document.createComment("if:start");
  const __ref_62 = document.createComment("if:end");
  refs[61] = __ref_61;
  refs[62] = __ref_62;
  refs[63] = undefined;
  __ref_68.append(__ref_61);
  __ref_68.append(__ref_62);
  __ref_76.append(__ref_68);
  const __ref_69 = document.createComment("if:start");
  const __ref_70 = document.createComment("if:end");
  refs[69] = __ref_69;
  refs[70] = __ref_70;
  refs[71] = undefined;
  __ref_76.append(__ref_69);
  __ref_76.append(__ref_70);
  fragment.append(__ref_76);
  return fragment;
}

function updateRegion_child_2(instance, scope, refs) {
  refs[2].setProps({"active": scope.active, "connected": scope.connected, "note": scope.connectionNote});
  refs[2].update();
}
function updateRegion_conditional_3(instance, scope, refs) {
  updateConditional_3(instance, scope);
}
function updateRegion_text_6(instance, scope, refs) {
  const __next_text_6 = String((scope.error) ?? "");
  if (refs[6].data !== __next_text_6) {
    refs[6].data = __next_text_6;
  }
}
function updateRegion_conditional_8(instance, scope, refs) {
  updateConditional_8(instance, scope);
}
function updateRegion_conditional_12(instance, scope, refs) {
  updateConditional_12(instance, scope);
}
function updateRegion_child_17(instance, scope, refs) {
  refs[17].setProps({"items": scope.data, "history": scope.showHistory});
  refs[17].setEventHandlers({"toggle-history": (payload) => { const resolved = scope.toggleHistory; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }});
  refs[17].update();
}
function updateRegion_conditional_19(instance, scope, refs) {
  updateConditional_19(instance, scope);
}
function updateRegion_child_24(instance, scope, refs) {
  refs[24].setProps({"item": scope.data});
  refs[24].setEventHandlers({"new-session": (payload) => { const resolved = scope.newSession; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "start-work": (payload) => { const resolved = scope.startWork; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }});
  refs[24].update();
}
function updateRegion_conditional_26(instance, scope, refs) {
  updateConditional_26(instance, scope);
}
function updateRegion_child_31(instance, scope, refs) {
  refs[31].setProps({"items": scope.data});
  refs[31].update();
}
function updateRegion_conditional_33(instance, scope, refs) {
  updateConditional_33(instance, scope);
}
function updateRegion_child_38(instance, scope, refs) {
  refs[38].setProps({"item": scope.data});
  refs[38].setEventHandlers({"send": (payload) => { const resolved = scope.sendMessage; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "close": (payload) => { const resolved = scope.closeSession; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "respond": (payload) => { const resolved = scope.respond; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "question": (payload) => { const resolved = scope.question; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }});
  refs[38].update();
}
function updateRegion_conditional_40(instance, scope, refs) {
  updateConditional_40(instance, scope);
}
function updateRegion_child_45(instance, scope, refs) {
  refs[45].setProps({"items": scope.data});
  refs[45].update();
}
function updateRegion_conditional_47(instance, scope, refs) {
  updateConditional_47(instance, scope);
}
function updateRegion_child_52(instance, scope, refs) {
  refs[52].setProps({"item": scope.data, "entries": scope.inspection, "detail": scope.detail, "next": scope.inspectionNext, "preview": scope.preview});
  refs[52].setEventHandlers({"cancel": (payload) => { const resolved = scope.cancelWork; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "detail": (payload) => { const resolved = scope.changeDetail; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "more": (payload) => { const resolved = scope.moreInspection; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "respond": (payload) => { const resolved = scope.respond; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "question": (payload) => { const resolved = scope.question; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }});
  refs[52].update();
}
function updateRegion_conditional_54(instance, scope, refs) {
  updateConditional_54(instance, scope);
}
function updateRegion_child_59(instance, scope, refs) {
  refs[59].setProps({"entries": scope.data, "category": scope.category, "next": scope.auditNext});
  refs[59].setEventHandlers({"category": (payload) => { const resolved = scope.changeCategory; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "more": (payload) => { const resolved = scope.moreAudit; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }});
  refs[59].update();
}
function updateRegion_conditional_61(instance, scope, refs) {
  updateConditional_61(instance, scope);
}
function updateRegion_text_65(instance, scope, refs) {
  const __next_text_65 = String((scope.missingPath) ?? "");
  if (refs[65].data !== __next_text_65) {
    refs[65].data = __next_text_65;
  }
}
function updateRegion_conditional_69(instance, scope, refs) {
  updateConditional_69(instance, scope);
}
function updateRegion_child_74(instance, scope, refs) {
  refs[74].setProps({"open": scope.inputOpen, "title": scope.inputTitle, "help": scope.inputHelp, "initial": scope.inputInitial, "fields": scope.inputFields});
  refs[74].setEventHandlers({"cancel": (payload) => { const resolved = scope.dismissInput; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "submit": (payload) => { const resolved = scope.submitInput; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }});
  refs[74].update();
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_2(instance, scope, refs);
  updateRegion_conditional_3(instance, scope, refs);
  updateRegion_conditional_8(instance, scope, refs);
  updateRegion_conditional_12(instance, scope, refs);
  updateRegion_conditional_19(instance, scope, refs);
  updateRegion_conditional_26(instance, scope, refs);
  updateRegion_conditional_33(instance, scope, refs);
  updateRegion_conditional_40(instance, scope, refs);
  updateRegion_conditional_47(instance, scope, refs);
  updateRegion_conditional_54(instance, scope, refs);
  updateRegion_conditional_61(instance, scope, refs);
  updateRegion_conditional_69(instance, scope, refs);
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
  if (dirtySet.has("active") || dirtySet.has("connected") || dirtySet.has("connectionNote") || dirtyRegionSet.has(1)) {
    updateRegion_child_2(instance, scope, refs);
  }
  if (dirtySet.has("error") || dirtyRegionSet.has(2)) {
    updateRegion_conditional_3(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtyRegionSet.has(3)) {
    updateRegion_conditional_8(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("showHistory") || dirtySet.has("toggleHistory") || dirtyRegionSet.has(4)) {
    updateRegion_conditional_12(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("newSession") || dirtySet.has("startWork") || dirtyRegionSet.has(5)) {
    updateRegion_conditional_19(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtyRegionSet.has(6)) {
    updateRegion_conditional_26(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("sendMessage") || dirtySet.has("closeSession") || dirtySet.has("respond") || dirtySet.has("question") || dirtyRegionSet.has(7)) {
    updateRegion_conditional_33(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtyRegionSet.has(8)) {
    updateRegion_conditional_40(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("inspection") || dirtySet.has("detail") || dirtySet.has("inspectionNext") || dirtySet.has("preview") || dirtySet.has("cancelWork") || dirtySet.has("changeDetail") || dirtySet.has("moreInspection") || dirtySet.has("respond") || dirtySet.has("question") || dirtyRegionSet.has(9)) {
    updateRegion_conditional_47(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("category") || dirtySet.has("auditNext") || dirtySet.has("changeCategory") || dirtySet.has("moreAudit") || dirtyRegionSet.has(10)) {
    updateRegion_conditional_54(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("missingPath") || dirtyRegionSet.has(11)) {
    updateRegion_conditional_61(instance, scope, refs);
  }
  if (dirtySet.has("inputOpen") || dirtySet.has("inputTitle") || dirtySet.has("inputHelp") || dirtySet.has("inputInitial") || dirtySet.has("inputFields") || dirtySet.has("dismissInput") || dirtySet.has("submitInput") || dirtyRegionSet.has(12)) {
    updateRegion_conditional_69(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[2] && typeof refs[2].destroy === "function") {
    refs[2].destroy();
  }
  if (refs[5] === true) {
  } else {
  }
  if (refs[10] === true) {
  } else {
  }
  if (refs[14] === true) {
    if (refs[17] && typeof refs[17].destroy === "function") {
      refs[17].destroy();
    }
  } else {
  }
  if (refs[21] === true) {
    if (refs[24] && typeof refs[24].destroy === "function") {
      refs[24].destroy();
    }
  } else {
  }
  if (refs[28] === true) {
    if (refs[31] && typeof refs[31].destroy === "function") {
      refs[31].destroy();
    }
  } else {
  }
  if (refs[35] === true) {
    if (refs[38] && typeof refs[38].destroy === "function") {
      refs[38].destroy();
    }
  } else {
  }
  if (refs[42] === true) {
    if (refs[45] && typeof refs[45].destroy === "function") {
      refs[45].destroy();
    }
  } else {
  }
  if (refs[49] === true) {
    if (refs[52] && typeof refs[52].destroy === "function") {
      refs[52].destroy();
    }
  } else {
  }
  if (refs[56] === true) {
    if (refs[59] && typeof refs[59].destroy === "function") {
      refs[59].destroy();
    }
  } else {
  }
  if (refs[63] === true) {
  } else {
  }
  if (refs[71] === true) {
    if (refs[74] && typeof refs[74].destroy === "function") {
      refs[74].destroy();
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
