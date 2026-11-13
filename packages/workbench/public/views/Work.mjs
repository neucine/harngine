import * as PageHeader from "../components/PageHeader.mjs";
import * as Status from "../components/Status.mjs";
import * as InteractionList from "../components/InteractionList.mjs";
import { display as __weiv_import_display } from "../api.js";
import { pretty as __weiv_import_pretty } from "../api.js";
import { short as __weiv_import_short } from "../api.js";
import { terminal as __weiv_import_terminal } from "../api.js";
import { time as __weiv_import_time } from "../api.js";

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
    const __ref_6 = document.createElement("button");
    refs[6] = __ref_6;
    __ref_6.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_6.setAttribute("class", "danger");
    __ref_6.addEventListener("click", (event) => {
      const resolved = scope.cancel;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_6.append(document.createTextNode("\n        Cancel Work\n      "));
    fragment.append(__ref_6);
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
  const next = Boolean(!scope.terminal.has(scope.props.item.status));
  if (refs[5] !== next) {
    const previous = refs[5];
    destroyConditionalBranch_3(instance, previous === true);
    refs[5] = next;
    replaceBetween(refs[3], refs[4], createConditionalFragment_3(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function mountProjectedSlot_9_0(start, end, ownerInstance) {
  const instance = { refs: [], refresh: () => ownerInstance.refresh(), update: () => ownerInstance.update() };
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  const __ref_0 = document.createComment("component:start");
  const __ref_1 = document.createComment("component:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  fragment.append(__ref_0);
  fragment.append(__ref_1);
  const __props_2 = {"value": instance.refresh().props.item.status};
  refs[2] = Status.mountIntoBoundary(__ref_0, __ref_1, __props_2, undefined, undefined);
  const __ref_3 = document.createComment("if:start");
  const __ref_4 = document.createComment("if:end");
  refs[3] = __ref_3;
  refs[4] = __ref_4;
  refs[5] = undefined;
  fragment.append(__ref_3);
  fragment.append(__ref_4);
  replaceBetween(start, end, fragment);
  function update() {
    const refs = instance.refs;
    const scope = instance.refresh();
    updateRegion_child_2(instance, scope, refs);
    updateRegion_conditional_3(instance, scope, refs);
  }
  function destroy() {
    const refs = instance.refs;
    if (refs[2] && typeof refs[2].destroy === "function") {
      refs[2].destroy();
    }
    if (refs[5] === true) {
    } else {
    }
  }
  update();
  return { update, destroy, start, end };
}

function createConditionalFragment_16(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_26 = document.createElement("section");
    refs[26] = __ref_26;
    __ref_26.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_26.setAttribute("class", "panel result-data");
    const __ref_23 = document.createElement("div");
    refs[23] = __ref_23;
    __ref_23.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_23.setAttribute("class", "section-head");
    const __ref_21 = document.createElement("div");
    refs[21] = __ref_21;
    __ref_21.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    const __ref_19 = document.createElement("h2");
    refs[19] = __ref_19;
    __ref_19.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_19.append(document.createTextNode("Live model preview"));
    __ref_21.append(__ref_19);
    const __ref_20 = document.createElement("div");
    refs[20] = __ref_20;
    __ref_20.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_20.setAttribute("class", "muted");
    __ref_20.append(document.createTextNode("\n                Transient provider text; the completed result remains authoritative.\n              "));
    __ref_21.append(__ref_20);
    __ref_23.append(__ref_21);
    const __ref_22 = document.createElement("span");
    refs[22] = __ref_22;
    __ref_22.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_22.setAttribute("class", "pill running");
    __ref_22.append(document.createTextNode("Live"));
    __ref_23.append(__ref_22);
    __ref_26.append(__ref_23);
    const __ref_25 = document.createElement("div");
    refs[25] = __ref_25;
    __ref_25.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_25.setAttribute("class", "result");
    const __ref_24 = document.createTextNode("");
    refs[24] = __ref_24;
    __ref_25.append(__ref_24);
    __ref_26.append(__ref_25);
    fragment.append(__ref_26);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_16(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_16(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.preview);
  if (refs[18] !== next) {
    const previous = refs[18];
    destroyConditionalBranch_16(instance, previous === true);
    refs[18] = next;
    replaceBetween(refs[16], refs[17], createConditionalFragment_16(instance, scope, next));
  }
  if (next) {
    updateRegion_text_24(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_27(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_44 = document.createElement("section");
    refs[44] = __ref_44;
    __ref_44.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_44.setAttribute("class", "panel result-data");
    const __ref_34 = document.createElement("div");
    refs[34] = __ref_34;
    __ref_34.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_34.setAttribute("class", "section-head");
    const __ref_30 = document.createElement("h2");
    refs[30] = __ref_30;
    __ref_30.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_30.append(document.createTextNode("Result"));
    __ref_34.append(__ref_30);
    const __ref_31 = document.createComment("component:start");
    const __ref_32 = document.createComment("component:end");
    refs[31] = __ref_31;
    refs[32] = __ref_32;
    __ref_34.append(__ref_31);
    __ref_34.append(__ref_32);
    const __props_33 = {"value": 'completed'};
    refs[33] = Status.mountIntoBoundary(__ref_31, __ref_32, __props_33, undefined, undefined);
    __ref_44.append(__ref_34);
    const __ref_36 = document.createElement("div");
    refs[36] = __ref_36;
    __ref_36.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_36.setAttribute("class", "result");
    const __ref_35 = document.createTextNode("");
    refs[35] = __ref_35;
    __ref_36.append(__ref_35);
    __ref_44.append(__ref_36);
    const __ref_37 = document.createComment("if:start");
    const __ref_38 = document.createComment("if:end");
    refs[37] = __ref_37;
    refs[38] = __ref_38;
    refs[39] = undefined;
    __ref_44.append(__ref_37);
    __ref_44.append(__ref_38);
    fragment.append(__ref_44);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_27(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    if (refs[33] && typeof refs[33].destroy === "function") {
      refs[33].destroy();
    }
    if (refs[39] === true) {
    } else {
    }
  } else {
  }
}

function updateConditional_27(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.item.status === 'completed');
  if (refs[29] !== next) {
    const previous = refs[29];
    destroyConditionalBranch_27(instance, previous === true);
    refs[29] = next;
    replaceBetween(refs[27], refs[28], createConditionalFragment_27(instance, scope, next));
  }
  if (next) {
    updateRegion_child_33(instance, scope, refs);
    updateRegion_text_35(instance, scope, refs);
    updateRegion_conditional_37(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_37(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_43 = document.createElement("details");
    refs[43] = __ref_43;
    __ref_43.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_43.setAttribute("class", "json-details");
    const __ref_40 = document.createElement("summary");
    refs[40] = __ref_40;
    __ref_40.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_40.append(document.createTextNode("View structured result"));
    __ref_43.append(__ref_40);
    const __ref_42 = document.createElement("pre");
    refs[42] = __ref_42;
    __ref_42.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    const __ref_41 = document.createTextNode("");
    refs[41] = __ref_41;
    __ref_42.append(__ref_41);
    __ref_43.append(__ref_42);
    fragment.append(__ref_43);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_37(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_37(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(typeof scope.props.item.result === 'object');
  if (refs[39] !== next) {
    const previous = refs[39];
    destroyConditionalBranch_37(instance, previous === true);
    refs[39] = next;
    replaceBetween(refs[37], refs[38], createConditionalFragment_37(instance, scope, next));
  }
  if (next) {
    updateRegion_text_41(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_45(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_52 = document.createElement("section");
    refs[52] = __ref_52;
    __ref_52.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_52.setAttribute("class", "panel");
    const __ref_51 = document.createElement("div");
    refs[51] = __ref_51;
    __ref_51.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_51.setAttribute("class", "error");
    const __ref_49 = document.createElement("b");
    refs[49] = __ref_49;
    __ref_49.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    const __ref_48 = document.createTextNode("");
    refs[48] = __ref_48;
    __ref_49.append(__ref_48);
    __ref_51.append(__ref_49);
    __ref_51.append(document.createTextNode("\n            · "));
    const __ref_50 = document.createTextNode("");
    refs[50] = __ref_50;
    __ref_51.append(__ref_50);
    __ref_52.append(__ref_51);
    fragment.append(__ref_52);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_45(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_45(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.item.error);
  if (refs[47] !== next) {
    const previous = refs[47];
    destroyConditionalBranch_45(instance, previous === true);
    refs[47] = next;
    replaceBetween(refs[45], refs[46], createConditionalFragment_45(instance, scope, next));
  }
  if (next) {
    updateRegion_text_48(instance, scope, refs);
    updateRegion_text_50(instance, scope, refs);
  } else {
  }
}

function createForEntry_63(instance, scope, item, reference) {
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
    updateRegion_text_66(instance, loopScope, entryRefs);
    updateRegion_text_68(instance, loopScope, entryRefs);
    updateRegion_attribute_72_class(instance, loopScope, entryRefs);
    updateRegion_text_71(instance, loopScope, entryRefs);
    updateRegion_attribute_74_class(instance, loopScope, entryRefs);
    updateRegion_text_73(instance, loopScope, entryRefs);
    updateRegion_attribute_78_class(instance, loopScope, entryRefs);
    updateRegion_text_76(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_79 = document.createElement("div");
  entryRefs[79] = __ref_79;
  __ref_79.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_79.setAttribute("class", "entry");
  const __ref_70 = document.createElement("div");
  entryRefs[70] = __ref_70;
  __ref_70.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_70.setAttribute("class", "toolbar");
  const __ref_67 = document.createElement("b");
  entryRefs[67] = __ref_67;
  __ref_67.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_66 = document.createTextNode("");
  entryRefs[66] = __ref_66;
  __ref_67.append(__ref_66);
  __ref_70.append(__ref_67);
  const __ref_69 = document.createElement("span");
  entryRefs[69] = __ref_69;
  __ref_69.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_69.setAttribute("class", "muted");
  const __ref_68 = document.createTextNode("");
  entryRefs[68] = __ref_68;
  __ref_69.append(__ref_68);
  __ref_70.append(__ref_69);
  __ref_79.append(__ref_70);
  const __ref_72 = document.createElement("div");
  entryRefs[72] = __ref_72;
  __ref_72.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_71 = document.createTextNode("");
  entryRefs[71] = __ref_71;
  __ref_72.append(__ref_71);
  __ref_79.append(__ref_72);
  const __ref_74 = document.createElement("pre");
  entryRefs[74] = __ref_74;
  __ref_74.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_73 = document.createTextNode("");
  entryRefs[73] = __ref_73;
  __ref_74.append(__ref_73);
  __ref_79.append(__ref_74);
  const __ref_78 = document.createElement("details");
  entryRefs[78] = __ref_78;
  __ref_78.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_75 = document.createElement("summary");
  entryRefs[75] = __ref_75;
  __ref_75.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_75.append(document.createTextNode("Event details"));
  __ref_78.append(__ref_75);
  const __ref_77 = document.createElement("pre");
  entryRefs[77] = __ref_77;
  __ref_77.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_76 = document.createTextNode("");
  entryRefs[76] = __ref_76;
  __ref_77.append(__ref_76);
  __ref_78.append(__ref_77);
  __ref_79.append(__ref_78);
  fragment.append(__ref_79);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_63(instance, scope) {
  const refs = instance.refs;
  const iterable = (scope.props.entries) ?? [];
  const previous = refs[65] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[64]);
    } else {
      record = createForEntry_63(instance, scope, item, refs[64]);
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
  refs[65] = nextRecords;
}

function createConditionalFragment_80(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_83 = document.createElement("div");
    refs[83] = __ref_83;
    __ref_83.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_83.setAttribute("class", "muted");
    __ref_83.append(document.createTextNode("No inspection entries."));
    fragment.append(__ref_83);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_80(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_80(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(!scope.props.entries.length);
  if (refs[82] !== next) {
    const previous = refs[82];
    destroyConditionalBranch_80(instance, previous === true);
    refs[82] = next;
    replaceBetween(refs[80], refs[81], createConditionalFragment_80(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_84(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_87 = document.createElement("button");
    refs[87] = __ref_87;
    __ref_87.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_87.addEventListener("click", (event) => {
      const resolved = scope.more;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_87.append(document.createTextNode("Load more"));
    fragment.append(__ref_87);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_84(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_84(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.next);
  if (refs[86] !== next) {
    const previous = refs[86];
    destroyConditionalBranch_84(instance, previous === true);
    refs[86] = next;
    replaceBetween(refs[84], refs[85], createConditionalFragment_84(instance, scope, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_105(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_110 = document.createElement("div");
    refs[110] = __ref_110;
    __ref_110.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_110.setAttribute("class", "fact");
    const __ref_108 = document.createElement("span");
    refs[108] = __ref_108;
    __ref_108.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_108.setAttribute("class", "label");
    __ref_108.append(document.createTextNode("Session"));
    __ref_110.append(__ref_108);
    const __ref_109 = document.createElement("a");
    refs[109] = __ref_109;
    __ref_109.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
    __ref_109.setAttribute("class", "message-link");
    __ref_109.append(document.createTextNode("Open Session →"));
    __ref_110.append(__ref_109);
    fragment.append(__ref_110);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_105(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_105(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.item.sessionId);
  if (refs[107] !== next) {
    const previous = refs[107];
    destroyConditionalBranch_105(instance, previous === true);
    refs[107] = next;
    replaceBetween(refs[105], refs[106], createConditionalFragment_105(instance, scope, next));
  }
  if (next) {
    updateRegion_attribute_109_href(instance, scope, refs);
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
  function result() {
  return props.item.result?.message || display(props.item.result);
  }
  function cancel() {
  emit("cancel", props.item.id);
  }
  function detailChange(event) {
  emit("detail", event.target.value);
  }
  function more() {
  emit("more", props.next);
  }
  function respond(value) {
  emit("respond", value);
  }
  function question(value) {
  emit("question", value);
  }
  const display = __weiv_getTrackedRoot("display", __weiv_import_display);
  const pretty = __weiv_getTrackedRoot("pretty", __weiv_import_pretty);
  const short = __weiv_getTrackedRoot("short", __weiv_import_short);
  const terminal = __weiv_getTrackedRoot("terminal", __weiv_import_terminal);
  const time = __weiv_getTrackedRoot("time", __weiv_import_time);
  props = __weiv_getTrackedRoot("props", props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.display = display;
    __weiv_scope.pretty = pretty;
    __weiv_scope.short = short;
    __weiv_scope.terminal = terminal;
    __weiv_scope.time = time;
    __weiv_scope.props = props;
    __weiv_scope.result = result;
    __weiv_scope.cancel = cancel;
    __weiv_scope.detailChange = detailChange;
    __weiv_scope.more = more;
    __weiv_scope.respond = respond;
    __weiv_scope.question = question;
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
    __weiv_register(display);
    __weiv_register(pretty);
    __weiv_register(short);
    __weiv_register(terminal);
    __weiv_register(time);
    return () => {
      for (const __weiv_unsubscribe of __weiv_unsubscribes) {
        __weiv_unsubscribe();
      }
    };
  }
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, setBoundaryRunner: __weiv_setBoundaryRunner, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "w0DE717F3DAC367B3";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.item", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.item.subtitle", parentPathId: 2 }, { pathId: 4, rootId: 1, path: "props.item.objective", parentPathId: 2 }, { pathId: 5, rootId: 1, path: "props.preview", parentPathId: 1 }, { pathId: 6, rootId: 1, path: "props.item.status", parentPathId: 2 }, { pathId: 7, rootId: 1, path: "props.item.error", parentPathId: 2 }, { pathId: 8, rootId: 1, path: "props.entries", parentPathId: 1 }, { pathId: 9, rootId: 1, path: "props.entries.length", parentPathId: 8 }, { pathId: 10, rootId: 1, path: "props.next", parentPathId: 1 }, { pathId: 11, rootId: 1, path: "props.item.id", parentPathId: 2 }, { pathId: 12, rootId: 1, path: "props.item.definition", parentPathId: 2 }, { pathId: 13, rootId: 1, path: "props.item.definition.kind", parentPathId: 12 }, { pathId: 14, rootId: 1, path: "props.item.definition.id", parentPathId: 12 }, { pathId: 15, rootId: 1, path: "props.item.definition.revision", parentPathId: 12 }, { pathId: 16, rootId: 1, path: "props.item.sessionId", parentPathId: 2 }, { pathId: 17, rootId: 1, path: "props.item.createdAt", parentPathId: 2 }], regions: [{ regionId: 1, trackedPathIds: [3] }, { regionId: 2, trackedPathIds: [4] }, { regionId: 3, trackedPathIds: [5] }, { regionId: 4, trackedPathIds: [6] }, { regionId: 5, trackedPathIds: [7] }, { regionId: 6, trackedPathIds: [2] }, { regionId: 7, trackedPathIds: [8] }, { regionId: 8, trackedPathIds: [9] }, { regionId: 9, trackedPathIds: [10] }, { regionId: 10, trackedPathIds: [11] }, { regionId: 11, trackedPathIds: [13] }, { regionId: 12, trackedPathIds: [14] }, { regionId: 13, trackedPathIds: [15] }, { regionId: 14, trackedPathIds: [16] }, { regionId: 15, trackedPathIds: [17] }, { regionId: 16, trackedPathIds: [2] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_123 = document.createElement("div");
  refs[123] = __ref_123;
  __ref_123.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_7 = document.createComment("component:start");
  const __ref_8 = document.createComment("component:end");
  refs[7] = __ref_7;
  refs[8] = __ref_8;
  __ref_123.append(__ref_7);
  __ref_123.append(__ref_8);
  const __props_9 = {"title": 'Work', "subtitle": instance.refresh().props.item.subtitle};
  const __slots_9 = { default: { mountIntoBoundary: (start, end) => mountProjectedSlot_9_0(start, end, instance) } };
  refs[9] = PageHeader.mountIntoBoundary(__ref_7, __ref_8, __props_9, undefined, __slots_9);
  const __ref_122 = document.createElement("div");
  refs[122] = __ref_122;
  __ref_122.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_122.setAttribute("class", "split");
  const __ref_90 = document.createElement("div");
  refs[90] = __ref_90;
  __ref_90.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_90.setAttribute("class", "stack");
  const __ref_15 = document.createElement("section");
  refs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_15.setAttribute("class", "panel");
  const __ref_12 = document.createElement("div");
  refs[12] = __ref_12;
  __ref_12.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_12.setAttribute("class", "section-head");
  const __ref_10 = document.createElement("h2");
  refs[10] = __ref_10;
  __ref_10.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_10.append(document.createTextNode("Objective"));
  __ref_12.append(__ref_10);
  const __ref_11 = document.createElement("span");
  refs[11] = __ref_11;
  __ref_11.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_11.setAttribute("class", "label");
  __ref_11.append(document.createTextNode("Accepted input"));
  __ref_12.append(__ref_11);
  __ref_15.append(__ref_12);
  const __ref_14 = document.createElement("div");
  refs[14] = __ref_14;
  __ref_14.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_14.setAttribute("class", "result");
  const __ref_13 = document.createTextNode("");
  refs[13] = __ref_13;
  __ref_14.append(__ref_13);
  __ref_15.append(__ref_14);
  __ref_90.append(__ref_15);
  const __ref_16 = document.createComment("if:start");
  const __ref_17 = document.createComment("if:end");
  refs[16] = __ref_16;
  refs[17] = __ref_17;
  refs[18] = undefined;
  __ref_90.append(__ref_16);
  __ref_90.append(__ref_17);
  const __ref_27 = document.createComment("if:start");
  const __ref_28 = document.createComment("if:end");
  refs[27] = __ref_27;
  refs[28] = __ref_28;
  refs[29] = undefined;
  __ref_90.append(__ref_27);
  __ref_90.append(__ref_28);
  const __ref_45 = document.createComment("if:start");
  const __ref_46 = document.createComment("if:end");
  refs[45] = __ref_45;
  refs[46] = __ref_46;
  refs[47] = undefined;
  __ref_90.append(__ref_45);
  __ref_90.append(__ref_46);
  const __ref_53 = document.createComment("component:start");
  const __ref_54 = document.createComment("component:end");
  refs[53] = __ref_53;
  refs[54] = __ref_54;
  __ref_90.append(__ref_53);
  __ref_90.append(__ref_54);
  const __props_55 = {"work": instance.refresh().props.item};
  const __handlers_55 = {"respond": (payload) => { const resolved = instance.refresh().respond; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "question": (payload) => { const resolved = instance.refresh().question; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }};
  refs[55] = InteractionList.mountIntoBoundary(__ref_53, __ref_54, __props_55, __handlers_55, undefined);
  const __ref_89 = document.createElement("section");
  refs[89] = __ref_89;
  __ref_89.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_89.setAttribute("class", "panel");
  const __ref_62 = document.createElement("div");
  refs[62] = __ref_62;
  __ref_62.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_62.setAttribute("class", "section-head");
  const __ref_58 = document.createElement("div");
  refs[58] = __ref_58;
  __ref_58.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_56 = document.createElement("h2");
  refs[56] = __ref_56;
  __ref_56.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_56.append(document.createTextNode("Inspection"));
  __ref_58.append(__ref_56);
  const __ref_57 = document.createElement("div");
  refs[57] = __ref_57;
  __ref_57.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_57.setAttribute("class", "muted");
  __ref_57.append(document.createTextNode("A durable timeline of decisions and calls."));
  __ref_58.append(__ref_57);
  __ref_62.append(__ref_58);
  const __ref_61 = document.createElement("select");
  refs[61] = __ref_61;
  __ref_61.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_61.setAttribute("aria-label", "Inspection detail");
  __ref_61.addEventListener("change", (event) => {
    const resolved = instance.refresh().detailChange;
    if (typeof resolved === "function") {
      return runOwnedBoundary(instance, () => resolved(event));
    }
  });
  const __ref_59 = document.createElement("option");
  refs[59] = __ref_59;
  __ref_59.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_59.setAttribute("value", "story");
  __ref_59.append(document.createTextNode("Story"));
  __ref_61.append(__ref_59);
  const __ref_60 = document.createElement("option");
  refs[60] = __ref_60;
  __ref_60.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_60.setAttribute("value", "diagnostic");
  __ref_60.append(document.createTextNode("Diagnostic"));
  __ref_61.append(__ref_60);
  __ref_62.append(__ref_61);
  __ref_89.append(__ref_62);
  const __ref_88 = document.createElement("div");
  refs[88] = __ref_88;
  __ref_88.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_88.setAttribute("class", "timeline");
  const __ref_63 = document.createComment("for:start");
  const __ref_64 = document.createComment("for:end");
  refs[63] = __ref_63;
  refs[64] = __ref_64;
  refs[65] = [];
  __ref_88.append(__ref_63);
  __ref_88.append(__ref_64);
  const __ref_80 = document.createComment("if:start");
  const __ref_81 = document.createComment("if:end");
  refs[80] = __ref_80;
  refs[81] = __ref_81;
  refs[82] = undefined;
  __ref_88.append(__ref_80);
  __ref_88.append(__ref_81);
  const __ref_84 = document.createComment("if:start");
  const __ref_85 = document.createComment("if:end");
  refs[84] = __ref_84;
  refs[85] = __ref_85;
  refs[86] = undefined;
  __ref_88.append(__ref_84);
  __ref_88.append(__ref_85);
  __ref_89.append(__ref_88);
  __ref_90.append(__ref_89);
  __ref_122.append(__ref_90);
  const __ref_121 = document.createElement("aside");
  refs[121] = __ref_121;
  __ref_121.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_121.setAttribute("class", "stack");
  const __ref_120 = document.createElement("section");
  refs[120] = __ref_120;
  __ref_120.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_120.setAttribute("class", "panel");
  const __ref_91 = document.createElement("h2");
  refs[91] = __ref_91;
  __ref_91.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_91.append(document.createTextNode("Execution"));
  __ref_120.append(__ref_91);
  const __ref_115 = document.createElement("div");
  refs[115] = __ref_115;
  __ref_115.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_115.setAttribute("class", "fact-list");
  const __ref_95 = document.createElement("div");
  refs[95] = __ref_95;
  __ref_95.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_95.setAttribute("class", "fact");
  const __ref_92 = document.createElement("span");
  refs[92] = __ref_92;
  __ref_92.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_92.setAttribute("class", "label");
  __ref_92.append(document.createTextNode("Work ID"));
  __ref_95.append(__ref_92);
  const __ref_94 = document.createElement("span");
  refs[94] = __ref_94;
  __ref_94.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_94.setAttribute("class", "mono");
  const __ref_93 = document.createTextNode("");
  refs[93] = __ref_93;
  __ref_94.append(__ref_93);
  __ref_95.append(__ref_94);
  __ref_115.append(__ref_95);
  const __ref_100 = document.createElement("div");
  refs[100] = __ref_100;
  __ref_100.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_100.setAttribute("class", "fact");
  const __ref_96 = document.createElement("span");
  refs[96] = __ref_96;
  __ref_96.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_96.setAttribute("class", "label");
  __ref_96.append(document.createTextNode("Definition"));
  __ref_100.append(__ref_96);
  const __ref_99 = document.createElement("span");
  refs[99] = __ref_99;
  __ref_99.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_97 = document.createTextNode("");
  refs[97] = __ref_97;
  __ref_99.append(__ref_97);
  __ref_99.append(document.createTextNode(" · "));
  const __ref_98 = document.createTextNode("");
  refs[98] = __ref_98;
  __ref_99.append(__ref_98);
  __ref_100.append(__ref_99);
  __ref_115.append(__ref_100);
  const __ref_104 = document.createElement("div");
  refs[104] = __ref_104;
  __ref_104.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_104.setAttribute("class", "fact");
  const __ref_101 = document.createElement("span");
  refs[101] = __ref_101;
  __ref_101.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_101.setAttribute("class", "label");
  __ref_101.append(document.createTextNode("Revision"));
  __ref_104.append(__ref_101);
  const __ref_103 = document.createElement("span");
  refs[103] = __ref_103;
  __ref_103.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_103.setAttribute("class", "mono");
  const __ref_102 = document.createTextNode("");
  refs[102] = __ref_102;
  __ref_103.append(__ref_102);
  __ref_104.append(__ref_103);
  __ref_115.append(__ref_104);
  const __ref_105 = document.createComment("if:start");
  const __ref_106 = document.createComment("if:end");
  refs[105] = __ref_105;
  refs[106] = __ref_106;
  refs[107] = undefined;
  __ref_115.append(__ref_105);
  __ref_115.append(__ref_106);
  const __ref_114 = document.createElement("div");
  refs[114] = __ref_114;
  __ref_114.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_114.setAttribute("class", "fact");
  const __ref_111 = document.createElement("span");
  refs[111] = __ref_111;
  __ref_111.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_111.setAttribute("class", "label");
  __ref_111.append(document.createTextNode("Started"));
  __ref_114.append(__ref_111);
  const __ref_113 = document.createElement("span");
  refs[113] = __ref_113;
  __ref_113.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_112 = document.createTextNode("");
  refs[112] = __ref_112;
  __ref_113.append(__ref_112);
  __ref_114.append(__ref_113);
  __ref_115.append(__ref_114);
  __ref_120.append(__ref_115);
  const __ref_119 = document.createElement("details");
  refs[119] = __ref_119;
  __ref_119.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_119.setAttribute("class", "json-details");
  const __ref_116 = document.createElement("summary");
  refs[116] = __ref_116;
  __ref_116.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  __ref_116.append(document.createTextNode("View raw state"));
  __ref_119.append(__ref_116);
  const __ref_118 = document.createElement("pre");
  refs[118] = __ref_118;
  __ref_118.setAttribute("data-weiv-scope", "w0DE717F3DAC367B3");
  const __ref_117 = document.createTextNode("");
  refs[117] = __ref_117;
  __ref_118.append(__ref_117);
  __ref_119.append(__ref_118);
  __ref_120.append(__ref_119);
  __ref_121.append(__ref_120);
  __ref_122.append(__ref_121);
  __ref_123.append(__ref_122);
  fragment.append(__ref_123);
  return fragment;
}

function updateRegion_child_9(instance, scope, refs) {
  refs[9].setProps({"title": 'Work', "subtitle": scope.props.item.subtitle});
  refs[9].setSlots({ default: { mountIntoBoundary: (start, end) => mountProjectedSlot_9_0(start, end, instance) } });
  refs[9].update();
}
function updateRegion_child_2(instance, scope, refs) {
  refs[2].setProps({"value": scope.props.item.status});
  refs[2].update();
}
function updateRegion_conditional_3(instance, scope, refs) {
  updateConditional_3(instance, scope);
}
function updateRegion_text_13(instance, scope, refs) {
  const __next_text_13 = String((scope.display(scope.props.item.objective)) ?? "");
  if (refs[13].data !== __next_text_13) {
    refs[13].data = __next_text_13;
  }
}
function updateRegion_conditional_16(instance, scope, refs) {
  updateConditional_16(instance, scope);
}
function updateRegion_text_24(instance, scope, refs) {
  const __next_text_24 = String((scope.props.preview) ?? "");
  if (refs[24].data !== __next_text_24) {
    refs[24].data = __next_text_24;
  }
}
function updateRegion_conditional_27(instance, scope, refs) {
  updateConditional_27(instance, scope);
}
function updateRegion_child_33(instance, scope, refs) {
  refs[33].setProps({"value": 'completed'});
  refs[33].update();
}
function updateRegion_text_35(instance, scope, refs) {
  const __next_text_35 = String((scope.result()) ?? "");
  if (refs[35].data !== __next_text_35) {
    refs[35].data = __next_text_35;
  }
}
function updateRegion_conditional_37(instance, scope, refs) {
  updateConditional_37(instance, scope);
}
function updateRegion_text_41(instance, scope, refs) {
  const __next_text_41 = String((scope.pretty(scope.props.item.result)) ?? "");
  if (refs[41].data !== __next_text_41) {
    refs[41].data = __next_text_41;
  }
}
function updateRegion_conditional_45(instance, scope, refs) {
  updateConditional_45(instance, scope);
}
function updateRegion_text_48(instance, scope, refs) {
  const __next_text_48 = String((scope.props.item.error.code) ?? "");
  if (refs[48].data !== __next_text_48) {
    refs[48].data = __next_text_48;
  }
}
function updateRegion_text_50(instance, scope, refs) {
  const __next_text_50 = String((scope.props.item.error.message) ?? "");
  if (refs[50].data !== __next_text_50) {
    refs[50].data = __next_text_50;
  }
}
function updateRegion_child_55(instance, scope, refs) {
  refs[55].setProps({"work": scope.props.item});
  refs[55].setEventHandlers({"respond": (payload) => { const resolved = scope.respond; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }, "question": (payload) => { const resolved = scope.question; if (typeof resolved === "function") { return runOwnedBoundary(instance, () => resolved(payload)); } return undefined; }});
  refs[55].update();
}
function updateRegion_loop_63(instance, scope, refs) {
  updateForLoop_63(instance, scope);
}
function updateRegion_text_66(instance, scope, refs) {
  const __next_text_66 = String((scope.entry.presentation.title) ?? "");
  if (refs[66].data !== __next_text_66) {
    refs[66].data = __next_text_66;
  }
}
function updateRegion_text_68(instance, scope, refs) {
  const __next_text_68 = String((scope.entry.type) ?? "");
  if (refs[68].data !== __next_text_68) {
    refs[68].data = __next_text_68;
  }
}
function updateRegion_attribute_72_class(instance, scope, refs) {
  const __value_72_class = scope.entry.presentation.summary ? '' : 'hidden';
  if (__value_72_class === false || __value_72_class === null || __value_72_class === undefined) {
    if (refs[72].hasAttribute("class")) { refs[72].removeAttribute("class"); }
  } else if (__value_72_class === true) {
    if (!refs[72].hasAttribute("class")) { refs[72].setAttribute("class", ""); }
  } else {
    refs[72].setAttribute("class", String(__value_72_class));
  }
}
function updateRegion_text_71(instance, scope, refs) {
  const __next_text_71 = String((scope.entry.presentation.summary) ?? "");
  if (refs[71].data !== __next_text_71) {
    refs[71].data = __next_text_71;
  }
}
function updateRegion_attribute_74_class(instance, scope, refs) {
  const __value_74_class = scope.entry.presentation.data !== undefined ? '' : 'hidden';
  if (__value_74_class === false || __value_74_class === null || __value_74_class === undefined) {
    if (refs[74].hasAttribute("class")) { refs[74].removeAttribute("class"); }
  } else if (__value_74_class === true) {
    if (!refs[74].hasAttribute("class")) { refs[74].setAttribute("class", ""); }
  } else {
    refs[74].setAttribute("class", String(__value_74_class));
  }
}
function updateRegion_text_73(instance, scope, refs) {
  const __next_text_73 = String((scope.pretty(scope.entry.presentation.data)) ?? "");
  if (refs[73].data !== __next_text_73) {
    refs[73].data = __next_text_73;
  }
}
function updateRegion_attribute_78_class(instance, scope, refs) {
  const __value_78_class = scope.props.detail === 'diagnostic' ? '' : 'hidden';
  if (__value_78_class === false || __value_78_class === null || __value_78_class === undefined) {
    if (refs[78].hasAttribute("class")) { refs[78].removeAttribute("class"); }
  } else if (__value_78_class === true) {
    if (!refs[78].hasAttribute("class")) { refs[78].setAttribute("class", ""); }
  } else {
    refs[78].setAttribute("class", String(__value_78_class));
  }
}
function updateRegion_text_76(instance, scope, refs) {
  const __next_text_76 = String((scope.pretty(scope.entry)) ?? "");
  if (refs[76].data !== __next_text_76) {
    refs[76].data = __next_text_76;
  }
}
function updateRegion_conditional_80(instance, scope, refs) {
  updateConditional_80(instance, scope);
}
function updateRegion_conditional_84(instance, scope, refs) {
  updateConditional_84(instance, scope);
}
function updateRegion_text_93(instance, scope, refs) {
  const __next_text_93 = String((scope.props.item.id) ?? "");
  if (refs[93].data !== __next_text_93) {
    refs[93].data = __next_text_93;
  }
}
function updateRegion_text_97(instance, scope, refs) {
  const __next_text_97 = String((scope.props.item.definition.kind) ?? "");
  if (refs[97].data !== __next_text_97) {
    refs[97].data = __next_text_97;
  }
}
function updateRegion_text_98(instance, scope, refs) {
  const __next_text_98 = String((scope.props.item.definition.id) ?? "");
  if (refs[98].data !== __next_text_98) {
    refs[98].data = __next_text_98;
  }
}
function updateRegion_text_102(instance, scope, refs) {
  const __next_text_102 = String((scope.short(scope.props.item.definition.revision)) ?? "");
  if (refs[102].data !== __next_text_102) {
    refs[102].data = __next_text_102;
  }
}
function updateRegion_conditional_105(instance, scope, refs) {
  updateConditional_105(instance, scope);
}
function updateRegion_attribute_109_href(instance, scope, refs) {
  const __value_109_href = '/sessions/' + encodeURIComponent(scope.props.item.sessionId);
  if (__value_109_href === false || __value_109_href === null || __value_109_href === undefined) {
    if (refs[109].hasAttribute("href")) { refs[109].removeAttribute("href"); }
  } else if (__value_109_href === true) {
    if (!refs[109].hasAttribute("href")) { refs[109].setAttribute("href", ""); }
  } else {
    refs[109].setAttribute("href", String(__value_109_href));
  }
}
function updateRegion_text_112(instance, scope, refs) {
  const __next_text_112 = String((scope.time(scope.props.item.createdAt)) ?? "");
  if (refs[112].data !== __next_text_112) {
    refs[112].data = __next_text_112;
  }
}
function updateRegion_text_117(instance, scope, refs) {
  const __next_text_117 = String((scope.pretty(scope.props.item)) ?? "");
  if (refs[117].data !== __next_text_117) {
    refs[117].data = __next_text_117;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_9(instance, scope, refs);
  updateRegion_text_13(instance, scope, refs);
  updateRegion_conditional_16(instance, scope, refs);
  updateRegion_conditional_27(instance, scope, refs);
  updateRegion_conditional_45(instance, scope, refs);
  updateRegion_child_55(instance, scope, refs);
  updateRegion_loop_63(instance, scope, refs);
  updateRegion_conditional_80(instance, scope, refs);
  updateRegion_conditional_84(instance, scope, refs);
  updateRegion_text_93(instance, scope, refs);
  updateRegion_text_97(instance, scope, refs);
  updateRegion_text_98(instance, scope, refs);
  updateRegion_text_102(instance, scope, refs);
  updateRegion_conditional_105(instance, scope, refs);
  updateRegion_text_112(instance, scope, refs);
  updateRegion_text_117(instance, scope, refs);
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
  if (dirtySet.has("props") || dirtySet.has("terminal") || dirtyRegionSet.has(1)) {
    updateRegion_child_9(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(2)) {
    updateRegion_text_13(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(3)) {
    updateRegion_conditional_16(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtySet.has("result") || dirtySet.has("display") || dirtyRegionSet.has(4)) {
    updateRegion_conditional_27(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(5)) {
    updateRegion_conditional_45(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtySet.has("respond") || dirtySet.has("question") || dirtyRegionSet.has(6)) {
    updateRegion_child_55(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(7)) {
    updateRegion_loop_63(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(8)) {
    updateRegion_conditional_80(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(9)) {
    updateRegion_conditional_84(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(10)) {
    updateRegion_text_93(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(11)) {
    updateRegion_text_97(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(12)) {
    updateRegion_text_98(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(13)) {
    updateRegion_text_102(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(14)) {
    updateRegion_conditional_105(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(15)) {
    updateRegion_text_112(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(16)) {
    updateRegion_text_117(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[9] && typeof refs[9].destroy === "function") {
    refs[9].destroy();
  }
  if (refs[18] === true) {
  } else {
  }
  if (refs[29] === true) {
    if (refs[33] && typeof refs[33].destroy === "function") {
      refs[33].destroy();
    }
    if (refs[39] === true) {
    } else {
    }
  } else {
  }
  if (refs[47] === true) {
  } else {
  }
  if (refs[55] && typeof refs[55].destroy === "function") {
    refs[55].destroy();
  }
  const __records_65 = refs[65] ?? [];
  for (const record of __records_65) {
    if (record.handle && typeof record.handle.destroy === "function") {
      record.handle.destroy();
    } else if (typeof record.destroy === "function") {
      record.destroy();
    }
  }
  if (refs[82] === true) {
  } else {
  }
  if (refs[86] === true) {
  } else {
  }
  if (refs[107] === true) {
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
