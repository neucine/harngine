import { isObservable as __weiv_isObservable, createCell as __weiv_createCell, createCellScope as __weiv_createCellScope, unbindCellValue as __weiv_unbindCellValue, normalizeCellValue as __weiv_normalizeCellValue, cellAssignmentTarget as __weiv_cellAssignmentTarget, bindingObject as __weiv_bindingObject, bindingIterator as __weiv_bindingIterator, initializeClassName as __weiv_initializeClassName } from "../__weiv_runtime/cell.js";
import * as PageHeader from "../components/PageHeader.mjs";
import * as Status from "../components/Status.mjs";
import { short as __weiv_import_short } from "../__weiv_modules/8f9bcec8c215c7a6.mjs";

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
function mountProjectedSlot_4_0(start, end, ownerInstance) {
  const instance = { refs: [], refresh: () => ownerInstance.refresh(), update: () => ownerInstance.update() };
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = start.parentNode?.localName === "foreignObject" ? undefined : start.parentNode?.namespaceURI;
  const __ref_1 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
  refs[1] = __ref_1;
  __ref_1.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  __ref_1.addEventListener("click", (event) => {
    const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context, event))(instance.refresh());
    return resolved;
  });
  const __ref_0 = document.createTextNode("");
  refs[0] = __ref_0;
  __ref_1.append(__ref_0);
  fragment.append(__ref_1);
  replaceBetween(start, end, fragment);
  function update() {
    const refs = instance.refs;
    const scope = instance.refresh();
    updateRegion_text_0(instance, scope, refs);
  }
  function destroy() {
    const refs = instance.refs;
  }
  update();
  return { update, destroy, start, end };
}

