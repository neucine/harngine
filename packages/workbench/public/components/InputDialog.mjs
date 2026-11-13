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
    const __ref_28 = document.createElement("div");
    refs[28] = __ref_28;
    __ref_28.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_28.setAttribute("class", "modal-backdrop");
    const __ref_27 = document.createElement("section");
    refs[27] = __ref_27;
    __ref_27.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_27.setAttribute("class", "modal panel");
    __ref_27.setAttribute("role", "dialog");
    __ref_27.setAttribute("aria-modal", "true");
    const __ref_4 = document.createElement("h2");
    refs[4] = __ref_4;
    __ref_4.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    const __ref_3 = document.createTextNode("");
    refs[3] = __ref_3;
    __ref_4.append(__ref_3);
    __ref_27.append(__ref_4);
    const __ref_6 = document.createElement("p");
    refs[6] = __ref_6;
    __ref_6.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_6.setAttribute("class", "muted");
    const __ref_5 = document.createTextNode("");
    refs[5] = __ref_5;
    __ref_6.append(__ref_5);
    __ref_27.append(__ref_6);
    const __ref_10 = document.createElement("div");
    refs[10] = __ref_10;
    __ref_10.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_10.setAttribute("class", "toolbar");
    const __ref_7 = document.createElement("span");
    refs[7] = __ref_7;
    __ref_7.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_7.setAttribute("class", "label");
    __ref_7.append(document.createTextNode("Contract input"));
    __ref_10.append(__ref_7);
    const __ref_9 = document.createElement("button");
    refs[9] = __ref_9;
    __ref_9.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_9.setAttribute("type", "button");
    __ref_9.addEventListener("click", (event) => {
      const resolved = scope.toggleMode;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    const __ref_8 = document.createTextNode("");
    refs[8] = __ref_8;
    __ref_9.append(__ref_8);
    __ref_10.append(__ref_9);
    __ref_27.append(__ref_10);
    const __ref_17 = document.createElement("div");
    refs[17] = __ref_17;
    __ref_17.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_17.setAttribute("class", "schema-form");
    const __ref_11 = document.createComment("for:start");
    const __ref_12 = document.createComment("for:end");
    refs[11] = __ref_11;
    refs[12] = __ref_12;
    refs[13] = [];
    __ref_17.append(__ref_11);
    __ref_17.append(__ref_12);
    __ref_27.append(__ref_17);
    const __ref_18 = document.createElement("textarea");
    refs[18] = __ref_18;
    __ref_18.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_18.setAttribute("id", "contract-input");
    __ref_18.setAttribute("class", "json-editor");
    __ref_18.setAttribute("rows", "12");
    __ref_27.append(__ref_18);
    const __ref_19 = document.createComment("if:start");
    const __ref_20 = document.createComment("if:end");
    refs[19] = __ref_19;
    refs[20] = __ref_20;
    refs[21] = undefined;
    __ref_27.append(__ref_19);
    __ref_27.append(__ref_20);
    const __ref_26 = document.createElement("div");
    refs[26] = __ref_26;
    __ref_26.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_26.setAttribute("class", "dialog-actions");
    const __ref_24 = document.createElement("button");
    refs[24] = __ref_24;
    __ref_24.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_24.addEventListener("click", (event) => {
      const resolved = scope.cancel;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_24.append(document.createTextNode("Cancel"));
    __ref_26.append(__ref_24);
    const __ref_25 = document.createElement("button");
    refs[25] = __ref_25;
    __ref_25.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_25.setAttribute("class", "primary");
    __ref_25.addEventListener("click", (event) => {
      const resolved = scope.submit;
      if (typeof resolved === "function") {
        return runOwnedBoundary(instance, () => resolved(event));
      }
    });
    __ref_25.append(document.createTextNode("Continue"));
    __ref_26.append(__ref_25);
    __ref_27.append(__ref_26);
    __ref_28.append(__ref_27);
    fragment.append(__ref_28);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_0(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
    const __records_13 = refs[13] ?? [];
    for (const record of __records_13) {
      if (record.handle && typeof record.handle.destroy === "function") {
        record.handle.destroy();
      } else if (typeof record.destroy === "function") {
        record.destroy();
      }
    }
    if (refs[21] === true) {
    } else {
    }
  } else {
  }
}

function updateConditional_0(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.props.open);
  if (refs[2] !== next) {
    const previous = refs[2];
    destroyConditionalBranch_0(instance, previous === true);
    refs[2] = next;
    replaceBetween(refs[0], refs[1], createConditionalFragment_0(instance, scope, next));
  }
  if (next) {
    updateRegion_attribute_27_aria_label(instance, scope, refs);
    updateRegion_text_3(instance, scope, refs);
    updateRegion_text_5(instance, scope, refs);
    updateRegion_text_8(instance, scope, refs);
    updateRegion_attribute_17_class(instance, scope, refs);
    updateRegion_loop_11(instance, scope, refs);
    updateRegion_attribute_18_class(instance, scope, refs);
    updateRegion_attribute_18_value(instance, scope, refs);
    updateRegion_conditional_19(instance, scope, refs);
  } else {
  }
}

function createForEntry_11(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment("for:item:start");
  const end = document.createComment("for:item:end");
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ["field"]: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ["field"]: currentItem };
    updateRegion_text_14(instance, loopScope, entryRefs);
    updateRegion_attribute_15_data_path(instance, loopScope, entryRefs);
    updateRegion_attribute_15_data_type(instance, loopScope, entryRefs);
    updateRegion_attribute_15_value(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  const __ref_16 = document.createElement("label");
  entryRefs[16] = __ref_16;
  __ref_16.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
  const __ref_14 = document.createTextNode("");
  entryRefs[14] = __ref_14;
  __ref_16.append(__ref_14);
  const __ref_15 = document.createElement("input");
  entryRefs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
  __ref_16.append(__ref_15);
  fragment.append(__ref_16);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_11(instance, scope) {
  const refs = instance.refs;
  const iterable = (scope.props.fields) ?? [];
  const previous = refs[13] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[12]);
    } else {
      record = createForEntry_11(instance, scope, item, refs[12]);
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
  refs[13] = nextRecords;
}

function createConditionalFragment_19(instance, scope, isConsequent) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  if (isConsequent) {
    const __ref_23 = document.createElement("div");
    refs[23] = __ref_23;
    __ref_23.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
    __ref_23.setAttribute("class", "error");
    const __ref_22 = document.createTextNode("");
    refs[22] = __ref_22;
    __ref_23.append(__ref_22);
    fragment.append(__ref_23);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_19(instance, wasConsequent) {
  const refs = instance.refs;
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_19(instance, scope) {
  const refs = instance.refs;
  const next = Boolean(scope.error);
  if (refs[21] !== next) {
    const previous = refs[21];
    destroyConditionalBranch_19(instance, previous === true);
    refs[21] = next;
    replaceBetween(refs[19], refs[20], createConditionalFragment_19(instance, scope, next));
  }
  if (next) {
    updateRegion_text_22(instance, scope, refs);
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
  let formMode = true;
  let error = "";
  function setPath(target, path, value) {
  if (!path) return value;
  const names = path.split(".");
  let at = target;
  for (const name of names.slice(0, -1)) at = at[name] ??= {};
  at[names[names.length - 1]] = value;
  return target;
  }
  function dialog(event) {
  const root = event.currentTarget.closest("[role=\"dialog\"]");
  if (!root) throw new Error("Input dialog is unavailable");
  return root;
  }
  function formValue(root) {
  let value = props.fields[0]?.path === "" ? undefined : {};
  for (const input of root.querySelectorAll(".schema-form [data-path]")) {
  let field = input.value;
  if (input.dataset.type === "boolean") field = field === "true";
  else if (input.dataset.type === "number" || input.dataset.type === "integer") field = Number(field);
  else if (input.dataset.type === "array" || input.dataset.type === "object") field = JSON.parse(field);
  value = setPath(value, input.dataset.path || "", field);
  }
  return value;
  }
  function getPath(value, path) {
  return path ? path.split(".").reduce((at, name) => at?.[name], value) : value;
  }
  function toggleMode(event) {
  try {
  const root = dialog(event);
  const json = root.querySelector("#contract-input");
  if (formMode) json.value = JSON.stringify(formValue(root), null, 2);
  else {
  const value = JSON.parse(json.value);
  for (const input of root.querySelectorAll(".schema-form [data-path]")) {
  const field = getPath(value, input.dataset.path || "");
  input.value = typeof field === "object" ? JSON.stringify(field) : String(field ?? "");
  }
  }
  formMode = !formMode;
  error = "";
  } catch (cause) {
  error = String(cause);
  }
  }
  function cancel() {
  emit("cancel", null);
  }
  function submit(event) {
  try {
  const root = dialog(event);
  const value = formMode ? formValue(root) : JSON.parse(root.querySelector("#contract-input").value);
  emit("submit", value);
  error = "";
  } catch (cause) {
  error = String(cause);
  }
  }
  props = __weiv_getTrackedRoot("props", props);
  const __weiv_scope = {};
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    __weiv_scope.formMode = formMode;
    __weiv_scope.error = error;
    __weiv_scope.setPath = setPath;
    __weiv_scope.dialog = dialog;
    __weiv_scope.formValue = formValue;
    __weiv_scope.getPath = getPath;
    __weiv_scope.toggleMode = toggleMode;
    __weiv_scope.cancel = cancel;
    __weiv_scope.submit = submit;
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

export const scopeId = "w6EFB62200132AA8B";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.open", parentPathId: 1 }], regions: [{ regionId: 1, trackedPathIds: [2] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_29 = document.createElement("div");
  refs[29] = __ref_29;
  __ref_29.setAttribute("data-weiv-scope", "w6EFB62200132AA8B");
  const __ref_0 = document.createComment("if:start");
  const __ref_1 = document.createComment("if:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  refs[2] = undefined;
  __ref_29.append(__ref_0);
  __ref_29.append(__ref_1);
  fragment.append(__ref_29);
  return fragment;
}

function updateRegion_conditional_0(instance, scope, refs) {
  updateConditional_0(instance, scope);
}
function updateRegion_attribute_27_aria_label(instance, scope, refs) {
  const __value_27_aria_label = scope.props.title;
  if (__value_27_aria_label === false || __value_27_aria_label === null || __value_27_aria_label === undefined) {
    if (refs[27].hasAttribute("aria-label")) { refs[27].removeAttribute("aria-label"); }
  } else if (__value_27_aria_label === true) {
    if (!refs[27].hasAttribute("aria-label")) { refs[27].setAttribute("aria-label", ""); }
  } else {
    refs[27].setAttribute("aria-label", String(__value_27_aria_label));
  }
}
function updateRegion_text_3(instance, scope, refs) {
  const __next_text_3 = String((scope.props.title) ?? "");
  if (refs[3].data !== __next_text_3) {
    refs[3].data = __next_text_3;
  }
}
function updateRegion_text_5(instance, scope, refs) {
  const __next_text_5 = String((scope.props.help) ?? "");
  if (refs[5].data !== __next_text_5) {
    refs[5].data = __next_text_5;
  }
}
function updateRegion_text_8(instance, scope, refs) {
  const __next_text_8 = String((scope.formMode ? 'JSON editor' : 'Generated form') ?? "");
  if (refs[8].data !== __next_text_8) {
    refs[8].data = __next_text_8;
  }
}
function updateRegion_attribute_17_class(instance, scope, refs) {
  const __value_17_class = scope.formMode ? 'schema-form' : 'hidden';
  if (__value_17_class === false || __value_17_class === null || __value_17_class === undefined) {
    if (refs[17].hasAttribute("class")) { refs[17].removeAttribute("class"); }
  } else if (__value_17_class === true) {
    if (!refs[17].hasAttribute("class")) { refs[17].setAttribute("class", ""); }
  } else {
    refs[17].setAttribute("class", String(__value_17_class));
  }
}
function updateRegion_loop_11(instance, scope, refs) {
  updateForLoop_11(instance, scope);
}
function updateRegion_text_14(instance, scope, refs) {
  const __next_text_14 = String((scope.field.label) ?? "");
  if (refs[14].data !== __next_text_14) {
    refs[14].data = __next_text_14;
  }
}
function updateRegion_attribute_15_data_path(instance, scope, refs) {
  const __value_15_data_path = scope.field.path;
  if (__value_15_data_path === false || __value_15_data_path === null || __value_15_data_path === undefined) {
    if (refs[15].hasAttribute("data-path")) { refs[15].removeAttribute("data-path"); }
  } else if (__value_15_data_path === true) {
    if (!refs[15].hasAttribute("data-path")) { refs[15].setAttribute("data-path", ""); }
  } else {
    refs[15].setAttribute("data-path", String(__value_15_data_path));
  }
}
function updateRegion_attribute_15_data_type(instance, scope, refs) {
  const __value_15_data_type = scope.field.type;
  if (__value_15_data_type === false || __value_15_data_type === null || __value_15_data_type === undefined) {
    if (refs[15].hasAttribute("data-type")) { refs[15].removeAttribute("data-type"); }
  } else if (__value_15_data_type === true) {
    if (!refs[15].hasAttribute("data-type")) { refs[15].setAttribute("data-type", ""); }
  } else {
    refs[15].setAttribute("data-type", String(__value_15_data_type));
  }
}
function updateRegion_attribute_15_value(instance, scope, refs) {
  const __value_15_value = scope.field.value;
  const __next_15_value = __value_15_value ?? "";
  const __next_string_15_value = String(__next_15_value);
  if (refs[15].value !== __next_string_15_value) {
    refs[15].value = __next_string_15_value;
  }
  refs[15].setAttribute("value", __next_string_15_value);
}
function updateRegion_attribute_18_class(instance, scope, refs) {
  const __value_18_class = scope.formMode ? 'hidden' : 'json-editor';
  if (__value_18_class === false || __value_18_class === null || __value_18_class === undefined) {
    if (refs[18].hasAttribute("class")) { refs[18].removeAttribute("class"); }
  } else if (__value_18_class === true) {
    if (!refs[18].hasAttribute("class")) { refs[18].setAttribute("class", ""); }
  } else {
    refs[18].setAttribute("class", String(__value_18_class));
  }
}
function updateRegion_attribute_18_value(instance, scope, refs) {
  const __value_18_value = scope.props.initial;
  const __next_18_value = __value_18_value ?? "";
  const __next_string_18_value = String(__next_18_value);
  if (refs[18].value !== __next_string_18_value) {
    refs[18].value = __next_string_18_value;
  }
  refs[18].setAttribute("value", __next_string_18_value);
}
function updateRegion_conditional_19(instance, scope, refs) {
  updateConditional_19(instance, scope);
}
function updateRegion_text_22(instance, scope, refs) {
  const __next_text_22 = String((scope.error) ?? "");
  if (refs[22].data !== __next_text_22) {
    refs[22].data = __next_text_22;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_conditional_0(instance, scope, refs);
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
  if (dirtySet.has("props") || dirtySet.has("formMode") || dirtySet.has("error") || dirtyRegionSet.has(1)) {
    updateRegion_conditional_0(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[2] === true) {
    const __records_13 = refs[13] ?? [];
    for (const record of __records_13) {
      if (record.handle && typeof record.handle.destroy === "function") {
        record.handle.destroy();
      } else if (typeof record.destroy === "function") {
        record.destroy();
      }
    }
    if (refs[21] === true) {
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
