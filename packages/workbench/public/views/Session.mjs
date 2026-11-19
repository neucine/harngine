import { isObservable as __weiv_isObservable, createCell as __weiv_createCell, createCellScope as __weiv_createCellScope, unbindCellValue as __weiv_unbindCellValue, normalizeCellValue as __weiv_normalizeCellValue, cellAssignmentTarget as __weiv_cellAssignmentTarget, bindingObject as __weiv_bindingObject, bindingIterator as __weiv_bindingIterator, initializeClassName as __weiv_initializeClassName } from "../__weiv_runtime/cell.js";
import * as PageHeader from "../components/PageHeader.mjs";
import * as Status from "../components/Status.mjs";
import * as InteractionList from "../components/InteractionList.mjs";
import { display as __weiv_import_display } from "../__weiv_modules/8f9bcec8c215c7a6.mjs";
import { isTerminal as __weiv_import_isTerminal } from "../__weiv_modules/8f9bcec8c215c7a6.mjs";
import { short as __weiv_import_short } from "../__weiv_modules/8f9bcec8c215c7a6.mjs";
import { time as __weiv_import_time } from "../__weiv_modules/8f9bcec8c215c7a6.mjs";

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
    const __ref_6 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
    refs[6] = __ref_6;
    __ref_6.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_6.addEventListener("click", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context, event))(scope);
      return resolved;
    });
    __ref_6.append(document.createTextNode("\n        Close Session\n      "));
    fragment.append(__ref_6);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_3(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_3(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[3](__weiv_context))(scope));
  if (refs[5] !== next) {
    const previous = refs[5];
    destroyConditionalBranch_3(instance, refs, previous === true);
    refs[5] = next;
    replaceBetween(refs[3], refs[4], createConditionalFragment_3(instance, scope, refs, next));
  }
  if (next) {
  } else {
  }
}

