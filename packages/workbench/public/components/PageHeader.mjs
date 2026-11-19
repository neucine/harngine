import { isObservable as __weiv_isObservable, createCell as __weiv_createCell, createCellScope as __weiv_createCellScope, unbindCellValue as __weiv_unbindCellValue, normalizeCellValue as __weiv_normalizeCellValue, cellAssignmentTarget as __weiv_cellAssignmentTarget, bindingObject as __weiv_bindingObject, bindingIterator as __weiv_bindingIterator, initializeClassName as __weiv_initializeClassName } from "../__weiv_runtime/cell.js";
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

function normalizeDirtyState(dirtyState) {
  if (Array.isArray(dirtyState)) {
    return { bindings: dirtyState, paths: [], preciseBindings: [] };
  }
  if (!dirtyState || typeof dirtyState !== "object") {
    return { bindings: [], paths: [], preciseBindings: [] };
  }
  return {
    bindings: Array.isArray(dirtyState.bindings) ? dirtyState.bindings : [],
    paths: Array.isArray(dirtyState.paths) ? dirtyState.paths : [],
    preciseBindings: Array.isArray(dirtyState.preciseBindings) ? dirtyState.preciseBindings : [],
  };
}
function createSlotFallbackFragment_7(instance, scope) {
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[5].parentNode?.localName === "foreignObject" ? undefined : refs[5].parentNode?.namespaceURI;
  return fragment;
}

