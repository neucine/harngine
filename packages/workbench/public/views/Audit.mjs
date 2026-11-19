import { isObservable as __weiv_isObservable, createCell as __weiv_createCell, createCellScope as __weiv_createCellScope, unbindCellValue as __weiv_unbindCellValue, normalizeCellValue as __weiv_normalizeCellValue, cellAssignmentTarget as __weiv_cellAssignmentTarget, bindingObject as __weiv_bindingObject, bindingIterator as __weiv_bindingIterator, initializeClassName as __weiv_initializeClassName } from "../__weiv_runtime/cell.js";
import * as PageHeader from "../components/PageHeader.mjs";
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
function createForEntry_1(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment("for:item:start");
  const end = document.createComment("for:item:end");
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ["option"]: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ["option"]: currentItem };
    updateRegion_attribute_5_value(instance, loopScope, entryRefs);
    updateRegion_text_4(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = parent.localName === "foreignObject" ? undefined : parent.namespaceURI;
  const __ref_5 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "option") : document.createElement("option");
  entryRefs[5] = __ref_5;
  __ref_5.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_4 = document.createTextNode("");
  entryRefs[4] = __ref_4;
  __ref_5.append(__ref_4);
  fragment.append(__ref_5);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_1(instance, scope, refs) {
  const iterable = (((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context))(scope)) ?? [];
  const previous = refs[3] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[2]);
    } else {
      record = createForEntry_1(instance, scope, item, refs[2]);
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
  refs[3] = nextRecords;
}

function mountProjectedSlot_10_0(start, end, ownerInstance) {
  const instance = { refs: [], refresh: () => ownerInstance.refresh(), update: () => ownerInstance.update() };
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = start.parentNode?.localName === "foreignObject" ? undefined : start.parentNode?.namespaceURI;
  const __ref_7 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "label") : document.createElement("label");
  refs[7] = __ref_7;
  __ref_7.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_7.setAttribute("class", "pill");
  __ref_7.append(document.createTextNode("Category\n        "));
  const __ref_6 = (__ref_7.namespaceURI === "http://www.w3.org/2000/svg" && __ref_7.localName !== "foreignObject") || __ref_7.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "select") : document.createElement("select");
  refs[6] = __ref_6;
  __ref_6.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_6.addEventListener("change", (event) => {
    const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[3](__weiv_context, event))(instance.refresh());
    return resolved;
  });
  const __ref_0 = (__ref_6.namespaceURI === "http://www.w3.org/2000/svg" && __ref_6.localName !== "foreignObject") || __ref_6.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "option") : document.createElement("option");
  refs[0] = __ref_0;
  __ref_0.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_0.setAttribute("value", "");
  __ref_0.append(document.createTextNode("All"));
  __ref_6.append(__ref_0);
  const __ref_1 = document.createComment("for:start");
  const __ref_2 = document.createComment("for:end");
  refs[1] = __ref_1;
  refs[2] = __ref_2;
  refs[3] = [];
  __ref_6.append(__ref_1);
  __ref_6.append(__ref_2);
  __ref_7.append(__ref_6);
  fragment.append(__ref_7);
  replaceBetween(start, end, fragment);
  function update() {
    const refs = instance.refs;
    const scope = instance.refresh();
    updateRegion_attribute_6_value(instance, scope, refs);
    updateRegion_loop_1(instance, scope, refs);
  }
  function destroy() {
    const refs = instance.refs;
    const __records_3 = refs[3] ?? [];
    for (const record of __records_3) {
      if (record.handle && typeof record.handle.destroy === "function") {
        record.handle.destroy();
      } else if (typeof record.destroy === "function") {
        record.destroy();
      }
    }
  }
  update();
  return { update, destroy, start, end };
}

