import { isObservable as __weiv_isObservable, createCell as __weiv_createCell, createCellScope as __weiv_createCellScope, unbindCellValue as __weiv_unbindCellValue, normalizeCellValue as __weiv_normalizeCellValue, cellAssignmentTarget as __weiv_cellAssignmentTarget, bindingObject as __weiv_bindingObject, bindingIterator as __weiv_bindingIterator, initializeClassName as __weiv_initializeClassName } from "../__weiv_runtime/cell.js";
import * as PageHeader from "../components/PageHeader.mjs";
import * as Status from "../components/Status.mjs";
import { pretty as __weiv_import_pretty } from "../__weiv_modules/8f9bcec8c215c7a6.mjs";
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
function createConditionalFragment_0(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[0].parentNode?.localName === "foreignObject" ? undefined : refs[0].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_3 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
    refs[3] = __ref_3;
    __ref_3.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
    __ref_3.setAttribute("class", "primary");
    __ref_3.addEventListener("click", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[3](__weiv_context, event))(scope);
      return resolved;
    });
    __ref_3.append(document.createTextNode("\n        New Session\n      "));
    fragment.append(__ref_3);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_0(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_0(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(scope));
  if (refs[2] !== next) {
    const previous = refs[2];
    destroyConditionalBranch_0(instance, refs, previous === true);
    refs[2] = next;
    replaceBetween(refs[0], refs[1], createConditionalFragment_0(instance, scope, refs, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_4(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[4].parentNode?.localName === "foreignObject" ? undefined : refs[4].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_7 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
    refs[7] = __ref_7;
    __ref_7.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
    __ref_7.addEventListener("click", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context, event))(scope);
      return resolved;
    });
    __ref_7.append(document.createTextNode("\n        Run once\n      "));
    fragment.append(__ref_7);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_4(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_4(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context))(scope));
  if (refs[6] !== next) {
    const previous = refs[6];
    destroyConditionalBranch_4(instance, refs, previous === true);
    refs[6] = next;
    replaceBetween(refs[4], refs[5], createConditionalFragment_4(instance, scope, refs, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_8(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[8].parentNode?.localName === "foreignObject" ? undefined : refs[8].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_11 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
    refs[11] = __ref_11;
    __ref_11.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
    __ref_11.setAttribute("class", "primary");
    __ref_11.addEventListener("click", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context, event))(scope);
      return resolved;
    });
    __ref_11.append(document.createTextNode("\n        Start Work\n      "));
    fragment.append(__ref_11);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_8(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_8(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[6](__weiv_context))(scope));
  if (refs[10] !== next) {
    const previous = refs[10];
    destroyConditionalBranch_8(instance, refs, previous === true);
    refs[10] = next;
    replaceBetween(refs[8], refs[9], createConditionalFragment_8(instance, scope, refs, next));
  }
  if (next) {
  } else {
  }
}

function mountProjectedSlot_14_0(start, end, ownerInstance) {
  const instance = { refs: [], refresh: () => ownerInstance.refresh(), update: () => ownerInstance.update() };
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = start.parentNode?.localName === "foreignObject" ? undefined : start.parentNode?.namespaceURI;
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
  const __weiv_propsCell = __weiv_createCell(__weiv_props);
  let props = __weiv_propsCell.value;
  let __weiv_handlers = __weiv_event_handlers;  const emit = (name, payload) => {
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
;
const __weiv_templateExpressions = [
	(__weiv_context) => {
		return props.item.id;
	},
	(__weiv_context) => {
		return props.item.subtitle;
	},
	(__weiv_context) => {
		return props.item.availability === "available" && props.item.type === "agent";
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return session?.(__weiv_argument);
	},
	(__weiv_context) => {
		return props.item.availability === "available" && props.item.type === "agent";
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return work?.(__weiv_argument);
	},
	(__weiv_context) => {
		return props.item.availability === "available" && props.item.type === "workflow";
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return work?.(__weiv_argument);
	},
	(__weiv_context) => {
		return props.item.availability;
	},
	(__weiv_context) => {
		return props.item.type;
	},
	(__weiv_context) => {
		return props.item.revision;
	},
	(__weiv_context) => {
		return __weiv_import_pretty(props.item);
	},
	(__weiv_context) => {
		return props.item.type === "tool" ? "Input" : "Objective";
	},
	(__weiv_context) => {
		return __weiv_import_pretty(props.item.type === "tool" ? props.item.input : props.item.objective);
	},
	(__weiv_context) => {
		return props.item.type === "tool" ? "Output" : "Result";
	},
	(__weiv_context) => {
		return __weiv_import_pretty(props.item.type === "tool" ? props.item.output : props.item.result);
	}
];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.pretty = __weiv_import_pretty;
    __weiv_scope.short = __weiv_import_short;
    __weiv_scope.props = props;
    __weiv_scope.session = session;
    __weiv_scope.work = work;
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

export const scopeId = "w41EDDF3026834A25";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.item", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.item.id", parentPathId: 2 }, { pathId: 4, rootId: 1, path: "props.item.subtitle", parentPathId: 2 }, { pathId: 5, rootId: 1, path: "props.item.availability", parentPathId: 2 }, { pathId: 6, rootId: 1, path: "props.item.type", parentPathId: 2 }, { pathId: 7, rootId: 1, path: "props.item.revision", parentPathId: 2 }, { pathId: 8, rootId: 1, path: "props.item.input", parentPathId: 2 }, { pathId: 9, rootId: 1, path: "props.item.objective", parentPathId: 2 }, { pathId: 10, rootId: 1, path: "props.item.output", parentPathId: 2 }, { pathId: 11, rootId: 1, path: "props.item.result", parentPathId: 2 }], regions: [{ regionId: 1, trackedPathIds: [3, 4] }, { regionId: 2, trackedPathIds: [5] }, { regionId: 3, trackedPathIds: [6] }, { regionId: 4, trackedPathIds: [7] }, { regionId: 5, trackedPathIds: [2] }, { regionId: 6, trackedPathIds: [6] }, { regionId: 7, trackedPathIds: [6, 8, 9] }, { regionId: 8, trackedPathIds: [6] }, { regionId: 9, trackedPathIds: [6, 10, 11] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_47 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[47] = __ref_47;
  __ref_47.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_12 = document.createComment("component:start");
  const __ref_13 = document.createComment("component:end");
  refs[12] = __ref_12;
  refs[13] = __ref_13;
  __ref_47.append(__ref_12);
  __ref_47.append(__ref_13);
  const __props_14 = {"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(instance.refresh()), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(instance.refresh())};
  const __slots_14 = { default: { mountIntoBoundary: (start, end) => mountProjectedSlot_14_0(start, end, instance) } };
  refs[14] = PageHeader.mountIntoBoundary(__ref_12, __ref_13, __props_14, undefined, __slots_14);
  const __ref_46 = (__ref_47.namespaceURI === "http://www.w3.org/2000/svg" && __ref_47.localName !== "foreignObject") || __ref_47.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[46] = __ref_46;
  __ref_46.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_46.setAttribute("class", "split");
  const __ref_34 = (__ref_46.namespaceURI === "http://www.w3.org/2000/svg" && __ref_46.localName !== "foreignObject") || __ref_46.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[34] = __ref_34;
  __ref_34.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_34.setAttribute("class", "stack");
  const __ref_33 = (__ref_34.namespaceURI === "http://www.w3.org/2000/svg" && __ref_34.localName !== "foreignObject") || __ref_34.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
  refs[33] = __ref_33;
  __ref_33.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_33.setAttribute("class", "panel");
  const __ref_19 = (__ref_33.namespaceURI === "http://www.w3.org/2000/svg" && __ref_33.localName !== "foreignObject") || __ref_33.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[19] = __ref_19;
  __ref_19.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_19.setAttribute("class", "section-head");
  const __ref_15 = (__ref_19.namespaceURI === "http://www.w3.org/2000/svg" && __ref_19.localName !== "foreignObject") || __ref_19.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
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
  const __props_18 = {"value": ((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(instance.refresh())};
  refs[18] = Status.mountIntoBoundary(__ref_16, __ref_17, __props_18, undefined, undefined);
  __ref_33.append(__ref_19);
  const __ref_28 = (__ref_33.namespaceURI === "http://www.w3.org/2000/svg" && __ref_33.localName !== "foreignObject") || __ref_33.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[28] = __ref_28;
  __ref_28.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_28.setAttribute("class", "fact-list");
  const __ref_23 = (__ref_28.namespaceURI === "http://www.w3.org/2000/svg" && __ref_28.localName !== "foreignObject") || __ref_28.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[23] = __ref_23;
  __ref_23.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_23.setAttribute("class", "fact");
  const __ref_20 = (__ref_23.namespaceURI === "http://www.w3.org/2000/svg" && __ref_23.localName !== "foreignObject") || __ref_23.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[20] = __ref_20;
  __ref_20.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_20.setAttribute("class", "label");
  __ref_20.append(document.createTextNode("Type"));
  __ref_23.append(__ref_20);
  const __ref_22 = (__ref_23.namespaceURI === "http://www.w3.org/2000/svg" && __ref_23.localName !== "foreignObject") || __ref_23.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[22] = __ref_22;
  __ref_22.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_21 = document.createTextNode("");
  refs[21] = __ref_21;
  __ref_22.append(__ref_21);
  __ref_23.append(__ref_22);
  __ref_28.append(__ref_23);
  const __ref_27 = (__ref_28.namespaceURI === "http://www.w3.org/2000/svg" && __ref_28.localName !== "foreignObject") || __ref_28.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[27] = __ref_27;
  __ref_27.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_27.setAttribute("class", "fact");
  const __ref_24 = (__ref_27.namespaceURI === "http://www.w3.org/2000/svg" && __ref_27.localName !== "foreignObject") || __ref_27.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[24] = __ref_24;
  __ref_24.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_24.setAttribute("class", "label");
  __ref_24.append(document.createTextNode("Revision"));
  __ref_27.append(__ref_24);
  const __ref_26 = (__ref_27.namespaceURI === "http://www.w3.org/2000/svg" && __ref_27.localName !== "foreignObject") || __ref_27.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[26] = __ref_26;
  __ref_26.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_26.setAttribute("class", "mono");
  const __ref_25 = document.createTextNode("");
  refs[25] = __ref_25;
  __ref_26.append(__ref_25);
  __ref_27.append(__ref_26);
  __ref_28.append(__ref_27);
  __ref_33.append(__ref_28);
  const __ref_32 = (__ref_33.namespaceURI === "http://www.w3.org/2000/svg" && __ref_33.localName !== "foreignObject") || __ref_33.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "details") : document.createElement("details");
  refs[32] = __ref_32;
  __ref_32.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_32.setAttribute("class", "json-details");
  const __ref_29 = (__ref_32.namespaceURI === "http://www.w3.org/2000/svg" && __ref_32.localName !== "foreignObject") || __ref_32.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "summary") : document.createElement("summary");
  refs[29] = __ref_29;
  __ref_29.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_29.append(document.createTextNode("View full configuration"));
  __ref_32.append(__ref_29);
  const __ref_31 = (__ref_32.namespaceURI === "http://www.w3.org/2000/svg" && __ref_32.localName !== "foreignObject") || __ref_32.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "pre") : document.createElement("pre");
  refs[31] = __ref_31;
  __ref_31.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_30 = document.createTextNode("");
  refs[30] = __ref_30;
  __ref_31.append(__ref_30);
  __ref_32.append(__ref_31);
  __ref_33.append(__ref_32);
  __ref_34.append(__ref_33);
  __ref_46.append(__ref_34);
  const __ref_45 = (__ref_46.namespaceURI === "http://www.w3.org/2000/svg" && __ref_46.localName !== "foreignObject") || __ref_46.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "aside") : document.createElement("aside");
  refs[45] = __ref_45;
  __ref_45.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_45.setAttribute("class", "stack");
  const __ref_44 = (__ref_45.namespaceURI === "http://www.w3.org/2000/svg" && __ref_45.localName !== "foreignObject") || __ref_45.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
  refs[44] = __ref_44;
  __ref_44.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_44.setAttribute("class", "panel");
  const __ref_35 = (__ref_44.namespaceURI === "http://www.w3.org/2000/svg" && __ref_44.localName !== "foreignObject") || __ref_44.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
  refs[35] = __ref_35;
  __ref_35.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  __ref_35.append(document.createTextNode("Contracts"));
  __ref_44.append(__ref_35);
  const __ref_37 = (__ref_44.namespaceURI === "http://www.w3.org/2000/svg" && __ref_44.localName !== "foreignObject") || __ref_44.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h3") : document.createElement("h3");
  refs[37] = __ref_37;
  __ref_37.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_36 = document.createTextNode("");
  refs[36] = __ref_36;
  __ref_37.append(__ref_36);
  __ref_44.append(__ref_37);
  const __ref_39 = (__ref_44.namespaceURI === "http://www.w3.org/2000/svg" && __ref_44.localName !== "foreignObject") || __ref_44.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "pre") : document.createElement("pre");
  refs[39] = __ref_39;
  __ref_39.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_38 = document.createTextNode("");
  refs[38] = __ref_38;
  __ref_39.append(__ref_38);
  __ref_44.append(__ref_39);
  const __ref_41 = (__ref_44.namespaceURI === "http://www.w3.org/2000/svg" && __ref_44.localName !== "foreignObject") || __ref_44.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h3") : document.createElement("h3");
  refs[41] = __ref_41;
  __ref_41.setAttribute("data-weiv-scope", "w41EDDF3026834A25");
  const __ref_40 = document.createTextNode("");
  refs[40] = __ref_40;
  __ref_41.append(__ref_40);
  __ref_44.append(__ref_41);
  const __ref_43 = (__ref_44.namespaceURI === "http://www.w3.org/2000/svg" && __ref_44.localName !== "foreignObject") || __ref_44.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "pre") : document.createElement("pre");
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
  if (!refs[14]) return;
  refs[14].setProps({"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope)});
  refs[14].setSlots({ default: { mountIntoBoundary: (start, end) => mountProjectedSlot_14_0(start, end, instance) } });
  refs[14].update();
}
function updateRegion_conditional_0(instance, scope, refs) {
  updateConditional_0(instance, scope, refs);
}
function updateRegion_conditional_4(instance, scope, refs) {
  updateConditional_4(instance, scope, refs);
}
function updateRegion_conditional_8(instance, scope, refs) {
  updateConditional_8(instance, scope, refs);
}
function updateRegion_child_18(instance, scope, refs) {
  if (!refs[18]) return;
  refs[18].setProps({"value": ((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope)});
  refs[18].update();
}
function updateRegion_text_21(instance, scope, refs) {
  const __next_text_21 = String((((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context))(scope)) ?? "");
  if (refs[21].data !== __next_text_21) {
    refs[21].data = __next_text_21;
  }
}
function updateRegion_text_25(instance, scope, refs) {
  const __next_text_25 = String((((__weiv_context) => __weiv_context.__weiv_eval[10](__weiv_context))(scope)) ?? "");
  if (refs[25].data !== __next_text_25) {
    refs[25].data = __next_text_25;
  }
}
function updateRegion_text_30(instance, scope, refs) {
  const __next_text_30 = String((((__weiv_context) => __weiv_context.__weiv_eval[11](__weiv_context))(scope)) ?? "");
  if (refs[30].data !== __next_text_30) {
    refs[30].data = __next_text_30;
  }
}
function updateRegion_text_36(instance, scope, refs) {
  const __next_text_36 = String((((__weiv_context) => __weiv_context.__weiv_eval[12](__weiv_context))(scope)) ?? "");
  if (refs[36].data !== __next_text_36) {
    refs[36].data = __next_text_36;
  }
}
function updateRegion_text_38(instance, scope, refs) {
  const __next_text_38 = String((((__weiv_context) => __weiv_context.__weiv_eval[13](__weiv_context))(scope)) ?? "");
  if (refs[38].data !== __next_text_38) {
    refs[38].data = __next_text_38;
  }
}
function updateRegion_text_40(instance, scope, refs) {
  const __next_text_40 = String((((__weiv_context) => __weiv_context.__weiv_eval[14](__weiv_context))(scope)) ?? "");
  if (refs[40].data !== __next_text_40) {
    refs[40].data = __next_text_40;
  }
}
function updateRegion_text_42(instance, scope, refs) {
  const __next_text_42 = String((((__weiv_context) => __weiv_context.__weiv_eval[15](__weiv_context))(scope)) ?? "");
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
  if (dirtySet.has("pretty") || dirtySet.has("props") || dirtyRegionSet.has(5)) {
    updateRegion_text_30(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(6)) {
    updateRegion_text_36(instance, scope, refs);
  }
  if (dirtySet.has("pretty") || dirtySet.has("props") || dirtyRegionSet.has(7)) {
    updateRegion_text_38(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(8)) {
    updateRegion_text_40(instance, scope, refs);
  }
  if (dirtySet.has("pretty") || dirtySet.has("props") || dirtyRegionSet.has(9)) {
    updateRegion_text_42(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[14] && typeof refs[14].destroy === "function") {
    refs[14].destroy();
  }
  refs[14] = undefined;
  if (refs[18] && typeof refs[18].destroy === "function") {
    refs[18].destroy();
  }
  refs[18] = undefined;
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