function setup(__weiv_props, __weiv_event_handlers = {}) {
  const __weiv_propsCell = __weiv_createCell(__weiv_props);
  let props = __weiv_propsCell.value;
  let __weiv_handlers = __weiv_event_handlers;  const emit = (name, payload) => {
    if (typeof __weiv_handlers[name] === "function") {
      return __weiv_handlers[name](payload);
    }
    return undefined;
  };
;
const __weiv_templateExpressions = [(__weiv_context) => {
	return props.title;
}, (__weiv_context) => {
	return props.subtitle;
}];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    return __weiv_scope;
  }
  function __weiv_setProps(nextProps) {
    __weiv_propsCell.value = nextProps;
    props = __weiv_propsCell.value;
  }
  function __weiv_setEventHandlers(nextHandlers) {
    __weiv_handlers = nextHandlers;
  }
  function __weiv_subscribeImportedObservables(__weiv_instance) {
    const __weiv_cellScope = __weiv_createCellScope((dirty) => { if (!__weiv_instance.destroyed) __weiv_instance.updateDirty({ bindings: [...dirty], paths: [] }, __weiv_instance.refresh()); });
    __weiv_cellScope.watch(__weiv_propsCell, "props");
    return () => __weiv_cellScope.dispose();
  }
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "w31DF7D7255E0F7F1";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.title", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.subtitle", parentPathId: 1 }], regions: [{ regionId: 1, trackedPathIds: [2] }, { regionId: 2, trackedPathIds: [3] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_9 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[9] = __ref_9;
  __ref_9.setAttribute("data-weiv-scope", "w31DF7D7255E0F7F1");
  __ref_9.setAttribute("class", "top");
  const __ref_4 = (__ref_9.namespaceURI === "http://www.w3.org/2000/svg" && __ref_9.localName !== "foreignObject") || __ref_9.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[4] = __ref_4;
  __ref_4.setAttribute("data-weiv-scope", "w31DF7D7255E0F7F1");
  const __ref_1 = (__ref_4.namespaceURI === "http://www.w3.org/2000/svg" && __ref_4.localName !== "foreignObject") || __ref_4.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h1") : document.createElement("h1");
  refs[1] = __ref_1;
  __ref_1.setAttribute("data-weiv-scope", "w31DF7D7255E0F7F1");
  const __ref_0 = document.createTextNode("");
  refs[0] = __ref_0;
  __ref_1.append(__ref_0);
  __ref_4.append(__ref_1);
  const __ref_3 = (__ref_4.namespaceURI === "http://www.w3.org/2000/svg" && __ref_4.localName !== "foreignObject") || __ref_4.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[3] = __ref_3;
  __ref_3.setAttribute("data-weiv-scope", "w31DF7D7255E0F7F1");
  __ref_3.setAttribute("class", "sub");
  const __ref_2 = document.createTextNode("");
  refs[2] = __ref_2;
  __ref_3.append(__ref_2);
  __ref_4.append(__ref_3);
  __ref_9.append(__ref_4);
  const __ref_8 = (__ref_9.namespaceURI === "http://www.w3.org/2000/svg" && __ref_9.localName !== "foreignObject") || __ref_9.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[8] = __ref_8;
  __ref_8.setAttribute("data-weiv-scope", "w31DF7D7255E0F7F1");
  __ref_8.setAttribute("class", "actions");
  const __ref_5 = document.createComment("slot:start");
  const __ref_6 = document.createComment("slot:end");
  refs[5] = __ref_5;
  refs[6] = __ref_6;
  refs[7] = false;
  __ref_8.append(__ref_5);
  __ref_8.append(__ref_6);
  const __slot_7 = instance.slots?.default;
  if (__slot_7) {
    refs[7] = __slot_7.mountIntoBoundary(__ref_5, __ref_6);
  } else {
    replaceBetween(__ref_5, __ref_6, createSlotFallbackFragment_7(instance, instance.refresh()));
  }
  __ref_9.append(__ref_8);
  fragment.append(__ref_9);
  return fragment;
}

function updateRegion_text_0(instance, scope, refs) {
  const __next_text_0 = String((((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope)) ?? "");
  if (refs[0].data !== __next_text_0) {
    refs[0].data = __next_text_0;
  }
}
function updateRegion_text_2(instance, scope, refs) {
  const __next_text_2 = String((((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope)) ?? "");
  if (refs[2].data !== __next_text_2) {
    refs[2].data = __next_text_2;
  }
}
function updateRegion_slot_7(instance, scope, refs) {
  const __next_slot_7 = instance.slots?.default;
  const __current_slot_7 = refs[7];
  if (__next_slot_7) {
    if (__current_slot_7 && __current_slot_7 !== false) {
      __current_slot_7.update();
    } else {
      refs[7] = __next_slot_7.mountIntoBoundary(refs[5], refs[6]);
    }
  } else {
    if (__current_slot_7 !== false) {
      if (__current_slot_7 && typeof __current_slot_7.destroy === "function") { __current_slot_7.destroy(); }
      refs[7] = false;
      replaceBetween(refs[5], refs[6], createSlotFallbackFragment_7(instance, scope));
    }
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_text_0(instance, scope, refs);
  updateRegion_text_2(instance, scope, refs);
  updateRegion_slot_7(instance, scope, refs);
}

function updateDirtyRegions(instance, dirtyState, scope = instance.refresh()) {
  const refs = instance.refs;
  const normalizedDirtyState = normalizeDirtyState(dirtyState);
  const dirtySet = new Set(normalizedDirtyState.bindings);
  const preciseBindingSet = new Set(normalizedDirtyState.preciseBindings);
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
    updateRegion_text_0(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(2)) {
    updateRegion_text_2(instance, scope, refs);
  }
  if (dirtyRegionSet.has(3)) {
    updateRegion_slot_7(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  const __destroy_slot_7 = refs[7];
  if (__destroy_slot_7 && __destroy_slot_7 !== false && typeof __destroy_slot_7.destroy === "function") {
    __destroy_slot_7.destroy();
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
    subscribeImportedObservables: base.subscribeImportedObservables,
    slots,
    setSlots: (nextSlots = {}) => { instance.slots = nextSlots; },
    refs: [],
    destroyed: false,
    update: () => {},
    updateDirty: () => {},
    destroy: () => {},
  };
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
  instance.destroy = () => { if (typeof __weiv_unsubscribeImportedObservables === "function") __weiv_unsubscribeImportedObservables(); instance.destroyed = true; destroyDom(instance); replaceBetween(start, end, document.createDocumentFragment()); };
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