function createForEntry_16(instance, scope, item, reference) {
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
    updateRegion_text_19(instance, loopScope, entryRefs);
    updateRegion_text_21(instance, loopScope, entryRefs);
    updateRegion_text_24(instance, loopScope, entryRefs);
    updateRegion_text_26(instance, loopScope, entryRefs);
    updateRegion_text_29(instance, loopScope, entryRefs);
    updateRegion_text_32(instance, loopScope, entryRefs);
    updateRegion_text_36(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = parent.localName === "foreignObject" ? undefined : parent.namespaceURI;
  const __ref_39 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[39] = __ref_39;
  __ref_39.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_39.setAttribute("class", "entry");
  const __ref_23 = (__ref_39.namespaceURI === "http://www.w3.org/2000/svg" && __ref_39.localName !== "foreignObject") || __ref_39.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[23] = __ref_23;
  __ref_23.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_23.setAttribute("class", "toolbar");
  const __ref_20 = (__ref_23.namespaceURI === "http://www.w3.org/2000/svg" && __ref_23.localName !== "foreignObject") || __ref_23.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "b") : document.createElement("b");
  entryRefs[20] = __ref_20;
  __ref_20.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_19 = document.createTextNode("");
  entryRefs[19] = __ref_19;
  __ref_20.append(__ref_19);
  __ref_23.append(__ref_20);
  const __ref_22 = (__ref_23.namespaceURI === "http://www.w3.org/2000/svg" && __ref_23.localName !== "foreignObject") || __ref_23.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  entryRefs[22] = __ref_22;
  __ref_22.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_22.setAttribute("class", "pill");
  const __ref_21 = document.createTextNode("");
  entryRefs[21] = __ref_21;
  __ref_22.append(__ref_21);
  __ref_23.append(__ref_22);
  __ref_39.append(__ref_23);
  const __ref_25 = (__ref_39.namespaceURI === "http://www.w3.org/2000/svg" && __ref_39.localName !== "foreignObject") || __ref_39.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[25] = __ref_25;
  __ref_25.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_25.setAttribute("class", "muted mono");
  const __ref_24 = document.createTextNode("");
  entryRefs[24] = __ref_24;
  __ref_25.append(__ref_24);
  __ref_39.append(__ref_25);
  const __ref_28 = (__ref_39.namespaceURI === "http://www.w3.org/2000/svg" && __ref_39.localName !== "foreignObject") || __ref_39.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[28] = __ref_28;
  __ref_28.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_28.setAttribute("class", "meta");
  const __ref_27 = (__ref_28.namespaceURI === "http://www.w3.org/2000/svg" && __ref_28.localName !== "foreignObject") || __ref_28.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  entryRefs[27] = __ref_27;
  __ref_27.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_27.setAttribute("class", "pill");
  const __ref_26 = document.createTextNode("");
  entryRefs[26] = __ref_26;
  __ref_27.append(__ref_26);
  __ref_28.append(__ref_27);
  __ref_39.append(__ref_28);
  const __ref_30 = (__ref_39.namespaceURI === "http://www.w3.org/2000/svg" && __ref_39.localName !== "foreignObject") || __ref_39.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[30] = __ref_30;
  __ref_30.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_30.append(document.createTextNode("Outcome: "));
  const __ref_29 = document.createTextNode("");
  entryRefs[29] = __ref_29;
  __ref_30.append(__ref_29);
  __ref_39.append(__ref_30);
  const __ref_34 = (__ref_39.namespaceURI === "http://www.w3.org/2000/svg" && __ref_39.localName !== "foreignObject") || __ref_39.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[34] = __ref_34;
  __ref_34.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_31 = (__ref_34.namespaceURI === "http://www.w3.org/2000/svg" && __ref_34.localName !== "foreignObject") || __ref_34.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  entryRefs[31] = __ref_31;
  __ref_31.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_31.setAttribute("class", "label");
  __ref_31.append(document.createTextNode("Reason"));
  __ref_34.append(__ref_31);
  const __ref_33 = (__ref_34.namespaceURI === "http://www.w3.org/2000/svg" && __ref_34.localName !== "foreignObject") || __ref_34.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[33] = __ref_33;
  __ref_33.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_32 = document.createTextNode("");
  entryRefs[32] = __ref_32;
  __ref_33.append(__ref_32);
  __ref_34.append(__ref_33);
  __ref_39.append(__ref_34);
  const __ref_38 = (__ref_39.namespaceURI === "http://www.w3.org/2000/svg" && __ref_39.localName !== "foreignObject") || __ref_39.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "details") : document.createElement("details");
  entryRefs[38] = __ref_38;
  __ref_38.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_35 = (__ref_38.namespaceURI === "http://www.w3.org/2000/svg" && __ref_38.localName !== "foreignObject") || __ref_38.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "summary") : document.createElement("summary");
  entryRefs[35] = __ref_35;
  __ref_35.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_35.append(document.createTextNode("Entry details"));
  __ref_38.append(__ref_35);
  const __ref_37 = (__ref_38.namespaceURI === "http://www.w3.org/2000/svg" && __ref_38.localName !== "foreignObject") || __ref_38.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "pre") : document.createElement("pre");
  entryRefs[37] = __ref_37;
  __ref_37.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_36 = document.createTextNode("");
  entryRefs[36] = __ref_36;
  __ref_37.append(__ref_36);
  __ref_38.append(__ref_37);
  __ref_39.append(__ref_38);
  fragment.append(__ref_39);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_16(instance, scope, refs) {
  const iterable = (((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope)) ?? [];
  const previous = refs[18] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[17]);
    } else {
      record = createForEntry_16(instance, scope, item, refs[17]);
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
  refs[18] = nextRecords;
}

