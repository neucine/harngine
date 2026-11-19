import { isObservable as __weiv_isObservable, createCell as __weiv_createCell, createCellScope as __weiv_createCellScope, unbindCellValue as __weiv_unbindCellValue, normalizeCellValue as __weiv_normalizeCellValue, cellAssignmentTarget as __weiv_cellAssignmentTarget, bindingObject as __weiv_bindingObject, bindingIterator as __weiv_bindingIterator, initializeClassName as __weiv_initializeClassName } from "./__weiv_runtime/cell.js";
import { moduleState as __weiv_publisher_0 } from "./__weiv_modules/8f9bcec8c215c7a6.publisher.mjs";
import { moduleState as __weiv_publisher_1 } from "./__weiv_modules/8f9bcec8c215c7a6.publisher.mjs";
import { moduleState as __weiv_publisher_2 } from "./__weiv_modules/8f9bcec8c215c7a6.publisher.mjs";
import { moduleState as __weiv_publisher_3 } from "./__weiv_modules/8f9bcec8c215c7a6.publisher.mjs";
import * as Sidebar from "./components/Sidebar.mjs";
import * as InputDialog from "./components/InputDialog.mjs";
import * as Definitions from "./views/Definitions.mjs";
import * as Definition from "./views/Definition.mjs";
import * as Sessions from "./views/Sessions.mjs";
import * as Session from "./views/Session.mjs";
import * as Works from "./views/Works.mjs";
import * as Work from "./views/Work.mjs";
import * as Audit from "./views/Audit.mjs";
import { api as __weiv_import_api } from "./__weiv_modules/8f9bcec8c215c7a6.mjs";
import { createWatchHandle as __weiv_import_createWatchHandle } from "./__weiv_modules/8f9bcec8c215c7a6.mjs";
import { isTerminal as __weiv_import_isTerminal } from "./__weiv_modules/8f9bcec8c215c7a6.mjs";
import { pretty as __weiv_import_pretty } from "./__weiv_modules/8f9bcec8c215c7a6.mjs";
import { short as __weiv_import_short } from "./__weiv_modules/8f9bcec8c215c7a6.mjs";
import { watch as __weiv_import_watch } from "./__weiv_modules/8f9bcec8c215c7a6.mjs";

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
    const __ref_7 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[7] = __ref_7;
    __ref_7.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    __ref_7.setAttribute("class", "error");
    __ref_7.setAttribute("role", "alert");
    const __ref_6 = document.createTextNode("");
    refs[6] = __ref_6;
    __ref_7.append(__ref_6);
    fragment.append(__ref_7);
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
    updateRegion_text_6(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_8(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[8].parentNode?.localName === "foreignObject" ? undefined : refs[8].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_11 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[11] = __ref_11;
    __ref_11.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    __ref_11.setAttribute("class", "empty");
    __ref_11.append(document.createTextNode("Loading Workbench…"));
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
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context))(scope));
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

function createConditionalFragment_12(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[12].parentNode?.localName === "foreignObject" ? undefined : refs[12].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_18 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[18] = __ref_18;
    __ref_18.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_15 = document.createComment("component:start");
    const __ref_16 = document.createComment("component:end");
    refs[15] = __ref_15;
    refs[16] = __ref_16;
    __ref_18.append(__ref_15);
    __ref_18.append(__ref_16);
    const __props_17 = {"items": ((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context))(scope), "history": ((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope)};
    const __handlers_17 = {"toggle-history": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context, payload))(scope); return resolved; }};
    refs[17] = Definitions.mountIntoBoundary(__ref_15, __ref_16, __props_17, __handlers_17, undefined);
    fragment.append(__ref_18);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_12(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[17] && typeof refs[17].destroy === "function") {
      refs[17].destroy();
    }
    refs[17] = undefined;
  } else {
  }
}

function updateConditional_12(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[6](__weiv_context))(scope));
  if (refs[14] !== next) {
    const previous = refs[14];
    destroyConditionalBranch_12(instance, refs, previous === true);
    refs[14] = next;
    replaceBetween(refs[12], refs[13], createConditionalFragment_12(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_17(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_19(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[19].parentNode?.localName === "foreignObject" ? undefined : refs[19].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_25 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[25] = __ref_25;
    __ref_25.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_22 = document.createComment("component:start");
    const __ref_23 = document.createComment("component:end");
    refs[22] = __ref_22;
    refs[23] = __ref_23;
    __ref_25.append(__ref_22);
    __ref_25.append(__ref_23);
    const __props_24 = {"item": ((__weiv_context) => __weiv_context.__weiv_eval[11](__weiv_context))(scope)};
    const __handlers_24 = {"new-session": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[12](__weiv_context, payload))(scope); return resolved; }, "start-work": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[13](__weiv_context, payload))(scope); return resolved; }};
    refs[24] = Definition.mountIntoBoundary(__ref_22, __ref_23, __props_24, __handlers_24, undefined);
    fragment.append(__ref_25);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_19(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[24] && typeof refs[24].destroy === "function") {
      refs[24].destroy();
    }
    refs[24] = undefined;
  } else {
  }
}

function updateConditional_19(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[10](__weiv_context))(scope));
  if (refs[21] !== next) {
    const previous = refs[21];
    destroyConditionalBranch_19(instance, refs, previous === true);
    refs[21] = next;
    replaceBetween(refs[19], refs[20], createConditionalFragment_19(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_24(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_26(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[26].parentNode?.localName === "foreignObject" ? undefined : refs[26].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_32 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[32] = __ref_32;
    __ref_32.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_29 = document.createComment("component:start");
    const __ref_30 = document.createComment("component:end");
    refs[29] = __ref_29;
    refs[30] = __ref_30;
    __ref_32.append(__ref_29);
    __ref_32.append(__ref_30);
    const __props_31 = {"items": ((__weiv_context) => __weiv_context.__weiv_eval[15](__weiv_context))(scope)};
    refs[31] = Sessions.mountIntoBoundary(__ref_29, __ref_30, __props_31, undefined, undefined);
    fragment.append(__ref_32);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_26(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[31] && typeof refs[31].destroy === "function") {
      refs[31].destroy();
    }
    refs[31] = undefined;
  } else {
  }
}

function updateConditional_26(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[14](__weiv_context))(scope));
  if (refs[28] !== next) {
    const previous = refs[28];
    destroyConditionalBranch_26(instance, refs, previous === true);
    refs[28] = next;
    replaceBetween(refs[26], refs[27], createConditionalFragment_26(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_31(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_33(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[33].parentNode?.localName === "foreignObject" ? undefined : refs[33].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_39 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[39] = __ref_39;
    __ref_39.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_36 = document.createComment("component:start");
    const __ref_37 = document.createComment("component:end");
    refs[36] = __ref_36;
    refs[37] = __ref_37;
    __ref_39.append(__ref_36);
    __ref_39.append(__ref_37);
    const __props_38 = {"item": ((__weiv_context) => __weiv_context.__weiv_eval[17](__weiv_context))(scope)};
    const __handlers_38 = {"send": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[18](__weiv_context, payload))(scope); return resolved; }, "close": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[19](__weiv_context, payload))(scope); return resolved; }, "respond": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[20](__weiv_context, payload))(scope); return resolved; }, "question": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[21](__weiv_context, payload))(scope); return resolved; }};
    refs[38] = Session.mountIntoBoundary(__ref_36, __ref_37, __props_38, __handlers_38, undefined);
    fragment.append(__ref_39);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_33(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[38] && typeof refs[38].destroy === "function") {
      refs[38].destroy();
    }
    refs[38] = undefined;
  } else {
  }
}

