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
function setup(__weiv_props, __weiv_event_handlers = {}) {
  const __weiv_propsCell = __weiv_createCell(__weiv_props);
  let props = __weiv_propsCell.value;
  let __weiv_handlers = __weiv_event_handlers;  const emit = (name, payload) => {
    if (typeof __weiv_handlers[name] === "function") {
      return __weiv_handlers[name](payload);
    }
    return undefined;
  };
function navClass(name) {
	return props.active === name ? "active" : "";
}
;
const __weiv_templateExpressions = [
	(__weiv_context) => {
		return navClass("definitions");
	},
	(__weiv_context) => {
		return navClass("sessions");
	},
	(__weiv_context) => {
		return navClass("work");
	},
	(__weiv_context) => {
		return navClass("audit");
	},
	(__weiv_context) => {
		return props.connected ? "● Connected" : "● Reconnecting";
	},
	(__weiv_context) => {
		return props.note;
	}
];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    __weiv_scope.navClass = navClass;
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

export const scopeId = "w928AB97E31C16E4A";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.connected", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.note", parentPathId: 1 }], regions: [{ regionId: 5, trackedPathIds: [2] }, { regionId: 6, trackedPathIds: [3] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_17 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "aside") : document.createElement("aside");
  refs[17] = __ref_17;
  __ref_17.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_17.setAttribute("class", "side");
  const __ref_5 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[5] = __ref_5;
  __ref_5.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_5.setAttribute("class", "brand");
  const __ref_0 = (__ref_5.namespaceURI === "http://www.w3.org/2000/svg" && __ref_5.localName !== "foreignObject") || __ref_5.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[0] = __ref_0;
  __ref_0.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_0.setAttribute("class", "brand-mark");
  __ref_0.append(document.createTextNode("H"));
  __ref_5.append(__ref_0);
  const __ref_4 = (__ref_5.namespaceURI === "http://www.w3.org/2000/svg" && __ref_5.localName !== "foreignObject") || __ref_5.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[4] = __ref_4;
  __ref_4.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  const __ref_2 = (__ref_4.namespaceURI === "http://www.w3.org/2000/svg" && __ref_4.localName !== "foreignObject") || __ref_4.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[2] = __ref_2;
  __ref_2.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_2.setAttribute("class", "brand-name");
  __ref_2.append(document.createTextNode("Harngine "));
  const __ref_1 = (__ref_2.namespaceURI === "http://www.w3.org/2000/svg" && __ref_2.localName !== "foreignObject") || __ref_2.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[1] = __ref_1;
  __ref_1.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_1.append(document.createTextNode("Workbench"));
  __ref_2.append(__ref_1);
  __ref_4.append(__ref_2);
  const __ref_3 = (__ref_4.namespaceURI === "http://www.w3.org/2000/svg" && __ref_4.localName !== "foreignObject") || __ref_4.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[3] = __ref_3;
  __ref_3.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_3.setAttribute("class", "brand-note");
  __ref_3.append(document.createTextNode("Agent runtime console"));
  __ref_4.append(__ref_3);
  __ref_5.append(__ref_4);
  __ref_17.append(__ref_5);
  const __ref_10 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "nav") : document.createElement("nav");
  refs[10] = __ref_10;
  __ref_10.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_10.setAttribute("aria-label", "Workbench navigation");
  const __ref_6 = (__ref_10.namespaceURI === "http://www.w3.org/2000/svg" && __ref_10.localName !== "foreignObject") || __ref_10.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "a") : document.createElement("a");
  refs[6] = __ref_6;
  __ref_6.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_6.setAttribute("href", "/definitions");
  __ref_6.setAttribute("data-nav", "definitions");
  __ref_6.append(document.createTextNode("Definitions"));
  __ref_10.append(__ref_6);
  const __ref_7 = (__ref_10.namespaceURI === "http://www.w3.org/2000/svg" && __ref_10.localName !== "foreignObject") || __ref_10.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "a") : document.createElement("a");
  refs[7] = __ref_7;
  __ref_7.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_7.setAttribute("href", "/sessions");
  __ref_7.setAttribute("data-nav", "sessions");
  __ref_7.append(document.createTextNode("Sessions"));
  __ref_10.append(__ref_7);
  const __ref_8 = (__ref_10.namespaceURI === "http://www.w3.org/2000/svg" && __ref_10.localName !== "foreignObject") || __ref_10.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "a") : document.createElement("a");
  refs[8] = __ref_8;
  __ref_8.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_8.setAttribute("href", "/work");
  __ref_8.setAttribute("data-nav", "work");
  __ref_8.append(document.createTextNode("Work"));
  __ref_10.append(__ref_8);
  const __ref_9 = (__ref_10.namespaceURI === "http://www.w3.org/2000/svg" && __ref_10.localName !== "foreignObject") || __ref_10.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "a") : document.createElement("a");
  refs[9] = __ref_9;
  __ref_9.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_9.setAttribute("href", "/audit");
  __ref_9.setAttribute("data-nav", "audit");
  __ref_9.append(document.createTextNode("Audit"));
  __ref_10.append(__ref_9);
  __ref_17.append(__ref_10);
  const __ref_16 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[16] = __ref_16;
  __ref_16.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_16.setAttribute("class", "connection");
  const __ref_12 = (__ref_16.namespaceURI === "http://www.w3.org/2000/svg" && __ref_16.localName !== "foreignObject") || __ref_16.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "b") : document.createElement("b");
  refs[12] = __ref_12;
  __ref_12.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  const __ref_11 = document.createTextNode("");
  refs[11] = __ref_11;
  __ref_12.append(__ref_11);
  __ref_16.append(__ref_12);
  const __ref_13 = (__ref_16.namespaceURI === "http://www.w3.org/2000/svg" && __ref_16.localName !== "foreignObject") || __ref_16.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "br") : document.createElement("br");
  refs[13] = __ref_13;
  __ref_13.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_16.append(__ref_13);
  const __ref_15 = (__ref_16.namespaceURI === "http://www.w3.org/2000/svg" && __ref_16.localName !== "foreignObject") || __ref_16.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "w928AB97E31C16E4A");
  __ref_15.setAttribute("class", "connection-note");
  const __ref_14 = document.createTextNode("");
  refs[14] = __ref_14;
  __ref_15.append(__ref_14);
  __ref_16.append(__ref_15);
  __ref_17.append(__ref_16);
  fragment.append(__ref_17);
  return fragment;
}