function createForEntry_5(instance, scope, item, reference) {
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
    updateRegion_attribute_17_href(instance, loopScope, entryRefs);
    updateRegion_text_8(instance, loopScope, entryRefs);
    updateRegion_text_10(instance, loopScope, entryRefs);
    updateRegion_attribute_13_title(instance, loopScope, entryRefs);
    updateRegion_text_12(instance, loopScope, entryRefs);
    updateRegion_attribute_15_class(instance, loopScope, entryRefs);
    updateRegion_text_14(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = parent.localName === "foreignObject" ? undefined : parent.namespaceURI;
  const __ref_17 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "a") : document.createElement("a");
  entryRefs[17] = __ref_17;
  __ref_17.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  __ref_17.setAttribute("class", "card");
  const __ref_9 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[9] = __ref_9;
  __ref_9.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  __ref_9.setAttribute("class", "card-kind");
  const __ref_8 = document.createTextNode("");
  entryRefs[8] = __ref_8;
  __ref_9.append(__ref_8);
  __ref_17.append(__ref_9);
  const __ref_11 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
  entryRefs[11] = __ref_11;
  __ref_11.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  const __ref_10 = document.createTextNode("");
  entryRefs[10] = __ref_10;
  __ref_11.append(__ref_10);
  __ref_17.append(__ref_11);
  const __ref_13 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[13] = __ref_13;
  __ref_13.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  __ref_13.setAttribute("class", "muted mono");
  const __ref_12 = document.createTextNode("");
  entryRefs[12] = __ref_12;
  __ref_13.append(__ref_12);
  __ref_17.append(__ref_13);
  const __ref_16 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[16] = __ref_16;
  __ref_16.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  __ref_16.setAttribute("class", "meta");
  const __ref_15 = (__ref_16.namespaceURI === "http://www.w3.org/2000/svg" && __ref_16.localName !== "foreignObject") || __ref_16.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  entryRefs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  const __ref_14 = document.createTextNode("");
  entryRefs[14] = __ref_14;
  __ref_15.append(__ref_14);
  __ref_16.append(__ref_15);
  __ref_17.append(__ref_16);
  fragment.append(__ref_17);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_5(instance, scope, refs) {
  const iterable = (((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context))(scope)) ?? [];
  const previous = refs[7] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[6]);
    } else {
      record = createForEntry_5(instance, scope, item, refs[6]);
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
  refs[7] = nextRecords;
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
function path(item) {
	return "/definitions/" + [
		item.type,
		item.id,
		item.revision
	].map(encodeURIComponent).join("/");
}
function toggle() {
	emit("toggle-history", null);
}
;
const __weiv_templateExpressions = [
	(__weiv_context) => {
		return "Definitions";
	},
	(__weiv_context) => {
		return props.history ? "Browse current and historical immutable revisions." : "Agents, Workflows, and Tools available to this App.";
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return toggle?.(__weiv_argument);
	},
	(__weiv_context) => {
		return props.history ? "Show current only" : "View revision history";
	},
	(__weiv_context) => {
		return props.items;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return path(item);
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.type;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.id;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.revision;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return __weiv_import_short(item.revision);
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return "pill " + item.availability;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.availability;
	}
];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.short = __weiv_import_short;
    __weiv_scope.props = props;
    __weiv_scope.path = path;
    __weiv_scope.toggle = toggle;
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

export const scopeId = "w7BB6712D8BE61105";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.history", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.items", parentPathId: 1 }], regions: [{ regionId: 1, trackedPathIds: [2] }, { regionId: 2, trackedPathIds: [3] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_19 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[19] = __ref_19;
  __ref_19.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  const __ref_2 = document.createComment("component:start");
  const __ref_3 = document.createComment("component:end");
  refs[2] = __ref_2;
  refs[3] = __ref_3;
  __ref_19.append(__ref_2);
  __ref_19.append(__ref_3);
  const __props_4 = {"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(instance.refresh()), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(instance.refresh())};
  const __slots_4 = { default: { mountIntoBoundary: (start, end) => mountProjectedSlot_4_0(start, end, instance) } };
  refs[4] = PageHeader.mountIntoBoundary(__ref_2, __ref_3, __props_4, undefined, __slots_4);
  const __ref_18 = (__ref_19.namespaceURI === "http://www.w3.org/2000/svg" && __ref_19.localName !== "foreignObject") || __ref_19.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[18] = __ref_18;
  __ref_18.setAttribute("data-weiv-scope", "w7BB6712D8BE61105");
  __ref_18.setAttribute("class", "grid");
  const __ref_5 = document.createComment("for:start");
  const __ref_6 = document.createComment("for:end");
  refs[5] = __ref_5;
  refs[6] = __ref_6;
  refs[7] = [];
  __ref_18.append(__ref_5);
  __ref_18.append(__ref_6);
  __ref_19.append(__ref_18);
  fragment.append(__ref_19);
  return fragment;
}

function updateRegion_child_4(instance, scope, refs) {
  if (!refs[4]) return;
  refs[4].setProps({"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope)});
  refs[4].setSlots({ default: { mountIntoBoundary: (start, end) => mountProjectedSlot_4_0(start, end, instance) } });
  refs[4].update();
}
function updateRegion_text_0(instance, scope, refs) {
  const __next_text_0 = String((((__weiv_context) => __weiv_context.__weiv_eval[3](__weiv_context))(scope)) ?? "");
  if (refs[0].data !== __next_text_0) {
    refs[0].data = __next_text_0;
  }
}
function updateRegion_loop_5(instance, scope, refs) {
  updateForLoop_5(instance, scope, refs);
}
function updateRegion_attribute_17_href(instance, scope, refs) {
  const __value_17_href = ((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context))(scope);
  if (__value_17_href === false || __value_17_href === null || __value_17_href === undefined) {
    if (refs[17].hasAttribute("href")) { refs[17].removeAttribute("href"); }
  } else if (__value_17_href === true) {
    if (!refs[17].hasAttribute("href")) { refs[17].setAttribute("href", ""); }
  } else {
    refs[17].setAttribute("href", String(__value_17_href));
  }
}
function updateRegion_text_8(instance, scope, refs) {
  const __next_text_8 = String((((__weiv_context) => __weiv_context.__weiv_eval[6](__weiv_context))(scope)) ?? "");
  if (refs[8].data !== __next_text_8) {
    refs[8].data = __next_text_8;
  }
}
function updateRegion_text_10(instance, scope, refs) {
  const __next_text_10 = String((((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context))(scope)) ?? "");
  if (refs[10].data !== __next_text_10) {
    refs[10].data = __next_text_10;
  }
}
function updateRegion_attribute_13_title(instance, scope, refs) {
  const __value_13_title = ((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope);
  if (__value_13_title === false || __value_13_title === null || __value_13_title === undefined) {
    if (refs[13].hasAttribute("title")) { refs[13].removeAttribute("title"); }
  } else if (__value_13_title === true) {
    if (!refs[13].hasAttribute("title")) { refs[13].setAttribute("title", ""); }
  } else {
    refs[13].setAttribute("title", String(__value_13_title));
  }
}
function updateRegion_text_12(instance, scope, refs) {
  const __next_text_12 = String((((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context))(scope)) ?? "");
  if (refs[12].data !== __next_text_12) {
    refs[12].data = __next_text_12;
  }
}
function updateRegion_attribute_15_class(instance, scope, refs) {
  const __value_15_class = ((__weiv_context) => __weiv_context.__weiv_eval[10](__weiv_context))(scope);
  if (__value_15_class === false || __value_15_class === null || __value_15_class === undefined) {
    if (refs[15].hasAttribute("class")) { refs[15].removeAttribute("class"); }
  } else if (__value_15_class === true) {
    if (!refs[15].hasAttribute("class")) { refs[15].setAttribute("class", ""); }
  } else {
    refs[15].setAttribute("class", String(__value_15_class));
  }
}
function updateRegion_text_14(instance, scope, refs) {
  const __next_text_14 = String((((__weiv_context) => __weiv_context.__weiv_eval[11](__weiv_context))(scope)) ?? "");
  if (refs[14].data !== __next_text_14) {
    refs[14].data = __next_text_14;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_4(instance, scope, refs);
  updateRegion_loop_5(instance, scope, refs);
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
    updateRegion_child_4(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtySet.has("path") || dirtySet.has("short") || dirtyRegionSet.has(2)) {
    updateRegion_loop_5(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[4] && typeof refs[4].destroy === "function") {
    refs[4].destroy();
  }
  refs[4] = undefined;
  const __records_7 = refs[7] ?? [];
  for (const record of __records_7) {
    if (record.handle && typeof record.handle.destroy === "function") {
      record.handle.destroy();
    } else if (typeof record.destroy === "function") {
      record.destroy();
    }
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