function updateConditional_33(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[16](__weiv_context))(scope));
  if (refs[35] !== next) {
    const previous = refs[35];
    destroyConditionalBranch_33(instance, refs, previous === true);
    refs[35] = next;
    replaceBetween(refs[33], refs[34], createConditionalFragment_33(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_38(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_40(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[40].parentNode?.localName === "foreignObject" ? undefined : refs[40].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_46 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[46] = __ref_46;
    __ref_46.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_43 = document.createComment("component:start");
    const __ref_44 = document.createComment("component:end");
    refs[43] = __ref_43;
    refs[44] = __ref_44;
    __ref_46.append(__ref_43);
    __ref_46.append(__ref_44);
    const __props_45 = {"items": ((__weiv_context) => __weiv_context.__weiv_eval[23](__weiv_context))(scope)};
    refs[45] = Works.mountIntoBoundary(__ref_43, __ref_44, __props_45, undefined, undefined);
    fragment.append(__ref_46);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_40(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[45] && typeof refs[45].destroy === "function") {
      refs[45].destroy();
    }
    refs[45] = undefined;
  } else {
  }
}

function updateConditional_40(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[22](__weiv_context))(scope));
  if (refs[42] !== next) {
    const previous = refs[42];
    destroyConditionalBranch_40(instance, refs, previous === true);
    refs[42] = next;
    replaceBetween(refs[40], refs[41], createConditionalFragment_40(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_45(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_47(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[47].parentNode?.localName === "foreignObject" ? undefined : refs[47].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_53 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[53] = __ref_53;
    __ref_53.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_50 = document.createComment("component:start");
    const __ref_51 = document.createComment("component:end");
    refs[50] = __ref_50;
    refs[51] = __ref_51;
    __ref_53.append(__ref_50);
    __ref_53.append(__ref_51);
    const __props_52 = {"item": ((__weiv_context) => __weiv_context.__weiv_eval[25](__weiv_context))(scope), "entries": ((__weiv_context) => __weiv_context.__weiv_eval[26](__weiv_context))(scope), "detail": ((__weiv_context) => __weiv_context.__weiv_eval[27](__weiv_context))(scope), "next": ((__weiv_context) => __weiv_context.__weiv_eval[28](__weiv_context))(scope), "preview": ((__weiv_context) => __weiv_context.__weiv_eval[29](__weiv_context))(scope)};
    const __handlers_52 = {"cancel": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[30](__weiv_context, payload))(scope); return resolved; }, "detail": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[31](__weiv_context, payload))(scope); return resolved; }, "more": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[32](__weiv_context, payload))(scope); return resolved; }, "respond": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[33](__weiv_context, payload))(scope); return resolved; }, "question": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[34](__weiv_context, payload))(scope); return resolved; }};
    refs[52] = Work.mountIntoBoundary(__ref_50, __ref_51, __props_52, __handlers_52, undefined);
    fragment.append(__ref_53);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_47(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[52] && typeof refs[52].destroy === "function") {
      refs[52].destroy();
    }
    refs[52] = undefined;
  } else {
  }
}

function updateConditional_47(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[24](__weiv_context))(scope));
  if (refs[49] !== next) {
    const previous = refs[49];
    destroyConditionalBranch_47(instance, refs, previous === true);
    refs[49] = next;
    replaceBetween(refs[47], refs[48], createConditionalFragment_47(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_52(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_54(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[54].parentNode?.localName === "foreignObject" ? undefined : refs[54].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_60 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[60] = __ref_60;
    __ref_60.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_57 = document.createComment("component:start");
    const __ref_58 = document.createComment("component:end");
    refs[57] = __ref_57;
    refs[58] = __ref_58;
    __ref_60.append(__ref_57);
    __ref_60.append(__ref_58);
    const __props_59 = {"entries": ((__weiv_context) => __weiv_context.__weiv_eval[36](__weiv_context))(scope), "category": ((__weiv_context) => __weiv_context.__weiv_eval[37](__weiv_context))(scope), "next": ((__weiv_context) => __weiv_context.__weiv_eval[38](__weiv_context))(scope)};
    const __handlers_59 = {"category": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[39](__weiv_context, payload))(scope); return resolved; }, "more": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[40](__weiv_context, payload))(scope); return resolved; }};
    refs[59] = Audit.mountIntoBoundary(__ref_57, __ref_58, __props_59, __handlers_59, undefined);
    fragment.append(__ref_60);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_54(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[59] && typeof refs[59].destroy === "function") {
      refs[59].destroy();
    }
    refs[59] = undefined;
  } else {
  }
}