function mountProjectedSlot_9_0(start, end, ownerInstance) {
  const instance = { refs: [], refresh: () => ownerInstance.refresh(), update: () => ownerInstance.update() };
  const refs = instance.refs;
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = start.parentNode?.localName === "foreignObject" ? undefined : start.parentNode?.namespaceURI;
  const __ref_0 = document.createComment("component:start");
  const __ref_1 = document.createComment("component:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  fragment.append(__ref_0);
  fragment.append(__ref_1);
  const __props_2 = {"value": ((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(instance.refresh())};
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
    refs[2] = undefined;
    if (refs[5] === true) {
    } else {
    }
  }
  update();
  return { update, destroy, start, end };
}

function createForEntry_14(instance, scope, item, reference) {
  const parent = reference.parentNode;
  const start = document.createComment("for:item:start");
  const end = document.createComment("for:item:end");
  parent.insertBefore(start, reference);
  parent.insertBefore(end, reference);
  const entryRefs = [];
  let currentItem = item;
  let loopScope = { ...scope, ["message"]: currentItem };
  function update(nextScope, nextItem) {
    if (arguments.length > 1) currentItem = nextItem;
    const refs = entryRefs;
    loopScope = { ...nextScope, ["message"]: currentItem };
    updateRegion_attribute_22_class(instance, loopScope, entryRefs);
    updateRegion_text_17(instance, loopScope, entryRefs);
    updateRegion_text_19(instance, loopScope, entryRefs);
    updateRegion_attribute_21_class(instance, loopScope, entryRefs);
    updateRegion_attribute_21_href(instance, loopScope, entryRefs);
  }
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = parent.localName === "foreignObject" ? undefined : parent.namespaceURI;
  const __ref_22 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[22] = __ref_22;
  __ref_22.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_22.setAttribute("class", "message");
  const __ref_18 = (__ref_22.namespaceURI === "http://www.w3.org/2000/svg" && __ref_22.localName !== "foreignObject") || __ref_22.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[18] = __ref_18;
  __ref_18.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_18.setAttribute("class", "label");
  const __ref_17 = document.createTextNode("");
  entryRefs[17] = __ref_17;
  __ref_18.append(__ref_17);
  __ref_22.append(__ref_18);
  const __ref_20 = (__ref_22.namespaceURI === "http://www.w3.org/2000/svg" && __ref_22.localName !== "foreignObject") || __ref_22.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  entryRefs[20] = __ref_20;
  __ref_20.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  const __ref_19 = document.createTextNode("");
  entryRefs[19] = __ref_19;
  __ref_20.append(__ref_19);
  __ref_22.append(__ref_20);
  const __ref_21 = (__ref_22.namespaceURI === "http://www.w3.org/2000/svg" && __ref_22.localName !== "foreignObject") || __ref_22.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "a") : document.createElement("a");
  entryRefs[21] = __ref_21;
  __ref_21.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_21.append(document.createTextNode("View Work →"));
  __ref_22.append(__ref_21);
  fragment.append(__ref_22);
  function destroy() {
    const refs = entryRefs;
  }
  replaceBetween(start, end, fragment);
  update(scope, item);
  return { key: item?.id ?? item, start, end, refs: entryRefs, update, destroy };
}

function updateForLoop_14(instance, scope, refs) {
  const iterable = (((__weiv_context) => __weiv_context.__weiv_eval[6](__weiv_context))(scope)) ?? [];
  const previous = refs[16] ?? [];
  const previousByKey = new Map(previous.map((record) => [record.key, record]));
  const nextRecords = [];
  for (const item of iterable) {
    const key = item?.id ?? item;
    let record = previousByKey.get(key);
    if (record) {
      previousByKey.delete(key);
      record.update(scope, item);
      moveBoundaryBefore(record.start, record.end, refs[15]);
    } else {
      record = createForEntry_14(instance, scope, item, refs[15]);
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
  refs[16] = nextRecords;
}

function createConditionalFragment_23(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[23].parentNode?.localName === "foreignObject" ? undefined : refs[23].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_26 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[26] = __ref_26;
    __ref_26.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_26.setAttribute("class", "empty");
    __ref_26.append(document.createTextNode("\n              Send a prompt to begin this Session.\n            "));
    fragment.append(__ref_26);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_23(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_23(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[12](__weiv_context))(scope));
  if (refs[25] !== next) {
    const previous = refs[25];
    destroyConditionalBranch_23(instance, refs, previous === true);
    refs[25] = next;
    replaceBetween(refs[23], refs[24], createConditionalFragment_23(instance, scope, refs, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_29(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[29].parentNode?.localName === "foreignObject" ? undefined : refs[29].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_52 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
    refs[52] = __ref_52;
    __ref_52.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_52.setAttribute("class", "panel composer");
    const __ref_43 = (__ref_52.namespaceURI === "http://www.w3.org/2000/svg" && __ref_52.localName !== "foreignObject") || __ref_52.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[43] = __ref_43;
    __ref_43.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_43.setAttribute("class", "section-head");
    const __ref_35 = (__ref_43.namespaceURI === "http://www.w3.org/2000/svg" && __ref_43.localName !== "foreignObject") || __ref_43.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[35] = __ref_35;
    __ref_35.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    const __ref_32 = (__ref_35.namespaceURI === "http://www.w3.org/2000/svg" && __ref_35.localName !== "foreignObject") || __ref_35.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
    refs[32] = __ref_32;
    __ref_32.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_32.append(document.createTextNode("Message Agent"));
    __ref_35.append(__ref_32);
    const __ref_34 = (__ref_35.namespaceURI === "http://www.w3.org/2000/svg" && __ref_35.localName !== "foreignObject") || __ref_35.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[34] = __ref_34;
    __ref_34.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_34.setAttribute("class", "muted");
    const __ref_33 = document.createTextNode("");
    refs[33] = __ref_33;
    __ref_34.append(__ref_33);
    __ref_35.append(__ref_34);
    __ref_43.append(__ref_35);
    const __ref_36 = document.createComment("if:start");
    const __ref_37 = document.createComment("if:end");
    refs[36] = __ref_36;
    refs[37] = __ref_37;
    refs[38] = undefined;
    __ref_43.append(__ref_36);
    __ref_43.append(__ref_37);
    __ref_52.append(__ref_43);
    const __ref_44 = (__ref_52.namespaceURI === "http://www.w3.org/2000/svg" && __ref_52.localName !== "foreignObject") || __ref_52.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "textarea") : document.createElement("textarea");
    refs[44] = __ref_44;
    __ref_44.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_44.setAttribute("aria-label", "Message Agent");
    __ref_44.setAttribute("placeholder", "Ask the Agent to investigate, compare, or act…");
    __ref_44.addEventListener("input", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[18](__weiv_context, event))(scope);
      return resolved;
    });
    __ref_44.addEventListener("keydown", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[19](__weiv_context, event))(scope);
      return resolved;
    });
    __ref_52.append(__ref_44);
    const __ref_51 = (__ref_52.namespaceURI === "http://www.w3.org/2000/svg" && __ref_52.localName !== "foreignObject") || __ref_52.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[51] = __ref_51;
    __ref_51.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_51.setAttribute("class", "actions");
    const __ref_46 = (__ref_51.namespaceURI === "http://www.w3.org/2000/svg" && __ref_51.localName !== "foreignObject") || __ref_51.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
    refs[46] = __ref_46;
    __ref_46.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_46.setAttribute("class", "primary");
    __ref_46.addEventListener("click", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[20](__weiv_context, event))(scope);
      return resolved;
    });
    const __ref_45 = document.createTextNode("");
    refs[45] = __ref_45;
    __ref_46.append(__ref_45);
    __ref_51.append(__ref_46);
    const __ref_47 = document.createComment("if:start");
    const __ref_48 = document.createComment("if:end");
    refs[47] = __ref_47;
    refs[48] = __ref_48;
    refs[49] = undefined;
    __ref_51.append(__ref_47);
    __ref_51.append(__ref_48);
    __ref_52.append(__ref_51);
    fragment.append(__ref_52);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_29(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[38] === true) {
      if (refs[41] && typeof refs[41].destroy === "function") {
        refs[41].destroy();
      }
      refs[41] = undefined;
    } else {
    }
    if (refs[49] === true) {
    } else {
    }
  } else {
  }
}

