import { isObservable as __weiv_isObservable, createCell as __weiv_createCell, createCellScope as __weiv_createCellScope, unbindCellValue as __weiv_unbindCellValue, normalizeCellValue as __weiv_normalizeCellValue, cellAssignmentTarget as __weiv_cellAssignmentTarget, bindingObject as __weiv_bindingObject, bindingIterator as __weiv_bindingIterator, initializeClassName as __weiv_initializeClassName } from "../__weiv_runtime/cell.js";
import { pretty as __weiv_import_pretty } from "../__weiv_modules/8f9bcec8c215c7a6.mjs";

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
function createConditionalFragment_0(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[0].parentNode?.localName === "foreignObject" ? undefined : refs[0].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_17 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
    refs[17] = __ref_17;
    __ref_17.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
    __ref_17.setAttribute("class", "panel");
    const __ref_3 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
    refs[3] = __ref_3;
    __ref_3.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
    __ref_3.append(document.createTextNode("Interactions"));
    __ref_17.append(__ref_3);
    const __ref_16 = (__ref_17.namespaceURI === "http://www.w3.org/2000/svg" && __ref_17.localName !== "foreignObject") || __ref_17.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[16] = __ref_16;
    __ref_16.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
    __ref_16.setAttribute("class", "stack");
    const __ref_4 = document.createComment("for:start");
    const __ref_5 = document.createComment("for:end");
    refs[4] = __ref_4;
    refs[5] = __ref_5;
    refs[6] = [];
    __ref_16.append(__ref_4);
    __ref_16.append(__ref_5);
    __ref_17.append(__ref_16);
    fragment.append(__ref_17);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_0(instance, refs, wasConsequent) {
  if (wasConsequent) {
    const __records_6 = refs[6] ?? [];
    for (const record of __records_6) {
      if (record.handle && typeof record.handle.destroy === "function") {
        record.handle.destroy();
      } else if (typeof record.destroy === "function") {
        record.destroy();
      }
    }
  } else {
  }
}

function updateConditional_0(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope));
  if (refs[2] !== next) {
    const previous = refs[2];
    destroyConditionalBranch_0(instance, refs, previous === true);
    refs[2] = next;
    replaceBetween(refs[0], refs[1], createConditionalFragment_0(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_loop_4(instance, scope, refs);
  } else {
  }
}

function createForEntry_4(instance, scope, item, reference) {
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
    updateRegion_text_7(instance, loopScope, entryRefs);
    updateRegion_text_9(instance, loopScope, entryRefs);
    updateRegion_attribute_11_class(instance, loopScope, entryRefs);
    updateRegion_attribute_12_class(instance, loopScope, entryRefs);
    updateRegion_attribute_13_class(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = parent.localName === "foreignObject" ? undefined : parent.namespaceURI;
  const __ref_15 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
  __ref_15.setAttribute("class", "entry interaction");
  const __ref_8 = (__ref_15.namespaceURI === "http://www.w3.org/2000/svg" && __ref_15.localName !== "foreignObject") || __ref_15.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "b") : document.createElement("b");
  entryRefs[8] = __ref_8;
  __ref_8.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
  const __ref_7 = document.createTextNode("");
  entryRefs[7] = __ref_7;
  __ref_8.append(__ref_7);
  __ref_15.append(__ref_8);
  const __ref_10 = (__ref_15.namespaceURI === "http://www.w3.org/2000/svg" && __ref_15.localName !== "foreignObject") || __ref_15.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "pre") : document.createElement("pre");
  entryRefs[10] = __ref_10;
  __ref_10.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
  const __ref_9 = document.createTextNode("");
  entryRefs[9] = __ref_9;
  __ref_10.append(__ref_9);
  __ref_15.append(__ref_10);
  const __ref_14 = (__ref_15.namespaceURI === "http://www.w3.org/2000/svg" && __ref_15.localName !== "foreignObject") || __ref_15.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[14] = __ref_14;
  __ref_14.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
  __ref_14.setAttribute("class", "actions");
  const __ref_11 = (__ref_14.namespaceURI === "http://www.w3.org/2000/svg" && __ref_14.localName !== "foreignObject") || __ref_14.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
  entryRefs[11] = __ref_11;
  __ref_11.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
  __ref_11.addEventListener("click", (event) => {
    const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context, event))(loopScope);
    return resolved;
  });
  __ref_11.append(document.createTextNode("\n            Approve\n          "));
  __ref_14.append(__ref_11);
  const __ref_12 = (__ref_14.namespaceURI === "http://www.w3.org/2000/svg" && __ref_14.localName !== "foreignObject") || __ref_14.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
  entryRefs[12] = __ref_12;
  __ref_12.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
  __ref_12.addEventListener("click", (event) => {
    const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context, event))(loopScope);
    return resolved;
  });
  __ref_12.append(document.createTextNode("\n            Deny\n          "));
  __ref_14.append(__ref_12);
  const __ref_13 = (__ref_14.namespaceURI === "http://www.w3.org/2000/svg" && __ref_14.localName !== "foreignObject") || __ref_14.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
  entryRefs[13] = __ref_13;
  __ref_13.setAttribute("data-weiv-scope", "w39D30DD98860A1D8");
  __ref_13.addEventListener("click", (event) => {
    const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context, event))(loopScope);
    return resolved;
  });
  __ref_13.append(document.createTextNode("\n            Reply\n          "));
  __ref_14.append(__ref_13);
  __ref_15.append(__ref_14);
  fragment.append(__ref_15);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_4(instance, scope, refs) {
  const iterable = (((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope)) ?? [];
  const previous = refs[6] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[5]);
    } else {
      record = createForEntry_4(instance, scope, item, refs[5]);
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
  refs[6] = nextRecords;
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
function items() {
	return props.work?.interactions || [];
}
function approve(id) {
	emit("respond", {
		work: props.work.id,
		id,
		response: true
	});
}
function deny(id) {
	emit("respond", {
		work: props.work.id,
		id,
		response: false
	});
}
function reply(item) {
	emit("question", {
		work: props.work.id,
		item
	});
}
;
const __weiv_templateExpressions = [
	(__weiv_context) => {
		return props.work?.interactions?.length;
	},
	(__weiv_context) => {
		return items();
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.type === "approval" ? item.title : item.prompt;
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return __weiv_import_pretty(item.type === "approval" ? item.details : item.response);
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.type === "approval" ? "primary" : "hidden";
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		const item = __weiv_context["item"];
		return approve(item.id);
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.type === "approval" ? "" : "hidden";
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		const item = __weiv_context["item"];
		return deny(item.id);
	},
	(__weiv_context) => {
		const item = __weiv_context["item"];
		return item.type !== "approval" ? "primary" : "hidden";
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		const item = __weiv_context["item"];
		return reply(item);
	}
];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.pretty = __weiv_import_pretty;
    __weiv_scope.props = props;
    __weiv_scope.items = items;
    __weiv_scope.approve = approve;
    __weiv_scope.deny = deny;
    __weiv_scope.reply = reply;
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

export const scopeId = "w39D30DD98860A1D8";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.work", parentPathId: 1 }], regions: [{ regionId: 1, trackedPathIds: [2] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_0 = document.createComment("if:start");
  const __ref_1 = document.createComment("if:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  refs[2] = undefined;
  fragment.append(__ref_0);
  fragment.append(__ref_1);
  return fragment;
}

function updateRegion_conditional_0(instance, scope, refs) {
  updateConditional_0(instance, scope, refs);
}
function updateRegion_loop_4(instance, scope, refs) {
  updateForLoop_4(instance, scope, refs);
}
function updateRegion_text_7(instance, scope, refs) {
  const __next_text_7 = String((((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(scope)) ?? "");
  if (refs[7].data !== __next_text_7) {
    refs[7].data = __next_text_7;
  }
}
function updateRegion_text_9(instance, scope, refs) {
  const __next_text_9 = String((((__weiv_context) => __weiv_context.__weiv_eval[3](__weiv_context))(scope)) ?? "");
  if (refs[9].data !== __next_text_9) {
    refs[9].data = __next_text_9;
  }
}
function updateRegion_attribute_11_class(instance, scope, refs) {
  const __value_11_class = ((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context))(scope);
  if (__value_11_class === false || __value_11_class === null || __value_11_class === undefined) {
    if (refs[11].hasAttribute("class")) { refs[11].removeAttribute("class"); }
  } else if (__value_11_class === true) {
    if (!refs[11].hasAttribute("class")) { refs[11].setAttribute("class", ""); }
  } else {
    refs[11].setAttribute("class", String(__value_11_class));
  }
}
function updateRegion_attribute_12_class(instance, scope, refs) {
  const __value_12_class = ((__weiv_context) => __weiv_context.__weiv_eval[6](__weiv_context))(scope);
  if (__value_12_class === false || __value_12_class === null || __value_12_class === undefined) {
    if (refs[12].hasAttribute("class")) { refs[12].removeAttribute("class"); }
  } else if (__value_12_class === true) {
    if (!refs[12].hasAttribute("class")) { refs[12].setAttribute("class", ""); }
  } else {
    refs[12].setAttribute("class", String(__value_12_class));
  }
}
function updateRegion_attribute_13_class(instance, scope, refs) {
  const __value_13_class = ((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope);
  if (__value_13_class === false || __value_13_class === null || __value_13_class === undefined) {
    if (refs[13].hasAttribute("class")) { refs[13].removeAttribute("class"); }
  } else if (__value_13_class === true) {
    if (!refs[13].hasAttribute("class")) { refs[13].setAttribute("class", ""); }
  } else {
    refs[13].setAttribute("class", String(__value_13_class));
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
  if (dirtySet.has("props") || dirtySet.has("items") || dirtySet.has("pretty") || dirtyRegionSet.has(1)) {
    updateRegion_conditional_0(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[2] === true) {
    const __records_6 = refs[6] ?? [];
    for (const record of __records_6) {
      if (record.handle && typeof record.handle.destroy === "function") {
        record.handle.destroy();
      } else if (typeof record.destroy === "function") {
        record.destroy();
      }
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