function updateConditional_54(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[35](__weiv_context))(scope));
  if (refs[56] !== next) {
    const previous = refs[56];
    destroyConditionalBranch_54(instance, refs, previous === true);
    refs[56] = next;
    replaceBetween(refs[54], refs[55], createConditionalFragment_54(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_59(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_61(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[61].parentNode?.localName === "foreignObject" ? undefined : refs[61].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_67 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[67] = __ref_67;
    __ref_67.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_64 = (__ref_67.namespaceURI === "http://www.w3.org/2000/svg" && __ref_67.localName !== "foreignObject") || __ref_67.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "h1") : document.createElement("h1");
    refs[64] = __ref_64;
    __ref_64.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    __ref_64.append(document.createTextNode("Not found"));
    __ref_67.append(__ref_64);
    const __ref_66 = (__ref_67.namespaceURI === "http://www.w3.org/2000/svg" && __ref_67.localName !== "foreignObject") || __ref_67.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "p") : document.createElement("p");
    refs[66] = __ref_66;
    __ref_66.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_65 = document.createTextNode("");
    refs[65] = __ref_65;
    __ref_66.append(__ref_65);
    __ref_67.append(__ref_66);
    fragment.append(__ref_67);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_61(instance, refs, wasConsequent) {
  if (wasConsequent) {
  } else {
  }
}

function updateConditional_61(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[41](__weiv_context))(scope));
  if (refs[63] !== next) {
    const previous = refs[63];
    destroyConditionalBranch_61(instance, refs, previous === true);
    refs[63] = next;
    replaceBetween(refs[61], refs[62], createConditionalFragment_61(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_text_65(instance, scope, refs);
  } else {
  }
}

function createConditionalFragment_69(instance, scope, refs, isConsequent) {
  const fragment = document.createDocumentFragment();
  fragment.__weiv_namespace = refs[69].parentNode?.localName === "foreignObject" ? undefined : refs[69].parentNode?.namespaceURI;
  if (isConsequent) {
    const __ref_75 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
    refs[75] = __ref_75;
    __ref_75.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
    const __ref_72 = document.createComment("component:start");
    const __ref_73 = document.createComment("component:end");
    refs[72] = __ref_72;
    refs[73] = __ref_73;
    __ref_75.append(__ref_72);
    __ref_75.append(__ref_73);
    const __props_74 = {"open": ((__weiv_context) => __weiv_context.__weiv_eval[44](__weiv_context))(scope), "title": ((__weiv_context) => __weiv_context.__weiv_eval[45](__weiv_context))(scope), "help": ((__weiv_context) => __weiv_context.__weiv_eval[46](__weiv_context))(scope), "initial": ((__weiv_context) => __weiv_context.__weiv_eval[47](__weiv_context))(scope), "fields": ((__weiv_context) => __weiv_context.__weiv_eval[48](__weiv_context))(scope)};
    const __handlers_74 = {"cancel": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[49](__weiv_context, payload))(scope); return resolved; }, "submit": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[50](__weiv_context, payload))(scope); return resolved; }};
    refs[74] = InputDialog.mountIntoBoundary(__ref_72, __ref_73, __props_74, __handlers_74, undefined);
    fragment.append(__ref_75);
  } else {
  }
  return fragment;
}

function destroyConditionalBranch_69(instance, refs, wasConsequent) {
  if (wasConsequent) {
    if (refs[74] && typeof refs[74].destroy === "function") {
      refs[74].destroy();
    }
    refs[74] = undefined;
  } else {
  }
}