function updateConditional_29(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[13](__weiv_context))(scope));
  if (refs[31] !== next) {
    const previous = refs[31];
    destroyConditionalBranch_29(instance, refs, previous === true);
    refs[31] = next;
    replaceBetween(refs[29], refs[30], createConditionalFragment_29(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_text_33(instance, scope, refs);
    updateRegion_conditional_36(instance, scope, refs);
    updateRegion_attribute_44_value(instance, scope, refs);
    updateRegion_text_45(instance, scope, refs);
    updateRegion_conditional_47(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_36(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[36].parentNode?.localName === "foreignObject" ? undefined : refs[36].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_42 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
    refs[42] = __ref_42;
    __ref_42.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    const __ref_39 = document.createComment("component:start");
    const __ref_40 = document.createComment("component:end");
    refs[39] = __ref_39;
    refs[40] = __ref_40;
    __ref_42.append(__ref_39);
    __ref_42.append(__ref_40);
    const __props_41 = {"value": ((__weiv_context) => __weiv_context.__weiv_eval[16](__weiv_context))(scope)};
    refs[41] = Status.mountIntoBoundary(__ref_39, __ref_40, __props_41, undefined, undefined);
    fragment.append(__ref_42);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_36(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[41] && typeof refs[41].destroy === "function") {
      refs[41].destroy();
    }
    refs[41] = undefined;
  } else {
  }
}

function updateConditional_36(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[15](__weiv_context))(scope));
  if (refs[38] !== next) {
    const previous = refs[38];
    destroyConditionalBranch_36(instance, refs, previous === true);
    refs[38] = next;
    replaceBetween(refs[36], refs[37], createConditionalFragment_36(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_41(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_47(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[47].parentNode?.localName === "foreignObject" ? undefined : refs[47].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_50 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "button") : document.createElement("button");
    refs[50] = __ref_50;
    __ref_50.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_50.addEventListener("click", (event) => {
      const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[23](__weiv_context, event))(scope);
      return resolved;
    });
    __ref_50.append(document.createTextNode("Steer current Work"));
    fragment.append(__ref_50);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_47(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_47(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[22](__weiv_context))(scope));
  if (refs[49] !== next) {
    const previous = refs[49];
    destroyConditionalBranch_47(instance, refs, previous === true);
    refs[49] = next;
    replaceBetween(refs[47], refs[48], createConditionalFragment_47(instance, scope, refs, next));
  }
  if (next) {
  } else {
  }
}

function createConditionalFragment_67(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[67].parentNode?.localName === "foreignObject" ? undefined : refs[67].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_73 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[73] = __ref_73;
    __ref_73.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_73.setAttribute("class", "fact");
    const __ref_70 = (__ref_73.namespaceURI === "http://www.w3.org/2000/svg" && __ref_73.localName !== "foreignObject") || __ref_73.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
    refs[70] = __ref_70;
    __ref_70.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_70.setAttribute("class", "label");
    __ref_70.append(document.createTextNode("Queued Work"));
    __ref_73.append(__ref_70);
    const __ref_72 = (__ref_73.namespaceURI === "http://www.w3.org/2000/svg" && __ref_73.localName !== "foreignObject") || __ref_73.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
    refs[72] = __ref_72;
    __ref_72.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    const __ref_71 = document.createTextNode("");
    refs[71] = __ref_71;
    __ref_72.append(__ref_71);
    __ref_73.append(__ref_72);
    fragment.append(__ref_73);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_67(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_67(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[27](__weiv_context))(scope));
  if (refs[69] !== next) {
    const previous = refs[69];
    destroyConditionalBranch_67(instance, refs, previous === true);
    refs[69] = next;
    replaceBetween(refs[67], refs[68], createConditionalFragment_67(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_text_71(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_76(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[76].parentNode?.localName === "foreignObject" ? undefined : refs[76].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_90 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
    refs[90] = __ref_90;
    __ref_90.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_90.setAttribute("class", "panel");
    const __ref_83 = (__ref_90.namespaceURI === "http://www.w3.org/2000/svg" && __ref_90.localName !== "foreignObject") || __ref_90.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[83] = __ref_83;
    __ref_83.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_83.setAttribute("class", "section-head");
    const __ref_79 = (__ref_83.namespaceURI === "http://www.w3.org/2000/svg" && __ref_83.localName !== "foreignObject") || __ref_83.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
    refs[79] = __ref_79;
    __ref_79.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_79.append(document.createTextNode("Current Work"));
    __ref_83.append(__ref_79);
    const __ref_80 = document.createComment("component:start");
    const __ref_81 = document.createComment("component:end");
    refs[80] = __ref_80;
    refs[81] = __ref_81;
    __ref_83.append(__ref_80);
    __ref_83.append(__ref_81);
    const __props_82 = {"value": ((__weiv_context) => __weiv_context.__weiv_eval[30](__weiv_context))(scope)};
    refs[82] = Status.mountIntoBoundary(__ref_80, __ref_81, __props_82, undefined, undefined);
    __ref_90.append(__ref_83);
    const __ref_85 = (__ref_90.namespaceURI === "http://www.w3.org/2000/svg" && __ref_90.localName !== "foreignObject") || __ref_90.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[85] = __ref_85;
    __ref_85.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_85.setAttribute("class", "value mono");
    const __ref_84 = document.createTextNode("");
    refs[84] = __ref_84;
    __ref_85.append(__ref_84);
    __ref_90.append(__ref_85);
    const __ref_87 = (__ref_90.namespaceURI === "http://www.w3.org/2000/svg" && __ref_90.localName !== "foreignObject") || __ref_90.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[87] = __ref_87;
    __ref_87.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_87.setAttribute("class", "muted");
    const __ref_86 = document.createTextNode("");
    refs[86] = __ref_86;
    __ref_87.append(__ref_86);
    __ref_90.append(__ref_87);
    const __ref_89 = (__ref_90.namespaceURI === "http://www.w3.org/2000/svg" && __ref_90.localName !== "foreignObject") || __ref_90.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "p") : document.createElement("p");
    refs[89] = __ref_89;
    __ref_89.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    const __ref_88 = (__ref_89.namespaceURI === "http://www.w3.org/2000/svg" && __ref_89.localName !== "foreignObject") || __ref_89.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "a") : document.createElement("a");
    refs[88] = __ref_88;
    __ref_88.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_88.setAttribute("class", "message-link");
    __ref_88.append(document.createTextNode("Open execution →"));
    __ref_89.append(__ref_88);
    __ref_90.append(__ref_89);
    fragment.append(__ref_90);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_76(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[82] && typeof refs[82].destroy === "function") {
      refs[82].destroy();
    }
    refs[82] = undefined;
  } else {
  }
}

function updateConditional_76(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[29](__weiv_context))(scope));
  if (refs[78] !== next) {
    const previous = refs[78];
    destroyConditionalBranch_76(instance, refs, previous === true);
    refs[78] = next;
    replaceBetween(refs[76], refs[77], createConditionalFragment_76(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_82(instance, scope, refs);
    updateRegion_text_84(instance, scope, refs);
    updateRegion_text_86(instance, scope, refs);
    updateRegion_attribute_88_href(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_91(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[91].parentNode?.localName === "foreignObject" ? undefined : refs[91].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_98 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
    refs[98] = __ref_98;
    __ref_98.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_98.setAttribute("class", "panel");
    const __ref_96 = (__ref_98.namespaceURI === "http://www.w3.org/2000/svg" && __ref_98.localName !== "foreignObject") || __ref_98.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[96] = __ref_96;
    __ref_96.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_96.setAttribute("class", "section-head");
    const __ref_94 = (__ref_96.namespaceURI === "http://www.w3.org/2000/svg" && __ref_96.localName !== "foreignObject") || __ref_96.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
    refs[94] = __ref_94;
    __ref_94.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_94.append(document.createTextNode("Current Work"));
    __ref_96.append(__ref_94);
    const __ref_95 = (__ref_96.namespaceURI === "http://www.w3.org/2000/svg" && __ref_96.localName !== "foreignObject") || __ref_96.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
    refs[95] = __ref_95;
    __ref_95.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_95.setAttribute("class", "pill");
    __ref_95.append(document.createTextNode("Idle"));
    __ref_96.append(__ref_95);
    __ref_98.append(__ref_96);
    const __ref_97 = (__ref_98.namespaceURI === "http://www.w3.org/2000/svg" && __ref_98.localName !== "foreignObject") || __ref_98.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[97] = __ref_97;
    __ref_97.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
    __ref_97.setAttribute("class", "muted");
    __ref_97.append(document.createTextNode("The next message will start new Work."));
    __ref_98.append(__ref_97);
    fragment.append(__ref_98);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_91(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_91(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[34](__weiv_context))(scope));
  if (refs[93] !== next) {
    const previous = refs[93];
    destroyConditionalBranch_91(instance, refs, previous === true);
    refs[93] = next;
    replaceBetween(refs[91], refs[92], createConditionalFragment_91(instance, scope, refs, next));
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
let draft = __weiv_createCell("");
function input(event) {
	__weiv_cellAssignmentTarget(() => draft).value = __weiv_normalizeCellValue(event.target.value);
}
function active() {
	return props.item.foregroundWork && !__weiv_import_isTerminal(props.item.foregroundWork.status);
}
function send(delivery) {
	if (!draft.value.trim()) return;
	emit("send", {
		id: props.item.id,
		content: draft.value,
		delivery
	});
	__weiv_cellAssignmentTarget(() => draft).value = __weiv_normalizeCellValue("");
}
function queue() {
	send("queue");
}
function steer() {
	send("steer");
}
function keydown(event) {
	if ((event.metaKey || event.ctrlKey) && event.key === "Enter") queue();
}
function close() {
	emit("close", props.item.id);
}
function respond(value) {
	emit("respond", value);
}
function question(value) {
	emit("question", value);
}
;
const __weiv_templateExpressions = [
	(__weiv_context) => {
		return props.item.title;
	},
	(__weiv_context) => {
		return props.item.agent.id;
	},
	(__weiv_context) => {
		return props.item.status;
	},
	(__weiv_context) => {
		return props.item.status === "open" && !active();
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return close?.(__weiv_argument);
	},
	(__weiv_context) => {
		return props.item.recentMessages?.length || 0;
	},
	(__weiv_context) => {
		return props.item.recentMessages || [];
	},
	(__weiv_context) => {
		const message = __weiv_context["message"];
		return "message " + message.author;
	},
	(__weiv_context) => {
		const message = __weiv_context["message"];
		return message.author === "human" ? "You" : "Agent";
	},
	(__weiv_context) => {
		const message = __weiv_context["message"];
		return __weiv_import_display(message.content);
	},
	(__weiv_context) => {
		const message = __weiv_context["message"];
		return message.workId ? "message-link" : "hidden";
	},
	(__weiv_context) => {
		const message = __weiv_context["message"];
		return message.workUrl;
	},
	(__weiv_context) => {
		return !props.item.recentMessages?.length;
	},
	(__weiv_context) => {
		return props.item.status === "open";
	},
	(__weiv_context) => {
		return active() ? "Queue this message for the next Work, or steer the current Work." : "A message starts new durable Work.";
	},
	(__weiv_context) => {
		return active();
	},
	(__weiv_context) => {
		return props.item.foregroundWork.status;
	},
	(__weiv_context) => {
		return draft.value;
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return input?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return keydown?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return queue?.(__weiv_argument);
	},
	(__weiv_context) => {
		return active() ? "Queue message" : "Send message";
	},
	(__weiv_context) => {
		return active();
	},
	(__weiv_context, __weiv_argument) => {
		const event = __weiv_argument;
		return steer?.(__weiv_argument);
	},
	(__weiv_context) => {
		return props.item.agent.id;
	},
	(__weiv_context) => {
		return __weiv_import_short(props.item.agent.revision);
	},
	(__weiv_context) => {
		return __weiv_import_time(props.item.createdAt);
	},
	(__weiv_context) => {
		return props.item.queuedWorkIds?.length;
	},
	(__weiv_context) => {
		return props.item.queuedWorkIds.length;
	},
	(__weiv_context) => {
		return props.item.foregroundWork;
	},
	(__weiv_context) => {
		return props.item.foregroundWork.status;
	},
	(__weiv_context) => {
		return props.item.foregroundWork.id;
	},
	(__weiv_context) => {
		return props.item.foregroundWork.definition.id;
	},
	(__weiv_context) => {
		return "/work/" + encodeURIComponent(props.item.foregroundWork.id);
	},
	(__weiv_context) => {
		return !props.item.foregroundWork;
	},
	(__weiv_context) => {
		return props.item.foregroundWork;
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return respond?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return question?.(__weiv_argument);
	}
];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.display = __weiv_import_display;
    __weiv_scope.isTerminal = __weiv_import_isTerminal;
    __weiv_scope.short = __weiv_import_short;
    __weiv_scope.time = __weiv_import_time;
    __weiv_scope.props = props;
    __weiv_scope.draft = draft.value;
    __weiv_scope.input = input;
    __weiv_scope.active = active;
    __weiv_scope.send = send;
    __weiv_scope.queue = queue;
    __weiv_scope.steer = steer;
    __weiv_scope.keydown = keydown;
    __weiv_scope.close = close;
    __weiv_scope.respond = respond;
    __weiv_scope.question = question;
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
    __weiv_cellScope.watch(draft, "draft");
    return () => __weiv_cellScope.dispose();
  }
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "wF205ADF3BE871AD3";
export const css = "";

export const trackedStateGraph = { roots: [{ rootId: 1, bindingName: "props", kind: "prop-tracked" }], paths: [{ pathId: 1, rootId: 1, path: "props", parentPathId: null }, { pathId: 2, rootId: 1, path: "props.item", parentPathId: 1 }, { pathId: 3, rootId: 1, path: "props.item.title", parentPathId: 2 }, { pathId: 4, rootId: 1, path: "props.item.agent", parentPathId: 2 }, { pathId: 5, rootId: 1, path: "props.item.agent.id", parentPathId: 4 }, { pathId: 6, rootId: 1, path: "props.item.recentMessages", parentPathId: 2 }, { pathId: 7, rootId: 1, path: "props.item.status", parentPathId: 2 }, { pathId: 8, rootId: 1, path: "props.item.agent.revision", parentPathId: 4 }, { pathId: 9, rootId: 1, path: "props.item.createdAt", parentPathId: 2 }, { pathId: 10, rootId: 1, path: "props.item.queuedWorkIds", parentPathId: 2 }, { pathId: 11, rootId: 1, path: "props.item.foregroundWork", parentPathId: 2 }], regions: [{ regionId: 1, trackedPathIds: [3, 5] }, { regionId: 2, trackedPathIds: [6] }, { regionId: 3, trackedPathIds: [6] }, { regionId: 4, trackedPathIds: [6] }, { regionId: 5, trackedPathIds: [7] }, { regionId: 6, trackedPathIds: [5] }, { regionId: 7, trackedPathIds: [8] }, { regionId: 8, trackedPathIds: [9] }, { regionId: 9, trackedPathIds: [10] }, { regionId: 10, trackedPathIds: [11] }, { regionId: 11, trackedPathIds: [11] }, { regionId: 12, trackedPathIds: [11] }] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_104 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[104] = __ref_104;
  __ref_104.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  const __ref_7 = document.createComment("component:start");
  const __ref_8 = document.createComment("component:end");
  refs[7] = __ref_7;
  refs[8] = __ref_8;
  __ref_104.append(__ref_7);
  __ref_104.append(__ref_8);
  const __props_9 = {"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(instance.refresh()), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(instance.refresh())};
  const __slots_9 = { default: { mountIntoBoundary: (start, end) => mountProjectedSlot_9_0(start, end, instance) } };
  refs[9] = PageHeader.mountIntoBoundary(__ref_7, __ref_8, __props_9, undefined, __slots_9);
  const __ref_100 = (__ref_104.namespaceURI === "http://www.w3.org/2000/svg" && __ref_104.localName !== "foreignObject") || __ref_104.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[100] = __ref_100;
  __ref_100.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_100.setAttribute("class", "split");
  const __ref_53 = (__ref_100.namespaceURI === "http://www.w3.org/2000/svg" && __ref_100.localName !== "foreignObject") || __ref_100.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[53] = __ref_53;
  __ref_53.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_53.setAttribute("class", "stack");
  const __ref_28 = (__ref_53.namespaceURI === "http://www.w3.org/2000/svg" && __ref_53.localName !== "foreignObject") || __ref_53.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
  refs[28] = __ref_28;
  __ref_28.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_28.setAttribute("class", "panel");
  const __ref_13 = (__ref_28.namespaceURI === "http://www.w3.org/2000/svg" && __ref_28.localName !== "foreignObject") || __ref_28.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[13] = __ref_13;
  __ref_13.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_13.setAttribute("class", "section-head");
  const __ref_10 = (__ref_13.namespaceURI === "http://www.w3.org/2000/svg" && __ref_13.localName !== "foreignObject") || __ref_13.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
  refs[10] = __ref_10;
  __ref_10.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_10.append(document.createTextNode("Conversation"));
  __ref_13.append(__ref_10);
  const __ref_12 = (__ref_13.namespaceURI === "http://www.w3.org/2000/svg" && __ref_13.localName !== "foreignObject") || __ref_13.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[12] = __ref_12;
  __ref_12.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_12.setAttribute("class", "muted");
  const __ref_11 = document.createTextNode("");
  refs[11] = __ref_11;
  __ref_12.append(__ref_11);
  __ref_12.append(document.createTextNode(" messages"));
  __ref_13.append(__ref_12);
  __ref_28.append(__ref_13);
  const __ref_27 = (__ref_28.namespaceURI === "http://www.w3.org/2000/svg" && __ref_28.localName !== "foreignObject") || __ref_28.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[27] = __ref_27;
  __ref_27.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_27.setAttribute("class", "message-list");
  const __ref_14 = document.createComment("for:start");
  const __ref_15 = document.createComment("for:end");
  refs[14] = __ref_14;
  refs[15] = __ref_15;
  refs[16] = [];
  __ref_27.append(__ref_14);
  __ref_27.append(__ref_15);
  const __ref_23 = document.createComment("if:start");
  const __ref_24 = document.createComment("if:end");
  refs[23] = __ref_23;
  refs[24] = __ref_24;
  refs[25] = undefined;
  __ref_27.append(__ref_23);
  __ref_27.append(__ref_24);
  __ref_28.append(__ref_27);
  __ref_53.append(__ref_28);
  const __ref_29 = document.createComment("if:start");
  const __ref_30 = document.createComment("if:end");
  refs[29] = __ref_29;
  refs[30] = __ref_30;
  refs[31] = undefined;
  __ref_53.append(__ref_29);
  __ref_53.append(__ref_30);
  __ref_100.append(__ref_53);
  const __ref_99 = (__ref_100.namespaceURI === "http://www.w3.org/2000/svg" && __ref_100.localName !== "foreignObject") || __ref_100.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "aside") : document.createElement("aside");
  refs[99] = __ref_99;
  __ref_99.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_99.setAttribute("class", "stack");
  const __ref_75 = (__ref_99.namespaceURI === "http://www.w3.org/2000/svg" && __ref_99.localName !== "foreignObject") || __ref_99.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "section") : document.createElement("section");
  refs[75] = __ref_75;
  __ref_75.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_75.setAttribute("class", "panel");
  const __ref_54 = (__ref_75.namespaceURI === "http://www.w3.org/2000/svg" && __ref_75.localName !== "foreignObject") || __ref_75.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h2") : document.createElement("h2");
  refs[54] = __ref_54;
  __ref_54.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_54.append(document.createTextNode("Session"));
  __ref_75.append(__ref_54);
  const __ref_74 = (__ref_75.namespaceURI === "http://www.w3.org/2000/svg" && __ref_75.localName !== "foreignObject") || __ref_75.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[74] = __ref_74;
  __ref_74.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_74.setAttribute("class", "fact-list");
  const __ref_58 = (__ref_74.namespaceURI === "http://www.w3.org/2000/svg" && __ref_74.localName !== "foreignObject") || __ref_74.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[58] = __ref_58;
  __ref_58.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_58.setAttribute("class", "fact");
  const __ref_55 = (__ref_58.namespaceURI === "http://www.w3.org/2000/svg" && __ref_58.localName !== "foreignObject") || __ref_58.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[55] = __ref_55;
  __ref_55.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_55.setAttribute("class", "label");
  __ref_55.append(document.createTextNode("Agent"));
  __ref_58.append(__ref_55);
  const __ref_57 = (__ref_58.namespaceURI === "http://www.w3.org/2000/svg" && __ref_58.localName !== "foreignObject") || __ref_58.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[57] = __ref_57;
  __ref_57.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  const __ref_56 = document.createTextNode("");
  refs[56] = __ref_56;
  __ref_57.append(__ref_56);
  __ref_58.append(__ref_57);
  __ref_74.append(__ref_58);
  const __ref_62 = (__ref_74.namespaceURI === "http://www.w3.org/2000/svg" && __ref_74.localName !== "foreignObject") || __ref_74.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[62] = __ref_62;
  __ref_62.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_62.setAttribute("class", "fact");
  const __ref_59 = (__ref_62.namespaceURI === "http://www.w3.org/2000/svg" && __ref_62.localName !== "foreignObject") || __ref_62.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[59] = __ref_59;
  __ref_59.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_59.setAttribute("class", "label");
  __ref_59.append(document.createTextNode("Revision"));
  __ref_62.append(__ref_59);
  const __ref_61 = (__ref_62.namespaceURI === "http://www.w3.org/2000/svg" && __ref_62.localName !== "foreignObject") || __ref_62.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[61] = __ref_61;
  __ref_61.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_61.setAttribute("class", "mono");
  const __ref_60 = document.createTextNode("");
  refs[60] = __ref_60;
  __ref_61.append(__ref_60);
  __ref_62.append(__ref_61);
  __ref_74.append(__ref_62);
  const __ref_66 = (__ref_74.namespaceURI === "http://www.w3.org/2000/svg" && __ref_74.localName !== "foreignObject") || __ref_74.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[66] = __ref_66;
  __ref_66.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_66.setAttribute("class", "fact");
  const __ref_63 = (__ref_66.namespaceURI === "http://www.w3.org/2000/svg" && __ref_66.localName !== "foreignObject") || __ref_66.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[63] = __ref_63;
  __ref_63.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  __ref_63.setAttribute("class", "label");
  __ref_63.append(document.createTextNode("Created"));
  __ref_66.append(__ref_63);
  const __ref_65 = (__ref_66.namespaceURI === "http://www.w3.org/2000/svg" && __ref_66.localName !== "foreignObject") || __ref_66.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "span") : document.createElement("span");
  refs[65] = __ref_65;
  __ref_65.setAttribute("data-weiv-scope", "wF205ADF3BE871AD3");
  const __ref_64 = document.createTextNode("");
  refs[64] = __ref_64;
  __ref_65.append(__ref_64);
  __ref_66.append(__ref_65);
  __ref_74.append(__ref_66);
  const __ref_67 = document.createComment("if:start");
  const __ref_68 = document.createComment("if:end");
  refs[67] = __ref_67;
  refs[68] = __ref_68;
  refs[69] = undefined;
  __ref_74.append(__ref_67);
  __ref_74.append(__ref_68);
  __ref_75.append(__ref_74);
  __ref_99.append(__ref_75);
  const __ref_76 = document.createComment("if:start");
  const __ref_77 = document.createComment("if:end");
  refs[76] = __ref_76;
  refs[77] = __ref_77;
  refs[78] = undefined;
  __ref_99.append(__ref_76);
  __ref_99.append(__ref_77);
  const __ref_91 = document.createComment("if:start");
  const __ref_92 = document.createComment("if:end");
  refs[91] = __ref_91;
  refs[92] = __ref_92;
  refs[93] = undefined;
  __ref_99.append(__ref_91);
  __ref_99.append(__ref_92);
  __ref_100.append(__ref_99);
  __ref_104.append(__ref_100);
  const __ref_101 = document.createComment("component:start");
  const __ref_102 = document.createComment("component:end");
  refs[101] = __ref_101;
  refs[102] = __ref_102;
  __ref_104.append(__ref_101);
  __ref_104.append(__ref_102);
  const __props_103 = {"work": ((__weiv_context) => __weiv_context.__weiv_eval[35](__weiv_context))(instance.refresh())};
  const __handlers_103 = {"respond": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[36](__weiv_context, payload))(instance.refresh()); return resolved; }, "question": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[37](__weiv_context, payload))(instance.refresh()); return resolved; }};
  refs[103] = InteractionList.mountIntoBoundary(__ref_101, __ref_102, __props_103, __handlers_103, undefined);
  fragment.append(__ref_104);
  return fragment;
}

function updateRegion_child_9(instance, scope, refs) {
  if (!refs[9]) return;
  refs[9].setProps({"title": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope), "subtitle": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope)});
  refs[9].setSlots({ default: { mountIntoBoundary: (start, end) => mountProjectedSlot_9_0(start, end, instance) } });
  refs[9].update();
}
function updateRegion_child_2(instance, scope, refs) {
  if (!refs[2]) return;
  refs[2].setProps({"value": ((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(scope)});
  refs[2].update();
}
function updateRegion_conditional_3(instance, scope, refs) {
  updateConditional_3(instance, scope, refs);
}
function updateRegion_text_11(instance, scope, refs) {
  const __next_text_11 = String((((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context))(scope)) ?? "");
  if (refs[11].data !== __next_text_11) {
    refs[11].data = __next_text_11;
  }
}
function updateRegion_loop_14(instance, scope, refs) {
  updateForLoop_14(instance, scope, refs);
}
function updateRegion_attribute_22_class(instance, scope, refs) {
  const __value_22_class = ((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context))(scope);
  const __static_22_class = "message".trim();
  const __dynamic_22_class = __value_22_class === false || __value_22_class === true || __value_22_class === null || __value_22_class === undefined ? "" : String(__value_22_class).trim();
  const __next_22_class = [__static_22_class, __dynamic_22_class].filter(Boolean).join(" ");
  if (__next_22_class) {
    refs[22].setAttribute("class", __next_22_class);
  } else if (refs[22].hasAttribute("class")) {
    refs[22].removeAttribute("class");
  }
}
function updateRegion_text_17(instance, scope, refs) {
  const __next_text_17 = String((((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope)) ?? "");
  if (refs[17].data !== __next_text_17) {
    refs[17].data = __next_text_17;
  }
}
function updateRegion_text_19(instance, scope, refs) {
  const __next_text_19 = String((((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context))(scope)) ?? "");
  if (refs[19].data !== __next_text_19) {
    refs[19].data = __next_text_19;
  }
}
function updateRegion_attribute_21_class(instance, scope, refs) {
  const __value_21_class = ((__weiv_context) => __weiv_context.__weiv_eval[10](__weiv_context))(scope);
  if (__value_21_class === false || __value_21_class === null || __value_21_class === undefined) {
    if (refs[21].hasAttribute("class")) { refs[21].removeAttribute("class"); }
  } else if (__value_21_class === true) {
    if (!refs[21].hasAttribute("class")) { refs[21].setAttribute("class", ""); }
  } else {
    refs[21].setAttribute("class", String(__value_21_class));
  }
}
function updateRegion_attribute_21_href(instance, scope, refs) {
  const __value_21_href = ((__weiv_context) => __weiv_context.__weiv_eval[11](__weiv_context))(scope);
  if (__value_21_href === false || __value_21_href === null || __value_21_href === undefined) {
    if (refs[21].hasAttribute("href")) { refs[21].removeAttribute("href"); }
  } else if (__value_21_href === true) {
    if (!refs[21].hasAttribute("href")) { refs[21].setAttribute("href", ""); }
  } else {
    refs[21].setAttribute("href", String(__value_21_href));
  }
}
function updateRegion_conditional_23(instance, scope, refs) {
  updateConditional_23(instance, scope, refs);
}
function updateRegion_conditional_29(instance, scope, refs) {
  updateConditional_29(instance, scope, refs);
}
function updateRegion_text_33(instance, scope, refs) {
  const __next_text_33 = String((((__weiv_context) => __weiv_context.__weiv_eval[14](__weiv_context))(scope)) ?? "");
  if (refs[33].data !== __next_text_33) {
    refs[33].data = __next_text_33;
  }
}
function updateRegion_conditional_36(instance, scope, refs) {
  updateConditional_36(instance, scope, refs);
}
function updateRegion_child_41(instance, scope, refs) {
  if (!refs[41]) return;
  refs[41].setProps({"value": ((__weiv_context) => __weiv_context.__weiv_eval[16](__weiv_context))(scope)});
  refs[41].update();
}
function updateRegion_attribute_44_value(instance, scope, refs) {
  const __value_44_value = ((__weiv_context) => __weiv_context.__weiv_eval[17](__weiv_context))(scope);
  const __next_44_value = __value_44_value ?? "";
  const __next_string_44_value = String(__next_44_value);
  if (refs[44].value !== __next_string_44_value) {
    refs[44].value = __next_string_44_value;
  }
  refs[44].setAttribute("value", __next_string_44_value);
}
function updateRegion_text_45(instance, scope, refs) {
  const __next_text_45 = String((((__weiv_context) => __weiv_context.__weiv_eval[21](__weiv_context))(scope)) ?? "");
  if (refs[45].data !== __next_text_45) {
    refs[45].data = __next_text_45;
  }
}
function updateRegion_conditional_47(instance, scope, refs) {
  updateConditional_47(instance, scope, refs);
}
function updateRegion_text_56(instance, scope, refs) {
  const __next_text_56 = String((((__weiv_context) => __weiv_context.__weiv_eval[24](__weiv_context))(scope)) ?? "");
  if (refs[56].data !== __next_text_56) {
    refs[56].data = __next_text_56;
  }
}
function updateRegion_text_60(instance, scope, refs) {
  const __next_text_60 = String((((__weiv_context) => __weiv_context.__weiv_eval[25](__weiv_context))(scope)) ?? "");
  if (refs[60].data !== __next_text_60) {
    refs[60].data = __next_text_60;
  }
}
function updateRegion_text_64(instance, scope, refs) {
  const __next_text_64 = String((((__weiv_context) => __weiv_context.__weiv_eval[26](__weiv_context))(scope)) ?? "");
  if (refs[64].data !== __next_text_64) {
    refs[64].data = __next_text_64;
  }
}
function updateRegion_conditional_67(instance, scope, refs) {
  updateConditional_67(instance, scope, refs);
}
function updateRegion_text_71(instance, scope, refs) {
  const __next_text_71 = String((((__weiv_context) => __weiv_context.__weiv_eval[28](__weiv_context))(scope)) ?? "");
  if (refs[71].data !== __next_text_71) {
    refs[71].data = __next_text_71;
  }
}
function updateRegion_conditional_76(instance, scope, refs) {
  updateConditional_76(instance, scope, refs);
}
function updateRegion_child_82(instance, scope, refs) {
  if (!refs[82]) return;
  refs[82].setProps({"value": ((__weiv_context) => __weiv_context.__weiv_eval[30](__weiv_context))(scope)});
  refs[82].update();
}
function updateRegion_text_84(instance, scope, refs) {
  const __next_text_84 = String((((__weiv_context) => __weiv_context.__weiv_eval[31](__weiv_context))(scope)) ?? "");
  if (refs[84].data !== __next_text_84) {
    refs[84].data = __next_text_84;
  }
}
function updateRegion_text_86(instance, scope, refs) {
  const __next_text_86 = String((((__weiv_context) => __weiv_context.__weiv_eval[32](__weiv_context))(scope)) ?? "");
  if (refs[86].data !== __next_text_86) {
    refs[86].data = __next_text_86;
  }
}
function updateRegion_attribute_88_href(instance, scope, refs) {
  const __value_88_href = ((__weiv_context) => __weiv_context.__weiv_eval[33](__weiv_context))(scope);
  if (__value_88_href === false || __value_88_href === null || __value_88_href === undefined) {
    if (refs[88].hasAttribute("href")) { refs[88].removeAttribute("href"); }
  } else if (__value_88_href === true) {
    if (!refs[88].hasAttribute("href")) { refs[88].setAttribute("href", ""); }
  } else {
    refs[88].setAttribute("href", String(__value_88_href));
  }
}
function updateRegion_conditional_91(instance, scope, refs) {
  updateConditional_91(instance, scope, refs);
}
function updateRegion_child_103(instance, scope, refs) {
  if (!refs[103]) return;
  refs[103].setProps({"work": ((__weiv_context) => __weiv_context.__weiv_eval[35](__weiv_context))(scope)});
  refs[103].setEventHandlers({"respond": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[36](__weiv_context, payload))(scope); return resolved; }, "question": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[37](__weiv_context, payload))(scope); return resolved; }});
  refs[103].update();
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_9(instance, scope, refs);
  updateRegion_text_11(instance, scope, refs);
  updateRegion_loop_14(instance, scope, refs);
  updateRegion_conditional_23(instance, scope, refs);
  updateRegion_conditional_29(instance, scope, refs);
  updateRegion_text_56(instance, scope, refs);
  updateRegion_text_60(instance, scope, refs);
  updateRegion_text_64(instance, scope, refs);
  updateRegion_conditional_67(instance, scope, refs);
  updateRegion_conditional_76(instance, scope, refs);
  updateRegion_conditional_91(instance, scope, refs);
  updateRegion_child_103(instance, scope, refs);
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
  if (dirtySet.has("props") || dirtySet.has("active") || dirtySet.has("isTerminal") || dirtyRegionSet.has(1)) {
    updateRegion_child_9(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(2)) {
    updateRegion_text_11(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtySet.has("display") || dirtyRegionSet.has(3)) {
    updateRegion_loop_14(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(4)) {
    updateRegion_conditional_23(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtySet.has("active") || dirtySet.has("isTerminal") || dirtySet.has("draft") || dirtyRegionSet.has(5)) {
    updateRegion_conditional_29(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(6)) {
    updateRegion_text_56(instance, scope, refs);
  }
  if (dirtySet.has("short") || dirtySet.has("props") || dirtyRegionSet.has(7)) {
    updateRegion_text_60(instance, scope, refs);
  }
  if (dirtySet.has("time") || dirtySet.has("props") || dirtyRegionSet.has(8)) {
    updateRegion_text_64(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(9)) {
    updateRegion_conditional_67(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(10)) {
    updateRegion_conditional_76(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtyRegionSet.has(11)) {
    updateRegion_conditional_91(instance, scope, refs);
  }
  if (dirtySet.has("props") || dirtySet.has("respond") || dirtySet.has("question") || dirtyRegionSet.has(12)) {
    updateRegion_child_103(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[9] && typeof refs[9].destroy === "function") {
    refs[9].destroy();
  }
  refs[9] = undefined;
  const __records_16 = refs[16] ?? [];
  for (const record of __records_16) {
    if (record.handle && typeof record.handle.destroy === "function") {
      record.handle.destroy();
    } else if (typeof record.destroy === "function") {
      record.destroy();
    }
  }
  if (refs[25] === true) {
  } else {
  }
  if (refs[31] === true) {
    if (refs[38] === true) {
      if (refs[41] && typeof refs[41].destroy === "function") {
        refs[41].destroy();
      }
      refs[41] = undefined;
    } else {
    }
    if (refs[49] === true) {
    } else {
    }
  } else {
  }
  if (refs[69] === true) {
  } else {
  }
  if (refs[78] === true) {
    if (refs[82] && typeof refs[82].destroy === "function") {
      refs[82].destroy();
    }
    refs[82] = undefined;
  } else {
  }
  if (refs[93] === true) {
  } else {
  }
  if (refs[103] && typeof refs[103].destroy === "function") {
    refs[103].destroy();
  }
  refs[103] = undefined;
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