function createConditionalFragment_40(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[40].parentNode?.localName === "foreignObject" ? undefined : refs[40].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_43 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[43] = __ref_43;
    __ref_43.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
    __ref_43.setAttribute("class", "muted");
    __ref_43.append(document.createTextNode("No audit entries match this filter."));
    fragment.append(__ref_43);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_40(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_40(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[16](__weiv_context))(scope));
  if (refs[42] !== next) {
    const previous = refs[42];
    destroyConditionalBranch_40(instance, refs, previous === true);
    refs[42] = next;
    replaceBetween(refs[40], refs[41], createConditionalFragment_40(instance, scope, refs, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_44(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[44].parentNode?.localName === "foreignObject" ? undefined : refs[44].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_47 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
    refs[47] = __ref_47;
    __ref_47.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
    __ref_47.addEventListener("click", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[18](__weiv_context, event))(scope);
      return resolved;
    });
    __ref_47.append(document.createTextNode("Load more"));
    fragment.append(__ref_47);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_44(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_44(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[17](__weiv_context))(scope));
  if (refs[46] !== next) {
    const previous = refs[46];
    destroyConditionalBranch_44(instance, refs, previous === true);
    refs[46] = next;
    replaceBetween(refs[44], refs[45], createConditionalFragment_44(instance, scope, refs, next));
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
let categories = __weiv_createCell([
	"work",
	"decision",
	"authorization",
	"guardrail",
	"attempt",
	"interaction",
	"session"
]);
function categoryChange(event) {
	emit("category", event.target.value);
}
function more() {
	emit("more", props.next);
}
;
const __weiv_templateExpressions = [
	(__weiv_context) => {
		return "Audit";
	},
	(__weiv_context) => {
		return "Payload-safe operational evidence across Work, policy, Attempts, Interactions, and Sessions.";
	},
	(__weiv_context) => {
		return props.category;
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return categoryChange?.(__weiv_argument);
	},
	(__weiv_context) => {
		return categories.value;
	},
	(__weiv_context) => {
		const option = __weiv_context["option"];
		return option;
	},
	(__weiv_context) => {
		const option = __weiv_context["option"];
		return option;
	},
	(__weiv_context) => {
		return props.entries.length;
	},
	(__weiv_context) => {
		return props.entries;
	},
	(__weiv_context) => {
		const entry = __weiv_context["entry"];
		return entry.action;
	},
	(__weiv_context) => {
		const entry = __weiv_context["entry"];
		return entry.category;
	},
	(__weiv_context) => {
		const entry = __weiv_context["entry"];
		return entry.id;
	},
	(__weiv_context) => {
		const entry = __weiv_context["entry"];
		return entry.correlationText;
	},
	(__weiv_context) => {
		const entry = __weiv_context["entry"];
		return entry.outcome || "—";
	},
	(__weiv_context) => {
		const entry = __weiv_context["entry"];
		return entry.reasonText;
	},
	(__weiv_context) => {
		const entry = __weiv_context["entry"];
		return __weiv_import_pretty(entry);
	},
	(__weiv_context) => {
		return !props.entries.length;
	},
	(__weiv_context) => {
		return props.next;
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return more?.(__weiv_argument);
	}
];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.pretty = __weiv_import_pretty;
    __weiv_scope.props = props;
    __weiv_scope.categories = categories.value;
    __weiv_scope.categoryChange = categoryChange;
    __weiv_scope.more = more;
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
    __weiv_cellScope.watch(categories, "categories");
    return () => __weiv_cellScope.dispose();
  }
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "wA725F3677121BF9F";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.entries", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.entries.length", parentPathId: 2 }, { pathId: 4, rootId: 1, path: "props.next", parentPathId: 1 }], regions: [{ regionId: 2, trackedPathIds: [3] }, { regionId: 3, trackedPathIds: [2] }, { regionId: 4, trackedPathIds: [3] }, { regionId: 5, trackedPathIds: [4] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_50 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[50] = __ref_50;
  __ref_50.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_8 = document.createComment("component:start");
  const __ref_9 = document.createComment("component:end");
  refs[8] = __ref_8;
  refs[9] = __ref_9;
  __ref_50.append(__ref_8);
  __ref_50.append(__ref_9);
  const __props_10 = {"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(instance.refresh()), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(instance.refresh())};
  const __slots_10 = { default: { mountIntoBoundary: (start, end) => mountProjectedSlot_10_0(start, end, instance) } };
  refs[10] = PageHeader.mountIntoBoundary(__ref_8, __ref_9, __props_10, undefined, __slots_10);
  const __ref_49 = (__ref_50.namespaceURI === "http://www.w3.org/2000/svg" && __ref_50.localName !== "foreignObject") || __ref_50.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
  refs[49] = __ref_49;
  __ref_49.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_49.setAttribute("class", "panel");
  const __ref_15 = (__ref_49.namespaceURI === "http://www.w3.org/2000/svg" && __ref_49.localName !== "foreignObject") || __ref_49.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[15] = __ref_15;
  __ref_15.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_15.setAttribute("class", "section-head");
  const __ref_14 = (__ref_15.namespaceURI === "http://www.w3.org/2000/svg" && __ref_15.localName !== "foreignObject") || __ref_15.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[14] = __ref_14;
  __ref_14.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  const __ref_11 = (__ref_14.namespaceURI === "http://www.w3.org/2000/svg" && __ref_14.localName !== "foreignObject") || __ref_14.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
  refs[11] = __ref_11;
  __ref_11.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_11.append(document.createTextNode("Retained evidence"));
  __ref_14.append(__ref_11);
  const __ref_13 = (__ref_14.namespaceURI === "http://www.w3.org/2000/svg" && __ref_14.localName !== "foreignObject") || __ref_14.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[13] = __ref_13;
  __ref_13.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_13.setAttribute("class", "muted");
  const __ref_12 = document.createTextNode("");
  refs[12] = __ref_12;
  __ref_13.append(__ref_12);
  __ref_13.append(document.createTextNode(" entries loaded"));
  __ref_14.append(__ref_13);
  __ref_15.append(__ref_14);
  __ref_49.append(__ref_15);
  const __ref_48 = (__ref_49.namespaceURI === "http://www.w3.org/2000/svg" && __ref_49.localName !== "foreignObject") || __ref_49.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[48] = __ref_48;
  __ref_48.setAttribute("data-weiv-scope", "wA725F3677121BF9F");
  __ref_48.setAttribute("class", "timeline");
  const __ref_16 = document.createComment("for:start");
  const __ref_17 = document.createComment("for:end");
  refs[16] = __ref_16;
  refs[17] = __ref_17;
  refs[18] = [];
  __ref_48.append(__ref_16);
  __ref_48.append(__ref_17);
  const __ref_40 = document.createComment("if:start");
  const __ref_41 = document.createComment("if:end");
  refs[40] = __ref_40;
  refs[41] = __ref_41;
  refs[42] = undefined;
  __ref_48.append(__ref_40);
  __ref_48.append(__ref_41);
  const __ref_44 = document.createComment("if:start");
  const __ref_45 = document.createComment("if:end");
  refs[44] = __ref_44;
  refs[45] = __ref_45;
  refs[46] = undefined;
  __ref_48.append(__ref_44);
  __ref_48.append(__ref_45);
  __ref_49.append(__ref_48);
  __ref_50.append(__ref_49);
  fragment.append(__ref_50);
  return fragment;
}

function updateRegion_child_10(instance, scope, refs) {
  if (!refs[10]) return;
  refs[10].setProps({"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope)});
  refs[10].setSlots({ default: { mountIntoBoundary: (start, end) => mountProjectedSlot_10_0(start, end, instance) } });
  refs[10].update();
}
function updateRegion_attribute_6_value(instance, scope, refs) {
  const __value_6_value = ((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(scope);
  const __next_6_value = __value_6_value ?? "";
  const __next_string_6_value = String(__next_6_value);
  if (refs[6].value !== __next_string_6_value) {
    refs[6].value = __next_string_6_value;
  }
  refs[6].setAttribute("value", __next_string_6_value);
}
function updateRegion_loop_1(instance, scope, refs) {
  updateForLoop_1(instance, scope, refs);
}
function updateRegion_attribute_5_value(instance, scope, refs) {
  const __value_5_value = ((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context))(scope);
  const __next_5_value = __value_5_value ?? "";
  const __next_string_5_value = String(__next_5_value);
  if (refs[5].value !== __next_string_5_value) {
    refs[5].value = __next_string_5_value;
  }
  refs[5].setAttribute("value", __next_string_5_value);
}
function updateRegion_text_4(instance, scope, refs) {
  const __next_text_4 = String((((__weiv_context) => __weiv_context.__weiv_eval[6](__weiv_context))(scope)) ?? "");
  if (refs[4].data !== __next_text_4) {
    refs[4].data = __next_text_4;
  }
}
function updateRegion_text_12(instance, scope, refs) {
  const __next_text_12 = String((((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context))(scope)) ?? "");
  if (refs[12].data !== __next_text_12) {
    refs[12].data = __next_text_12;
  }
}
function updateRegion_loop_16(instance, scope, refs) {
  updateForLoop_16(instance, scope, refs);
}
function updateRegion_text_19(instance, scope, refs) {
  const __next_text_19 = String((((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context))(scope)) ?? "");
  if (refs[19].data !== __next_text_19) {
    refs[19].data = __next_text_19;
  }
}
function updateRegion_text_21(instance, scope, refs) {
  const __next_text_21 = String((((__weiv_context) => __weiv_context.__weiv_eval[10](__weiv_context))(scope)) ?? "");
  if (refs[21].data !== __next_text_21) {
    refs[21].data = __next_text_21;
  }
}
function updateRegion_text_24(instance, scope, refs) {
  const __next_text_24 = String((((__weiv_context) => __weiv_context.__weiv_eval[11](__weiv_context))(scope)) ?? "");
  if (refs[24].data !== __next_text_24) {
    refs[24].data = __next_text_24;
  }
}
function updateRegion_text_26(instance, scope, refs) {
  const __next_text_26 = String((((__weiv_context) => __weiv_context.__weiv_eval[12](__weiv_context))(scope)) ?? "");
  if (refs[26].data !== __next_text_26) {
    refs[26].data = __next_text_26;
  }
}
function updateRegion_text_29(instance, scope, refs) {
  const __next_text_29 = String((((__weiv_context) => __weiv_context.__weiv_eval[13](__weiv_context))(scope)) ?? "");
  if (refs[29].data !== __next_text_29) {
    refs[29].data = __next_text_29;
  }
}
function updateRegion_text_32(instance, scope, refs) {
  const __next_text_32 = String((((__weiv_context) => __weiv_context.__weiv_eval[14](__weiv_context))(scope)) ?? "");
  if (refs[32].data !== __next_text_32) {
    refs[32].data = __next_text_32;
  }
}
function updateRegion_text_36(instance, scope, refs) {
  const __next_text_36 = String((((__weiv_context) => __weiv_context.__weiv_eval[15](__weiv_context))(scope)) ?? "");
  if (refs[36].data !== __next_text_36) {
    refs[36].data = __next_text_36;
  }
}
function updateRegion_conditional_40(instance, scope, refs) {
  updateConditional_40(instance, scope, refs);
}
function updateRegion_conditional_44(instance, scope, refs) {
  updateConditional_44(instance, scope, refs);
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_10(instance, scope, refs);
  updateRegion_text_12(instance, scope, refs);
  updateRegion_loop_16(instance, scope, refs);
  updateRegion_conditional_40(instance, scope, refs);
  updateRegion_conditional_44(instance, scope, refs);
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
  if (dirtySet.has("props") || dirtySet.has("categories") || dirtyRegionSet.has(1)) {
    updateRegion_child_10(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(2)) {
    updateRegion_text_12(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtySet.has("pretty") || dirtyRegionSet.has(3)) {
    updateRegion_loop_16(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(4)) {
    updateRegion_conditional_40(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(5)) {
    updateRegion_conditional_44(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[10] && typeof refs[10].destroy === "function") {
    refs[10].destroy();
  }
  refs[10] = undefined;
  const __records_18 = refs[18] ?? [];
  for (const record of __records_18) {
    if (record.handle && typeof record.handle.destroy === "function") {
      record.handle.destroy();
    } else if (typeof record.destroy === "function") {
      record.destroy();
    }
  }
  if (refs[42] === true) {
  } else {
  }
  if (refs[46] === true) {
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