function updateConditional_69(instance, scope, refs) {
  const next = Boolean(((__weiv_context) => __weiv_context.__weiv_eval[43](__weiv_context))(scope));
  if (refs[71] !== next) {
    const previous = refs[71];
    destroyConditionalBranch_69(instance, refs, previous === true);
    refs[71] = next;
    replaceBetween(refs[69], refs[70], createConditionalFragment_69(instance, scope, refs, next));
  }
  if (next) {
    updateRegion_child_74(instance, scope, refs);
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
let missingPath = __weiv_createCell("");
let active = __weiv_createCell("definitions");
let view = __weiv_createCell("");
let data = __weiv_createCell(null);
let loading = __weiv_createCell(true);
let error = __weiv_createCell("");
let connected = __weiv_createCell(true);
let connectionNote = __weiv_createCell("public App API");
const manageWatch = __weiv_createCell(__weiv_import_createWatchHandle());
let showHistory = __weiv_createCell(false);
let inspection = __weiv_createCell([]);
let detail = __weiv_createCell("story");
let inspectionNext = __weiv_createCell("");
let preview = __weiv_createCell("");
let auditNext = __weiv_createCell("");
let category = __weiv_createCell("");
let inputOpen = __weiv_createCell(false);
let inputTitle = __weiv_createCell("");
let inputHelp = __weiv_createCell("");
let inputInitial = __weiv_createCell("null");
let inputFields = __weiv_createCell([]);
let inputSchema = null;
let inputSubmit = __weiv_createCell(null);
function prepareSession(value) {
	return {
		...value,
		recentMessages: (value.recentMessages || []).map((message) => ({
			...message,
			workUrl: message.workId ? "/work/" + encodeURIComponent(message.workId) : ""
		}))
	};
}
function prepareWork(value) {
	return {
		...value,
		subtitle: value.definition.id + " · " + __weiv_import_short(value.id)
	};
}
function parts() {
	return location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
}
function navigate(path) {
	history.pushState({}, "", path);
	return load();
}
function closeWatch() {
	__weiv_unbindCellValue(manageWatch.value)();
}
function showError(cause) {
	__weiv_cellAssignmentTarget(() => error).value = __weiv_normalizeCellValue((cause?.code ? cause.code + " · " : "") + (cause?.message || String(cause)));
}
function schemaValue(schema) {
	if (schema?.default !== undefined) return schema.default;
	if (schema?.type === "object") return Object.fromEntries(Object.entries(schema.properties || {}).map(([name, child]) => [name, schemaValue(child)]));
	if (schema?.type === "array") return [];
	if (schema?.type === "boolean") return false;
	if (schema?.type === "number" || schema?.type === "integer") return 0;
	return "";
}
function fieldsFor(schema, value, path = "") {
	if (schema?.type === "object") return Object.entries(schema.properties || {}).flatMap(([name, child]) => fieldsFor(child, value?.[name], path ? path + "." + name : name));
	return [{
		label: path || "Value",
		path,
		type: schema?.type || "string",
		value: schema?.type === "array" || schema?.type === "object" ? __weiv_import_pretty(value) : String(value ?? "")
	}];
}
function openInput(title, schema, help, submit) {
	const value = schemaValue(schema);
	__weiv_cellAssignmentTarget(() => inputTitle).value = __weiv_normalizeCellValue(title);
	__weiv_cellAssignmentTarget(() => inputHelp).value = __weiv_normalizeCellValue(help);
	inputSchema = schema;
	__weiv_cellAssignmentTarget(() => inputInitial).value = __weiv_normalizeCellValue(__weiv_import_pretty(value));
	__weiv_cellAssignmentTarget(() => inputFields).value = __weiv_normalizeCellValue(fieldsFor(schema, value));
	__weiv_cellAssignmentTarget(() => inputSubmit).value = __weiv_normalizeCellValue(submit);
	__weiv_cellAssignmentTarget(() => inputOpen).value = __weiv_normalizeCellValue(true);
}
function dismissInput() {
	__weiv_cellAssignmentTarget(() => inputOpen).value = __weiv_normalizeCellValue(false);
}
async function submitInput(value) {
	try {
		await __weiv_unbindCellValue(inputSubmit.value)?.(value);
		__weiv_cellAssignmentTarget(() => inputOpen).value = __weiv_normalizeCellValue(false);
	} catch (cause) {
		showError(cause);
	}
}
function newSession(item) {
	openInput("New Session", {
		type: "string",
		default: item.id
	}, "Choose a title for this Agent Session.", async (title) => {
		const session = await __weiv_import_api("/sessions", {
			method: "POST",
			body: JSON.stringify({
				agent: {
					object: "definition",
					type: item.type,
					id: item.id,
					revision: item.revision
				},
				title
			})
		});
		return navigate("/sessions/" + encodeURIComponent(session.id));
	});
}
function startWork(item) {
	openInput("Start " + item.id, item.objective, "The server validates this value against the Definition contract.", async (objective) => {
		const work = await __weiv_import_api("/works", {
			method: "POST",
			body: JSON.stringify({
				definition: {
					object: "definition",
					type: item.type,
					id: item.id,
					revision: item.revision
				},
				objective
			})
		});
		return navigate("/work/" + encodeURIComponent(work.id));
	});
}
function question(value) {
	openInput("Reply to question", value.item.response, value.item.prompt, async (response) => respond({
		...value,
		id: value.item.id,
		response
	}));
}
async function respond(value) {
	try {
		await __weiv_import_api("/works/" + encodeURIComponent(value.work) + "/interactions/" + encodeURIComponent(value.id) + "/response", {
			method: "POST",
			body: JSON.stringify({ response: value.response })
		});
	} catch (cause) {
		showError(cause);
	}
}
async function sendMessage(value) {
	try {
		await __weiv_import_api("/sessions/" + encodeURIComponent(value.id) + "/messages", {
			method: "POST",
			body: JSON.stringify({
				content: value.content,
				delivery: value.delivery
			})
		});
	} catch (cause) {
		showError(cause);
	}
}
async function closeSession(id) {
	try {
		await __weiv_import_api("/sessions/" + encodeURIComponent(id) + "/close", {
			method: "POST",
			body: "{}"
		});
		await load();
	} catch (cause) {
		showError(cause);
	}
}
async function cancelWork(id) {
	try {
		await __weiv_import_api("/works/" + encodeURIComponent(id) + "/cancel", {
			method: "POST",
			body: JSON.stringify({ reason: "Canceled from Workbench" })
		});
	} catch (cause) {
		showError(cause);
	}
}
async function loadInspection(after = "") {
	if (view.value !== "work") return;
	try {
		const page = await __weiv_import_api("/works/" + encodeURIComponent(data.value.id) + "/inspection?detail=" + detail.value + "&limit=100" + (after ? "&after=" + encodeURIComponent(after) : ""));
		__weiv_cellAssignmentTarget(() => inspection).value = __weiv_normalizeCellValue(after ? [...inspection.value, ...page.entries] : page.entries);
		__weiv_cellAssignmentTarget(() => inspectionNext).value = __weiv_normalizeCellValue(page.hasMore ? page.next || "" : "");
	} catch (cause) {
		showError(cause);
	}
}
function changeDetail(value) {
	__weiv_cellAssignmentTarget(() => detail).value = __weiv_normalizeCellValue(value);
	return loadInspection();
}
function moreInspection(after) {
	return loadInspection(after);
}
async function loadAudit(after = "") {
	const query = "limit=50" + (category.value ? "&category=" + encodeURIComponent(category.value) : "") + (after ? "&after=" + encodeURIComponent(after) : "");
	const page = await __weiv_import_api("/audit?" + query);
	const entries = page.entries.map((entry) => ({
		...entry,
		correlationText: Object.entries(entry.correlation || {}).map(([name, value]) => name + " · " + value).join(" · "),
		reasonText: entry.reason ? entry.reason.code + " · " + entry.reason.message : "—"
	}));
	__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue(after ? [...data.value, ...entries] : entries);
	__weiv_cellAssignmentTarget(() => auditNext).value = __weiv_normalizeCellValue(page.next || "");
}
function changeCategory(value) {
	return navigate("/audit" + (value ? "?category=" + encodeURIComponent(value) : ""));
}
async function moreAudit(after) {
	try {
		await loadAudit(after);
	} catch (cause) {
		showError(cause);
	}
}
function toggleHistory() {
	return navigate(showHistory.value ? "/definitions" : "/definitions?history=1");
}
async function load() {
	closeWatch();
	__weiv_cellAssignmentTarget(() => error).value = __weiv_normalizeCellValue("");
	__weiv_cellAssignmentTarget(() => loading).value = __weiv_normalizeCellValue(true);
	__weiv_cellAssignmentTarget(() => preview).value = __weiv_normalizeCellValue("");
	__weiv_cellAssignmentTarget(() => inspection).value = __weiv_normalizeCellValue([]);
	__weiv_cellAssignmentTarget(() => inspectionNext).value = __weiv_normalizeCellValue("");
	const route = parts();
	try {
		if (!route.length) {
			await navigate("/definitions");
			return;
		}
		__weiv_cellAssignmentTarget(() => active).value = __weiv_normalizeCellValue(route[0] === "definitions" ? "definitions" : route[0] === "sessions" ? "sessions" : route[0] === "audit" ? "audit" : "work");
		if (route[0] === "definitions" && route.length === 1) {
			__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("definitions");
			__weiv_cellAssignmentTarget(() => showHistory).value = __weiv_normalizeCellValue(new URLSearchParams(location.search).get("history") === "1");
			__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue((await __weiv_import_api("/definitions?" + (showHistory.value ? "" : "availability=available&") + "limit=100")).definitions);
		} else if (route[0] === "definitions" && route.length === 4) {
			__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("definition");
			const definition = await __weiv_import_api("/definitions/" + route.slice(1).map(encodeURIComponent).join("/"));
			__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue({
				...definition,
				subtitle: definition.type + " · " + __weiv_import_short(definition.revision)
			});
		} else if (route[0] === "sessions" && route.length === 1) {
			__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("sessions");
			__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue((await __weiv_import_api("/sessions?limit=100")).sessions.map((item) => ({
				...item,
				url: "/sessions/" + encodeURIComponent(item.id)
			})));
		} else if (route[0] === "sessions" && route.length === 2) {
			__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("session");
			__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue(prepareSession(await __weiv_import_api("/sessions/" + encodeURIComponent(route[1]))));
			__weiv_unbindCellValue(manageWatch.value)(__weiv_import_watch("sessions", route[1], (value) => {
				__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue(prepareSession(value));
				__weiv_cellAssignmentTarget(() => connected).value = __weiv_normalizeCellValue(true);
				__weiv_cellAssignmentTarget(() => connectionNote).value = __weiv_normalizeCellValue("Live updates");
			}, () => {
				__weiv_cellAssignmentTarget(() => connected).value = __weiv_normalizeCellValue(false);
				__weiv_cellAssignmentTarget(() => connectionNote).value = __weiv_normalizeCellValue("Last durable state shown");
			}));
		} else if (route[0] === "work" && route.length === 1) {
			__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("works");
			__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue((await __weiv_import_api("/works?limit=100")).works.map((item) => ({
				...item,
				url: "/work/" + encodeURIComponent(item.id)
			})));
		} else if (route[0] === "work" && route.length === 2) {
			__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("work");
			__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue(prepareWork(await __weiv_import_api("/works/" + encodeURIComponent(route[1]))));
			__weiv_cellAssignmentTarget(() => detail).value = __weiv_normalizeCellValue("story");
			await loadInspection();
			if (!__weiv_import_isTerminal(data.value.status)) {
				__weiv_unbindCellValue(manageWatch.value)(__weiv_import_watch("works", route[1], (value) => {
					__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue(prepareWork(value));
					__weiv_cellAssignmentTarget(() => connected).value = __weiv_normalizeCellValue(true);
					__weiv_cellAssignmentTarget(() => connectionNote).value = __weiv_normalizeCellValue("Live updates");
					if (__weiv_import_isTerminal(value.status)) {
						__weiv_cellAssignmentTarget(() => preview).value = __weiv_normalizeCellValue("");
						closeWatch();
					}
				}, () => {
					__weiv_cellAssignmentTarget(() => connected).value = __weiv_normalizeCellValue(false);
					__weiv_cellAssignmentTarget(() => connectionNote).value = __weiv_normalizeCellValue("Last durable state shown");
				}))?.addEventListener("model.delta", (event) => {
					const delta = JSON.parse(event.data);
					if (delta.item?.type === "text" && delta.workId === data.value.id) __weiv_cellAssignmentTarget(() => preview).value = __weiv_normalizeCellValue((preview.value + delta.item.text).slice(-131072));
				});
			} else __weiv_cellAssignmentTarget(() => connectionNote).value = __weiv_normalizeCellValue("Durable terminal state");
		} else if (route[0] === "audit" && route.length === 1) {
			__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("audit");
			__weiv_cellAssignmentTarget(() => category).value = __weiv_normalizeCellValue(new URLSearchParams(location.search).get("category") || "");
			__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue([]);
			await loadAudit();
		} else {
			__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("missing");
			__weiv_cellAssignmentTarget(() => missingPath).value = __weiv_normalizeCellValue(location.pathname);
			__weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue(null);
		}
	} catch (cause) {
		showError(cause);
		__weiv_cellAssignmentTarget(() => view).value = __weiv_normalizeCellValue("missing");
	} finally {
		__weiv_cellAssignmentTarget(() => loading).value = __weiv_normalizeCellValue(false);
	}
}
document.addEventListener("click", (event) => {
	const anchor = event.target.closest?.("a[href^=\"/\"]");
	if (anchor && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
		event.preventDefault();
		navigate(anchor.pathname + anchor.search);
	}
});
addEventListener("popstate", () => {
	void load();
});
void load();
;
const __weiv_templateExpressions = [
	(__weiv_context) => {
		return active.value;
	},
	(__weiv_context) => {
		return connected.value;
	},
	(__weiv_context) => {
		return connectionNote.value;
	},
	(__weiv_context) => {
		return error.value;
	},
	(__weiv_context) => {
		return error.value;
	},
	(__weiv_context) => {
		return loading.value;
	},
	(__weiv_context) => {
		return !loading.value && view.value === "definitions";
	},
	(__weiv_context) => {
		return data.value;
	},
	(__weiv_context) => {
		return showHistory.value;
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return toggleHistory?.(__weiv_argument);
	},
	(__weiv_context) => {
		return !loading.value && view.value === "definition";
	},
	(__weiv_context) => {
		return data.value;
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return newSession?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return startWork?.(__weiv_argument);
	},
	(__weiv_context) => {
		return !loading.value && view.value === "sessions";
	},
	(__weiv_context) => {
		return data.value;
	},
	(__weiv_context) => {
		return !loading.value && view.value === "session";
	},
	(__weiv_context) => {
		return data.value;
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return sendMessage?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return closeSession?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return respond?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return question?.(__weiv_argument);
	},
	(__weiv_context) => {
		return !loading.value && view.value === "works";
	},
	(__weiv_context) => {
		return data.value;
	},
	(__weiv_context) => {
		return !loading.value && view.value === "work";
	},
	(__weiv_context) => {
		return data.value;
	},
	(__weiv_context) => {
		return inspection.value;
	},
	(__weiv_context) => {
		return detail.value;
	},
	(__weiv_context) => {
		return inspectionNext.value;
	},
	(__weiv_context) => {
		return preview.value;
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return cancelWork?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return changeDetail?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return moreInspection?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return respond?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return question?.(__weiv_argument);
	},
	(__weiv_context) => {
		return !loading.value && view.value === "audit";
	},
	(__weiv_context) => {
		return data.value;
	},
	(__weiv_context) => {
		return category.value;
	},
	(__weiv_context) => {
		return auditNext.value;
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return changeCategory?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return moreAudit?.(__weiv_argument);
	},
	(__weiv_context) => {
		return !loading.value && view.value === "missing";
	},
	(__weiv_context) => {
		return missingPath.value;
	},
	(__weiv_context) => {
		return inputOpen.value;
	},
	(__weiv_context) => {
		return inputOpen.value;
	},
	(__weiv_context) => {
		return inputTitle.value;
	},
	(__weiv_context) => {
		return inputHelp.value;
	},
	(__weiv_context) => {
		return inputInitial.value;
	},
	(__weiv_context) => {
		return inputFields.value;
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return dismissInput?.(__weiv_argument);
	},
	(__weiv_context, __weiv_argument) => {
		const payload = __weiv_argument;
		return submitInput?.(__weiv_argument);
	}
];

  const __weiv_scope = {__proto__: null};
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.api = __weiv_import_api;
    __weiv_scope.createWatchHandle = __weiv_import_createWatchHandle;
    __weiv_scope.isTerminal = __weiv_import_isTerminal;
    __weiv_scope.pretty = __weiv_import_pretty;
    __weiv_scope.short = __weiv_import_short;
    __weiv_scope.watch = __weiv_import_watch;
    __weiv_scope.props = props;
    __weiv_scope.missingPath = missingPath.value;
    __weiv_scope.active = active.value;
    __weiv_scope.view = view.value;
    __weiv_scope.data = data.value;
    __weiv_scope.loading = loading.value;
    __weiv_scope.error = error.value;
    __weiv_scope.connected = connected.value;
    __weiv_scope.connectionNote = connectionNote.value;
    __weiv_scope.manageWatch = manageWatch.value;
    __weiv_scope.showHistory = showHistory.value;
    __weiv_scope.inspection = inspection.value;
    __weiv_scope.detail = detail.value;
    __weiv_scope.inspectionNext = inspectionNext.value;
    __weiv_scope.preview = preview.value;
    __weiv_scope.auditNext = auditNext.value;
    __weiv_scope.category = category.value;
    __weiv_scope.inputOpen = inputOpen.value;
    __weiv_scope.inputTitle = inputTitle.value;
    __weiv_scope.inputHelp = inputHelp.value;
    __weiv_scope.inputInitial = inputInitial.value;
    __weiv_scope.inputFields = inputFields.value;
    __weiv_scope.inputSchema = inputSchema;
    __weiv_scope.inputSubmit = inputSubmit.value;
    __weiv_scope.prepareSession = prepareSession;
    __weiv_scope.prepareWork = prepareWork;
    __weiv_scope.parts = parts;
    __weiv_scope.navigate = navigate;
    __weiv_scope.closeWatch = closeWatch;
    __weiv_scope.showError = showError;
    __weiv_scope.schemaValue = schemaValue;
    __weiv_scope.fieldsFor = fieldsFor;
    __weiv_scope.openInput = openInput;
    __weiv_scope.dismissInput = dismissInput;
    __weiv_scope.submitInput = submitInput;
    __weiv_scope.newSession = newSession;
    __weiv_scope.startWork = startWork;
    __weiv_scope.question = question;
    __weiv_scope.respond = respond;
    __weiv_scope.sendMessage = sendMessage;
    __weiv_scope.closeSession = closeSession;
    __weiv_scope.cancelWork = cancelWork;
    __weiv_scope.loadInspection = loadInspection;
    __weiv_scope.changeDetail = changeDetail;
    __weiv_scope.moreInspection = moreInspection;
    __weiv_scope.loadAudit = loadAudit;
    __weiv_scope.changeCategory = changeCategory;
    __weiv_scope.moreAudit = moreAudit;
    __weiv_scope.toggleHistory = toggleHistory;
    __weiv_scope.load = load;
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
    __weiv_cellScope.watch(missingPath, "missingPath");
    __weiv_cellScope.watch(active, "active");
    __weiv_cellScope.watch(view, "view");
    __weiv_cellScope.watch(data, "data");
    __weiv_cellScope.watch(loading, "loading");
    __weiv_cellScope.watch(error, "error");
    __weiv_cellScope.watch(connected, "connected");
    __weiv_cellScope.watch(connectionNote, "connectionNote");
    __weiv_cellScope.watch(showHistory, "showHistory");
    __weiv_cellScope.watch(inspection, "inspection");
    __weiv_cellScope.watch(detail, "detail");
    __weiv_cellScope.watch(inspectionNext, "inspectionNext");
    __weiv_cellScope.watch(preview, "preview");
    __weiv_cellScope.watch(auditNext, "auditNext");
    __weiv_cellScope.watch(category, "category");
    __weiv_cellScope.watch(inputOpen, "inputOpen");
    __weiv_cellScope.watch(inputTitle, "inputTitle");
    __weiv_cellScope.watch(inputHelp, "inputHelp");
    __weiv_cellScope.watch(inputInitial, "inputInitial");
    __weiv_cellScope.watch(inputFields, "inputFields");
    __weiv_cellScope.watch(inputSubmit, "submitInput");
    __weiv_cellScope.watch(category, "moreAudit");
    __weiv_cellScope.watch(data, "moreAudit");
    __weiv_cellScope.watch(showHistory, "moreAudit");
    __weiv_cellScope.watch(data, "changeCategory");
    __weiv_cellScope.watch(manageWatch, "changeCategory");
    __weiv_cellScope.watch(preview, "changeCategory");
    __weiv_cellScope.watch(showHistory, "changeCategory");
    __weiv_cellScope.watch(detail, "changeCategory");
    __weiv_cellScope.watch(inspection, "changeCategory");
    __weiv_cellScope.watch(view, "changeCategory");
    __weiv_cellScope.watch(showHistory, "toggleHistory");
    __weiv_cellScope.watch(__weiv_publisher_0.getCell("capability"), "api");
    __weiv_cellScope.watch(__weiv_publisher_1.getCell("fragment"), "api");
    __weiv_cellScope.watch(__weiv_publisher_2.getCell("capability"), "watch");
    __weiv_cellScope.watch(__weiv_publisher_3.getCell("fragment"), "watch");
    return () => __weiv_cellScope.dispose();
  }
  return { scope: __weiv_scope, refresh: __weiv_refresh, setProps: __weiv_setProps, setEventHandlers: __weiv_setEventHandlers, subscribeImportedObservables: __weiv_subscribeImportedObservables };
}

