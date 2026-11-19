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
function createConditionalFragment_3(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[3].parentNode?.localName === "foreignObject" ? undefined : refs[3].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_21 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[21] = __ref_21;
    __ref_21.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
    __ref_21.setAttribute("class", "grid");
    const __ref_6 = document.createComment("for:start");
    const __ref_7 = document.createComment("for:end");
    refs[6] = __ref_6;
    refs[7] = __ref_7;
    refs[8] = [];
    __ref_21.append(__ref_6);
    __ref_21.append(__ref_7);
    fragment.append(__ref_21);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_3(instance, refs, wasConsequent) {
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

function updateConditional_3(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(scope));
  if (refs[5] !== next) {
    const previous = refs[5];
    destroyConditionalBranch_3(instance, refs, previous === true);
    refs[5] = next;
    replaceBetween(refs[3], refs[4], createConditionalFragment_3(instance, scope, refs, next));
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
    updateRegion_attribute_20_href(instance, loopScope, entryRefs);
    updateRegion_text_9(instance, loopScope, entryRefs);
    updateRegion_text_11(instance, loopScope, entryRefs);
    updateRegion_text_13(instance, loopScope, entryRefs);
    updateRegion_attribute_16_class(instance, loopScope, entryRefs);
    updateRegion_text_15(instance, loopScope, entryRefs);
    updateRegion_text_17(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = parent.localName === "foreignObject" ? undefined : parent.namespaceURI;
  const __ref_20 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "a") : document.createElement("a");
  entryRefs[20] = __ref_20;
  __ref_20.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
  __ref_20.setAttribute("class", "card");
  const __ref_10 = (__ref_20.namespaceURI === "http://www.w3.org/2000/svg" && __ref_20.localName !== "foreignObject") || __ref_20.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[10] = __ref_10;
  __ref_10.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
  __ref_10.setAttribute("class", "card-kind");
  const __ref_9 = document.createTextNode("");
  entryRefs[9] = __ref_9;
  __ref_10.append(__ref_9);
  __ref_10.append(document.createTextNode(" Work"));
  __ref_20.append(__ref_10);
  const __ref_12 = (__ref_20.namespaceURI === "http://www.w3.org/2000/svg" && __ref_20.localName !== "foreignObject") || __ref_20.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
  entryRefs[12] = __ref_12;
  __ref_12.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
  const __ref_11 = document.createTextNode("");
  entryRefs[11] = __ref_11;
  __ref_12.append(__ref_11);
  __ref_20.append(__ref_12);
  const __ref_14 = (__ref_20.namespaceURI === "http://www.w3.org/2000/svg" && __ref_20.localName !== "foreignObject") || __ref_20.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[14] = __ref_14;
  __ref_14.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
  __ref_14.setAttribute("class", "muted");
  const __ref_13 = document.createTextNode("");
  entryRefs[13] = __ref_13;
  __ref_14.append(__ref_13);
  __ref_20.append(__ref_14);
  const __ref_19 = (__ref_20.namespaceURI === "http://www.w3.org/2000/svg" && __ref_20.localName !== "foreignObject") || __ref_20.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[19] = __ref_19;
  __ref_19.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
  __ref_19.setAttribute("class", "meta");
  const __ref_16 = (__ref_19.namespaceURI === "http://www.w3.org/2000/svg" && __ref_19.localName !== "foreignObject") || __ref_19.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  entryRefs[16] = __ref_16;
  __ref_16.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
  const __ref_15 = document.createTextNode("");
  entryRefs[15] = __ref_15;
  __ref_16.append(__ref_15);
  __ref_19.append(__ref_16);
  const __ref_18 = (__ref_19.namespaceURI === "http://www.w3.org/2000/svg" && __ref_19.localName !== "foreignObject") || __ref_19.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  entryRefs[18] = __ref_18;
  __ref_18.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
  __ref_18.setAttribute("class", "muted mono");
  const __ref_17 = document.createTextNode("");
  entryRefs[17] = __ref_17;
  __ref_18.append(__ref_17);
  __ref_19.append(__ref_18);
  __ref_20.append(__ref_19);
  fragment.append(__ref_20);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_6(instance, scope, refs) {
  const iterable = (((__weiv_context) => __weiv_context.__weiv_eval[3](__weiv_context))(scope)) ?? [];
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

function createConditionalFragment_22(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[22].parentNode?.localName === "foreignObject" ? undefined : refs[22].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_27 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[27] = __ref_27;
    __ref_27.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
    __ref_27.setAttribute("class", "empty");
    const __ref_25 = (__ref_27.namespaceURI === "http://www.w3.org/2000/svg" && __ref_27.localName !== "foreignObject") || __ref_27.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
    refs[25] = __ref_25;
    __ref_25.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
    __ref_25.append(document.createTextNode("No Work yet"));
    __ref_27.append(__ref_25);
    const __ref_26 = (__ref_27.namespaceURI === "http://www.w3.org/2000/svg" && __ref_27.localName !== "foreignObject") || __ref_27.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "p") : document.createElement("p");
    refs[26] = __ref_26;
    __ref_26.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
    __ref_26.append(document.createTextNode("Start an Agent or Workflow from Definitions."));
    __ref_27.append(__ref_26);
    fragment.append(__ref_27);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_22(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_22(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[11](__weiv_context))(scope));
  if (refs[24] !== next) {
    const previous = refs[24];
    destroyConditionalBranch_22(instance, refs, previous === true);
    refs[24] = next;
    replaceBetween(refs[22], refs[23], createConditionalFragment_22(instance, scope, refs, next));
  }
  if (next) {
  } else {
  }
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
const __weiv_templateExpressions = [
	(__weiv_context) => {
		return "Work";
	},
	(__weiv_context) => {
		return "Every durable execution, from accepted objective to result.";
	},
	(__weiv_context) => {
		return props.items.length;
	},
	(__weiv_context) => {
		return props.items;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.url;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.definition.type;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return typeof item.objective === "string" ? item.objective : "Structured objective";
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.definition.id;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return "pill " + item.status;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.status;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return __weiv_import_short(item.id);
	},
	(__weiv_context) => {
		return !props.items.length;
	}
];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.short = __weiv_import_short;
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

export const scopeId = "wD5BC85E10A84A266";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.items", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.items.length", parentPathId: 2 }], regions: [{ regionId: 2, trackedPathIds: [3] }, { regionId: 3, trackedPathIds: [3] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_28 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[28] = __ref_28;
  __ref_28.setAttribute("data-weiv-scope", "wD5BC85E10A84A266");
  const __ref_0 = document.createComment("component:start");
  const __ref_1 = document.createComment("component:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  __ref_28.append(__ref_0);
  __ref_28.append(__ref_1);
  const __props_2 = {"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(instance.refresh()), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(instance.refresh())};
  refs[2] = PageHeader.mountIntoBoundary(__ref_0, __ref_1, __props_2, undefined, undefined);
  const __ref_3 = document.createComment("if:start");
  const __ref_4 = document.createComment("if:end");
  refs[3] = __ref_3;
  refs[4] = __ref_4;
  refs[5] = undefined;
  __ref_28.append(__ref_3);
  __ref_28.append(__ref_4);
  const __ref_22 = document.createComment("if:start");
  const __ref_23 = document.createComment("if:end");
  refs[22] = __ref_22;
  refs[23] = __ref_23;
  refs[24] = undefined;
  __ref_28.append(__ref_22);
  __ref_28.append(__ref_23);
  fragment.append(__ref_28);
  return fragment;
}

function updateRegion_child_2(instance, scope, refs) {
  if (!refs[2]) return;
  refs[2].setProps({"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope)});
  refs[2].update();
}
function updateRegion_conditional_3(instance, scope, refs) {
  updateConditional_3(instance, scope, refs);
}
function updateRegion_loop_6(instance, scope, refs) {
  updateForLoop_6(instance, scope, refs);
}
function updateRegion_attribute_20_href(instance, scope, refs) {
  const __value_20_href = ((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context))(scope);
  if (__value_20_href === false || __value_20_href === null || __value_20_href === undefined) {
    if (refs[20].hasAttribute("href")) { refs[20].removeAttribute("href"); }
  } else if (__value_20_href === true) {
    if (!refs[20].hasAttribute("href")) { refs[20].setAttribute("href", ""); }
  } else {
    refs[20].setAttribute("href", String(__value_20_href));
  }
}
function updateRegion_text_9(instance, scope, refs) {
  const __next_text_9 = String((((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context))(scope)) ?? "");
  if (refs[9].data !== __next_text_9) {
    refs[9].data = __next_text_9;
  }
}
function updateRegion_text_11(instance, scope, refs) {
  const __next_text_11 = String((((__weiv_context) => __weiv_context.__weiv_eval[6](__weiv_context))(scope)) ?? "");
  if (refs[11].data !== __next_text_11) {
    refs[11].data = __next_text_11;
  }
}
function updateRegion_text_13(instance, scope, refs) {
  const __next_text_13 = String((((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context))(scope)) ?? "");
  if (refs[13].data !== __next_text_13) {
    refs[13].data = __next_text_13;
  }
}
function updateRegion_attribute_16_class(instance, scope, refs) {
  const __value_16_class = ((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope);
  if (__value_16_class === false || __value_16_class === null || __value_16_class === undefined) {
    if (refs[16].hasAttribute("class")) { refs[16].removeAttribute("class"); }
  } else if (__value_16_class === true) {
    if (!refs[16].hasAttribute("class")) { refs[16].setAttribute("class", ""); }
  } else {
    refs[16].setAttribute("class", String(__value_16_class));
  }
}
function updateRegion_text_15(instance, scope, refs) {
  const __next_text_15 = String((((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context))(scope)) ?? "");
  if (refs[15].data !== __next_text_15) {
    refs[15].data = __next_text_15;
  }
}
function updateRegion_text_17(instance, scope, refs) {
  const __next_text_17 = String((((__weiv_context) => __weiv_context.__weiv_eval[10](__weiv_context))(scope)) ?? "");
  if (refs[17].data !== __next_text_17) {
    refs[17].data = __next_text_17;
  }
}
function updateRegion_conditional_22(instance, scope, refs) {
  updateConditional_22(instance, scope, refs);
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_2(instance, scope, refs);
  updateRegion_conditional_3(instance, scope, refs);
  updateRegion_conditional_22(instance, scope, refs);
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
  if (dirtyRegionSet.has(1)) {
    updateRegion_child_2(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtySet.has("short") || dirtyRegionSet.has(2)) {
    updateRegion_conditional_3(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(3)) {
    updateRegion_conditional_22(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[2] && typeof refs[2].destroy === "function") {
    refs[2].destroy();
  }
  refs[2] = undefined;
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
  if (refs[24] === true) {
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