function updateRegion_attribute_6_class(instance, scope, refs) {
  const __value_6_class = ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope);
  if (__value_6_class === false || __value_6_class === null || __value_6_class === undefined) {
    if (refs[6].hasAttribute("class")) { refs[6].removeAttribute("class"); }
  } else if (__value_6_class === true) {
    if (!refs[6].hasAttribute("class")) { refs[6].setAttribute("class", ""); }
  } else {
    refs[6].setAttribute("class", String(__value_6_class));
  }
}
function updateRegion_attribute_7_class(instance, scope, refs) {
  const __value_7_class = ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope);
  if (__value_7_class === false || __value_7_class === null || __value_7_class === undefined) {
    if (refs[7].hasAttribute("class")) { refs[7].removeAttribute("class"); }
  } else if (__value_7_class === true) {
    if (!refs[7].hasAttribute("class")) { refs[7].setAttribute("class", ""); }
  } else {
    refs[7].setAttribute("class", String(__value_7_class));
  }
}
function updateRegion_attribute_8_class(instance, scope, refs) {
  const __value_8_class = ((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(scope);
  if (__value_8_class === false || __value_8_class === null || __value_8_class === undefined) {
    if (refs[8].hasAttribute("class")) { refs[8].removeAttribute("class"); }
  } else if (__value_8_class === true) {
    if (!refs[8].hasAttribute("class")) { refs[8].setAttribute("class", ""); }
  } else {
    refs[8].setAttribute("class", String(__value_8_class));
  }
}
function updateRegion_attribute_9_class(instance, scope, refs) {
  const __value_9_class = ((__weiv_context) => __weiv_context.__weiv_eval[3](__weiv_context))(scope);
  if (__value_9_class === false || __value_9_class === null || __value_9_class === undefined) {
    if (refs[9].hasAttribute("class")) { refs[9].removeAttribute("class"); }
  } else if (__value_9_class === true) {
    if (!refs[9].hasAttribute("class")) { refs[9].setAttribute("class", ""); }
  } else {
    refs[9].setAttribute("class", String(__value_9_class));
  }
}
function updateRegion_text_11(instance, scope, refs) {
  const __next_text_11 = String((((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context))(scope)) ?? "");
  if (refs[11].data !== __next_text_11) {
    refs[11].data = __next_text_11;
  }
}
function updateRegion_text_14(instance, scope, refs) {
  const __next_text_14 = String((((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context))(scope)) ?? "");
  if (refs[14].data !== __next_text_14) {
    refs[14].data = __next_text_14;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_attribute_6_class(instance, scope, refs);
  updateRegion_attribute_7_class(instance, scope, refs);
  updateRegion_attribute_8_class(instance, scope, refs);
  updateRegion_attribute_9_class(instance, scope, refs);
  updateRegion_text_11(instance, scope, refs);
  updateRegion_text_14(instance, scope, refs);
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
  if (dirtySet.has("navClass") || dirtySet.has("props") || dirtyRegionSet.has(1)) {
    updateRegion_attribute_6_class(instance, scope, refs);
  }
  if (dirtySet.has("navClass") || dirtySet.has("props") || dirtyRegionSet.has(2)) {
    updateRegion_attribute_7_class(instance, scope, refs);
  }
  if (dirtySet.has("navClass") || dirtySet.has("props") || dirtyRegionSet.has(3)) {
    updateRegion_attribute_8_class(instance, scope, refs);
  }
  if (dirtySet.has("navClass") || dirtySet.has("props") || dirtyRegionSet.has(4)) {
    updateRegion_attribute_9_class(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(5)) {
    updateRegion_text_11(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(6)) {
    updateRegion_text_14(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
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