export const scopeId = "w52BC126DEC420AC0";
export const css = "";

export const trackedStateGraph = { roots: [], paths: [], regions: [] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_76 = (fragment.namespaceURI === "http://www.w3.org/2000/svg" && fragment.localName !== "foreignObject") || fragment.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "div") : document.createElement("div");
  refs[76] = __ref_76;
  __ref_76.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
  __ref_76.setAttribute("class", "shell");
  const __ref_0 = document.createComment("component:start");
  const __ref_1 = document.createComment("component:end");
  refs[0] = __ref_0;
  refs[1] = __ref_1;
  __ref_76.append(__ref_0);
  __ref_76.append(__ref_1);
  const __props_2 = {"active": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(instance.refresh()), "connected": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(instance.refresh()), "note": ((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(instance.refresh())};
  refs[2] = Sidebar.mountIntoBoundary(__ref_0, __ref_1, __props_2, undefined, undefined);
  const __ref_68 = (__ref_76.namespaceURI === "http://www.w3.org/2000/svg" && __ref_76.localName !== "foreignObject") || __ref_76.__weiv_namespace === "http://www.w3.org/2000/svg" ? document.createElementNS("http://www.w3.org/2000/svg", "main") : document.createElement("main");
  refs[68] = __ref_68;
  __ref_68.setAttribute("data-weiv-scope", "w52BC126DEC420AC0");
  const __ref_3 = document.createComment("if:start");
  const __ref_4 = document.createComment("if:end");
  refs[3] = __ref_3;
  refs[4] = __ref_4;
  refs[5] = undefined;
  __ref_68.append(__ref_3);
  __ref_68.append(__ref_4);
  const __ref_8 = document.createComment("if:start");
  const __ref_9 = document.createComment("if:end");
  refs[8] = __ref_8;
  refs[9] = __ref_9;
  refs[10] = undefined;
  __ref_68.append(__ref_8);
  __ref_68.append(__ref_9);
  const __ref_12 = document.createComment("if:start");
  const __ref_13 = document.createComment("if:end");
  refs[12] = __ref_12;
  refs[13] = __ref_13;
  refs[14] = undefined;
  __ref_68.append(__ref_12);
  __ref_68.append(__ref_13);
  const __ref_19 = document.createComment("if:start");
  const __ref_20 = document.createComment("if:end");
  refs[19] = __ref_19;
  refs[20] = __ref_20;
  refs[21] = undefined;
  __ref_68.append(__ref_19);
  __ref_68.append(__ref_20);
  const __ref_26 = document.createComment("if:start");
  const __ref_27 = document.createComment("if:end");
  refs[26] = __ref_26;
  refs[27] = __ref_27;
  refs[28] = undefined;
  __ref_68.append(__ref_26);
  __ref_68.append(__ref_27);
  const __ref_33 = document.createComment("if:start");
  const __ref_34 = document.createComment("if:end");
  refs[33] = __ref_33;
  refs[34] = __ref_34;
  refs[35] = undefined;
  __ref_68.append(__ref_33);
  __ref_68.append(__ref_34);
  const __ref_40 = document.createComment("if:start");
  const __ref_41 = document.createComment("if:end");
  refs[40] = __ref_40;
  refs[41] = __ref_41;
  refs[42] = undefined;
  __ref_68.append(__ref_40);
  __ref_68.append(__ref_41);
  const __ref_47 = document.createComment("if:start");
  const __ref_48 = document.createComment("if:end");
  refs[47] = __ref_47;
  refs[48] = __ref_48;
  refs[49] = undefined;
  __ref_68.append(__ref_47);
  __ref_68.append(__ref_48);
  const __ref_54 = document.createComment("if:start");
  const __ref_55 = document.createComment("if:end");
  refs[54] = __ref_54;
  refs[55] = __ref_55;
  refs[56] = undefined;
  __ref_68.append(__ref_54);
  __ref_68.append(__ref_55);
  const __ref_61 = document.createComment("if:start");
  const __ref_62 = document.createComment("if:end");
  refs[61] = __ref_61;
  refs[62] = __ref_62;
  refs[63] = undefined;
  __ref_68.append(__ref_61);
  __ref_68.append(__ref_62);
  __ref_76.append(__ref_68);
  const __ref_69 = document.createComment("if:start");
  const __ref_70 = document.createComment("if:end");
  refs[69] = __ref_69;
  refs[70] = __ref_70;
  refs[71] = undefined;
  __ref_76.append(__ref_69);
  __ref_76.append(__ref_70);
  fragment.append(__ref_76);
  return fragment;
}

function updateRegion_child_2(instance, scope, refs) {
  if (!refs[2]) return;
  refs[2].setProps({"active": ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope), "connected": ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(scope), "note": ((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context))(scope)});
  refs[2].update();
}
function updateRegion_conditional_3(instance, scope, refs) {
  updateConditional_3(instance, scope, refs);
}
function updateRegion_text_6(instance, scope, refs) {
  const __next_text_6 = String((((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context))(scope)) ?? "");
  if (refs[6].data !== __next_text_6) {
    refs[6].data = __next_text_6;
  }
}
function updateRegion_conditional_8(instance, scope, refs) {
  updateConditional_8(instance, scope, refs);
}
function updateRegion_conditional_12(instance, scope, refs) {
  updateConditional_12(instance, scope, refs);
}
function updateRegion_child_17(instance, scope, refs) {
  if (!refs[17]) return;
  refs[17].setProps({"items": ((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context))(scope), "history": ((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope)});
  refs[17].setEventHandlers({"toggle-history": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context, payload))(scope); return resolved; }});
  refs[17].update();
}
function updateRegion_conditional_19(instance, scope, refs) {
  updateConditional_19(instance, scope, refs);
}
function updateRegion_child_24(instance, scope, refs) {
  if (!refs[24]) return;
  refs[24].setProps({"item": ((__weiv_context) => __weiv_context.__weiv_eval[11](__weiv_context))(scope)});
  refs[24].setEventHandlers({"new-session": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[12](__weiv_context, payload))(scope); return resolved; }, "start-work": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[13](__weiv_context, payload))(scope); return resolved; }});
  refs[24].update();
}
function updateRegion_conditional_26(instance, scope, refs) {
  updateConditional_26(instance, scope, refs);
}
function updateRegion_child_31(instance, scope, refs) {
  if (!refs[31]) return;
  refs[31].setProps({"items": ((__weiv_context) => __weiv_context.__weiv_eval[15](__weiv_context))(scope)});
  refs[31].update();
}
function updateRegion_conditional_33(instance, scope, refs) {
  updateConditional_33(instance, scope, refs);
}
function updateRegion_child_38(instance, scope, refs) {
  if (!refs[38]) return;
  refs[38].setProps({"item": ((__weiv_context) => __weiv_context.__weiv_eval[17](__weiv_context))(scope)});
  refs[38].setEventHandlers({"send": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[18](__weiv_context, payload))(scope); return resolved; }, "close": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[19](__weiv_context, payload))(scope); return resolved; }, "respond": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[20](__weiv_context, payload))(scope); return resolved; }, "question": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[21](__weiv_context, payload))(scope); return resolved; }});
  refs[38].update();
}
function updateRegion_conditional_40(instance, scope, refs) {
  updateConditional_40(instance, scope, refs);
}
function updateRegion_child_45(instance, scope, refs) {
  if (!refs[45]) return;
  refs[45].setProps({"items": ((__weiv_context) => __weiv_context.__weiv_eval[23](__weiv_context))(scope)});
  refs[45].update();
}
function updateRegion_conditional_47(instance, scope, refs) {
  updateConditional_47(instance, scope, refs);
}
function updateRegion_child_52(instance, scope, refs) {
  if (!refs[52]) return;
  refs[52].setProps({"item": ((__weiv_context) => __weiv_context.__weiv_eval[25](__weiv_context))(scope), "entries": ((__weiv_context) => __weiv_context.__weiv_eval[26](__weiv_context))(scope), "detail": ((__weiv_context) => __weiv_context.__weiv_eval[27](__weiv_context))(scope), "next": ((__weiv_context) => __weiv_context.__weiv_eval[28](__weiv_context))(scope), "preview": ((__weiv_context) => __weiv_context.__weiv_eval[29](__weiv_context))(scope)});
  refs[52].setEventHandlers({"cancel": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[30](__weiv_context, payload))(scope); return resolved; }, "detail": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[31](__weiv_context, payload))(scope); return resolved; }, "more": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[32](__weiv_context, payload))(scope); return resolved; }, "respond": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[33](__weiv_context, payload))(scope); return resolved; }, "question": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[34](__weiv_context, payload))(scope); return resolved; }});
  refs[52].update();
}
function updateRegion_conditional_54(instance, scope, refs) {
  updateConditional_54(instance, scope, refs);
}
function updateRegion_child_59(instance, scope, refs) {
  if (!refs[59]) return;
  refs[59].setProps({"entries": ((__weiv_context) => __weiv_context.__weiv_eval[36](__weiv_context))(scope), "category": ((__weiv_context) => __weiv_context.__weiv_eval[37](__weiv_context))(scope), "next": ((__weiv_context) => __weiv_context.__weiv_eval[38](__weiv_context))(scope)});
  refs[59].setEventHandlers({"category": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[39](__weiv_context, payload))(scope); return resolved; }, "more": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[40](__weiv_context, payload))(scope); return resolved; }});
  refs[59].update();
}
function updateRegion_conditional_61(instance, scope, refs) {
  updateConditional_61(instance, scope, refs);
}
function updateRegion_text_65(instance, scope, refs) {
  const __next_text_65 = String((((__weiv_context) => __weiv_context.__weiv_eval[42](__weiv_context))(scope)) ?? "");
  if (refs[65].data !== __next_text_65) {
    refs[65].data = __next_text_65;
  }
}
function updateRegion_conditional_69(instance, scope, refs) {
  updateConditional_69(instance, scope, refs);
}
function updateRegion_child_74(instance, scope, refs) {
  if (!refs[74]) return;
  refs[74].setProps({"open": ((__weiv_context) => __weiv_context.__weiv_eval[44](__weiv_context))(scope), "title": ((__weiv_context) => __weiv_context.__weiv_eval[45](__weiv_context))(scope), "help": ((__weiv_context) => __weiv_context.__weiv_eval[46](__weiv_context))(scope), "initial": ((__weiv_context) => __weiv_context.__weiv_eval[47](__weiv_context))(scope), "fields": ((__weiv_context) => __weiv_context.__weiv_eval[48](__weiv_context))(scope)});
  refs[74].setEventHandlers({"cancel": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[49](__weiv_context, payload))(scope); return resolved; }, "submit": (payload) => { const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[50](__weiv_context, payload))(scope); return resolved; }});
  refs[74].update();
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_child_2(instance, scope, refs);
  updateRegion_conditional_3(instance, scope, refs);
  updateRegion_conditional_8(instance, scope, refs);
  updateRegion_conditional_12(instance, scope, refs);
  updateRegion_conditional_19(instance, scope, refs);
  updateRegion_conditional_26(instance, scope, refs);
  updateRegion_conditional_33(instance, scope, refs);
  updateRegion_conditional_40(instance, scope, refs);
  updateRegion_conditional_47(instance, scope, refs);
  updateRegion_conditional_54(instance, scope, refs);
  updateRegion_conditional_61(instance, scope, refs);
  updateRegion_conditional_69(instance, scope, refs);
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
  if (dirtySet.has("active") || dirtySet.has("connected") || dirtySet.has("connectionNote") || dirtyRegionSet.has(1)) {
    updateRegion_child_2(instance, scope, refs);
  }
  if (dirtySet.has("error") || dirtyRegionSet.has(2)) {
    updateRegion_conditional_3(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtyRegionSet.has(3)) {
    updateRegion_conditional_8(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("showHistory") || dirtySet.has("toggleHistory") || dirtyRegionSet.has(4)) {
    updateRegion_conditional_12(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("newSession") || dirtySet.has("startWork") || dirtyRegionSet.has(5)) {
    updateRegion_conditional_19(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtyRegionSet.has(6)) {
    updateRegion_conditional_26(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("sendMessage") || dirtySet.has("closeSession") || dirtySet.has("respond") || dirtySet.has("question") || dirtyRegionSet.has(7)) {
    updateRegion_conditional_33(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtyRegionSet.has(8)) {
    updateRegion_conditional_40(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("inspection") || dirtySet.has("detail") || dirtySet.has("inspectionNext") || dirtySet.has("preview") || dirtySet.has("cancelWork") || dirtySet.has("changeDetail") || dirtySet.has("moreInspection") || dirtySet.has("respond") || dirtySet.has("question") || dirtyRegionSet.has(9)) {
    updateRegion_conditional_47(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("data") || dirtySet.has("category") || dirtySet.has("auditNext") || dirtySet.has("changeCategory") || dirtySet.has("moreAudit") || dirtyRegionSet.has(10)) {
    updateRegion_conditional_54(instance, scope, refs);
  }
  if (dirtySet.has("loading") || dirtySet.has("view") || dirtySet.has("missingPath") || dirtyRegionSet.has(11)) {
    updateRegion_conditional_61(instance, scope, refs);
  }
  if (dirtySet.has("inputOpen") || dirtySet.has("inputTitle") || dirtySet.has("inputHelp") || dirtySet.has("inputInitial") || dirtySet.has("inputFields") || dirtySet.has("dismissInput") || dirtySet.has("submitInput") || dirtyRegionSet.has(12)) {
    updateRegion_conditional_69(instance, scope, refs);
  }
}

function destroyDom(instance) {
  const refs = instance.refs;
  if (refs[2] && typeof refs[2].destroy === "function") {
    refs[2].destroy();
  }
  refs[2] = undefined;
  if (refs[5] === true) {
  } else {
  }
  if (refs[10] === true) {
  } else {
  }
  if (refs[14] === true) {
    if (refs[17] && typeof refs[17].destroy === "function") {
      refs[17].destroy();
    }
    refs[17] = undefined;
  } else {
  }
  if (refs[21] === true) {
    if (refs[24] && typeof refs[24].destroy === "function") {
      refs[24].destroy();
    }
    refs[24] = undefined;
  } else {
  }
  if (refs[28] === true) {
    if (refs[31] && typeof refs[31].destroy === "function") {
      refs[31].destroy();
    }
    refs[31] = undefined;
  } else {
  }
  if (refs[35] === true) {
    if (refs[38] && typeof refs[38].destroy === "function") {
      refs[38].destroy();
    }
    refs[38] = undefined;
  } else {
  }
  if (refs[42] === true) {
    if (refs[45] && typeof refs[45].destroy === "function") {
      refs[45].destroy();
    }
    refs[45] = undefined;
  } else {
  }
  if (refs[49] === true) {
    if (refs[52] && typeof refs[52].destroy === "function") {
      refs[52].destroy();
    }
    refs[52] = undefined;
  } else {
  }
  if (refs[56] === true) {
    if (refs[59] && typeof refs[59].destroy === "function") {
      refs[59].destroy();
    }
    refs[59] = undefined;
  } else {
  }
  if (refs[63] === true) {
  } else {
  }
  if (refs[71] === true) {
    if (refs[74] && typeof refs[74].destroy === "function") {
      refs[74].destroy();
    }
    refs[74] = undefined;
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
