import {
  isObservable as __weiv_isObservable,
  createCell as __weiv_createCell,
  createCellScope as __weiv_createCellScope,
  unbindCellValue as __weiv_unbindCellValue,
  normalizeCellValue as __weiv_normalizeCellValue,
  cellAssignmentTarget as __weiv_cellAssignmentTarget,
  bindingObject as __weiv_bindingObject,
  bindingIterator as __weiv_bindingIterator,
  initializeClassName as __weiv_initializeClassName,
} from 'weiv:cells';
function replaceBetween(start, end, content) {
  const parent = start.parentNode;
  if (!parent || parent !== end.parentNode) {
    throw new Error('Conditional boundary is detached');
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
    throw new Error('Boundary move target is detached');
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
  if (!dirtyState || typeof dirtyState !== 'object') {
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
  let __weiv_handlers = __weiv_event_handlers;
  const emit = (name, payload) => {
    if (typeof __weiv_handlers[name] === 'function') {
      return __weiv_handlers[name](payload);
    }
    return undefined;
  };
  let data = __weiv_createCell(null);
  let completed = __weiv_createCell(null);
  let busy = __weiv_createCell(false);
  let errorMessage = __weiv_createCell('');
  async function reviewCase() {
    if (busy.value) return;
    __weiv_cellAssignmentTarget(() => busy).value = __weiv_normalizeCellValue(true);
    __weiv_cellAssignmentTarget(() => errorMessage).value = __weiv_normalizeCellValue('');
    try {
      const result = await api('/api/case');
      if (result.resolution)
        __weiv_cellAssignmentTarget(() => completed).value = __weiv_normalizeCellValue(result);
      else __weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue(result);
      window.scrollTo(0, 0);
    } catch (error) {
      __weiv_cellAssignmentTarget(() => errorMessage).value = __weiv_normalizeCellValue(
        message(error),
      );
    } finally {
      __weiv_cellAssignmentTarget(() => busy).value = __weiv_normalizeCellValue(false);
    }
  }
  async function approveRefund() {
    if (busy.value) return;
    __weiv_cellAssignmentTarget(() => busy).value = __weiv_normalizeCellValue(true);
    __weiv_cellAssignmentTarget(() => errorMessage).value = __weiv_normalizeCellValue('');
    try {
      __weiv_cellAssignmentTarget(() => completed).value = __weiv_normalizeCellValue(
        await api('/api/approve'),
      );
      window.scrollTo(0, 0);
    } catch (error) {
      __weiv_cellAssignmentTarget(() => errorMessage).value = __weiv_normalizeCellValue(
        message(error),
      );
    } finally {
      __weiv_cellAssignmentTarget(() => busy).value = __weiv_normalizeCellValue(false);
    }
  }
  async function restartCase() {
    if (busy.value) return;
    __weiv_cellAssignmentTarget(() => busy).value = __weiv_normalizeCellValue(true);
    __weiv_cellAssignmentTarget(() => errorMessage).value = __weiv_normalizeCellValue('');
    try {
      await api('/api/reset');
      __weiv_cellAssignmentTarget(() => data).value = __weiv_normalizeCellValue(null);
      __weiv_cellAssignmentTarget(() => completed).value = __weiv_normalizeCellValue(null);
      window.scrollTo(0, 0);
    } catch (error) {
      __weiv_cellAssignmentTarget(() => errorMessage).value = __weiv_normalizeCellValue(
        message(error),
      );
    } finally {
      __weiv_cellAssignmentTarget(() => busy).value = __weiv_normalizeCellValue(false);
    }
  }
  async function api(path) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'x-support-token': props.token },
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'The support case could not continue');
    return value;
  }
  function message(error) {
    return error instanceof Error ? error.message : 'The support case could not continue';
  }
  function money(cents) {
    const amount = new Intl.NumberFormat('en-NZ', { minimumFractionDigits: 2 }).format(cents / 100);
    return `NZ$${amount}`;
  }
  function evidenceCount() {
    return data.value?.investigation?.length ?? completed.value?.evidence?.length ?? 0;
  }
  function previewText() {
    const previews = data.value?.previews ?? [];
    return previews[previews.length - 1] || 'Preparing the approval-gated billing action…';
  }
  function approvalTitle() {
    if (data.value?.approval?.tool === 'support.billing.refund') return 'Refund duplicate charge';
    return data.value?.approval?.title || 'Approve proposed action';
  }
  function citationSource() {
    return data.value?.triage?.citations?.[0]?.source || 'policy://support/duplicate-charges';
  }
  function categoryCount() {
    return completed.value?.audit?.categories?.length ?? 0;
  }
  function phaseLabel(phase) {
    if (phase === 'settled' || phase === 'resolved') return 'Complete';
    if (phase === 'authorized' || phase === 'committed') return 'Approval';
    if (phase === 'admitted') return 'Running';
    if (phase === 'rejected') return 'Blocked';
    if (phase === 'uncertain') return 'Reconcile';
    return phase.charAt(0).toUpperCase() + phase.slice(1);
  }
  function evidenceLabel(tool) {
    if (tool === 'support.account.status') return 'Account charge state';
    if (tool === 'support.knowledge.search') return 'Duplicate-charge policy';
    if (tool === 'support.billing.refund') return 'Refund write';
    return 'Runtime Tool';
  }
  function handoffLabel() {
    const handoff = completed.value?.handoff;
    if (!handoff) return 'Session ownership changed';
    return `${handoff.from.id} → ${handoff.to.id}`;
  }
  const __weiv_templateExpressions = [
    (__weiv_context) => {
      return completed.value ? 'Resolved' : 'Billing review';
    },
    (__weiv_context) => {
      return busy.value;
    },
    (__weiv_context, __weiv_argument) => {
      const event = __weiv_argument;
      return reviewCase?.(__weiv_argument);
    },
    (__weiv_context) => {
      return busy.value ? 'Checking…' : 'Run review';
    },
    (__weiv_context) => {
      return citationSource();
    },
    (__weiv_context) => {
      return handoffLabel();
    },
    (__weiv_context) => {
      return completed.value.resolution.message;
    },
    (__weiv_context) => {
      return money(completed.value.resolution.receipt.amountCents);
    },
    (__weiv_context) => {
      return completed.value.resolution.receipt.orderId;
    },
    (__weiv_context) => {
      return completed.value.resolution.receipt.refundId;
    },
    (__weiv_context) => {
      return errorMessage.value;
    },
    (__weiv_context) => {
      return completed.value ? 'This conversation is resolved.' : 'Reply to Alex Morgan…';
    },
    (__weiv_context) => {
      return data.value.customer.request;
    },
    (__weiv_context) => {
      return data.value.customer.orderId;
    },
    (__weiv_context) => {
      return money(data.value.customer.amountCents);
    },
    (__weiv_context) => {
      return approvalTitle();
    },
    (__weiv_context) => {
      return money(data.value.approval.details.amountCents);
    },
    (__weiv_context) => {
      return data.value.approval.details.orderId;
    },
    (__weiv_context) => {
      return busy.value;
    },
    (__weiv_context, __weiv_argument) => {
      const event = __weiv_argument;
      return approveRefund?.(__weiv_argument);
    },
    (__weiv_context) => {
      return busy.value ? 'Running refund…' : 'Approve exact refund';
    },
    (__weiv_context) => {
      return data.value.approval.tool;
    },
    (__weiv_context) => {
      return evidenceCount();
    },
    (__weiv_context) => {
      return evidenceLabel(item.tool);
    },
    (__weiv_context) => {
      return item.tool;
    },
    (__weiv_context) => {
      return phaseLabel(item.phase);
    },
    (__weiv_context) => {
      return previewText();
    },
    (__weiv_context) => {
      return money(completed.value.resolution.receipt.amountCents);
    },
    (__weiv_context) => {
      return completed.value.resolution.receipt.orderId;
    },
    (__weiv_context) => {
      return completed.value.resolution.receipt.refundId;
    },
    (__weiv_context, __weiv_argument) => {
      const event = __weiv_argument;
      return restartCase?.(__weiv_argument);
    },
    (__weiv_context) => {
      return evidenceCount();
    },
    (__weiv_context) => {
      return evidenceLabel(item.tool);
    },
    (__weiv_context) => {
      return item.tool;
    },
    (__weiv_context) => {
      return phaseLabel(item.phase);
    },
    (__weiv_context) => {
      return categoryCount();
    },
    (__weiv_context) => {
      return completed.value.audit.entries;
    },
    (__weiv_context) => {
      return category;
    },
  ];

  const __weiv_scope = { __proto__: null };
  __weiv_scope.__weiv_eval = __weiv_templateExpressions;
  function __weiv_refresh() {
    __weiv_scope.props = props;
    __weiv_scope.emit = emit;
    __weiv_scope.props = props;
    __weiv_scope.data = data.value;
    __weiv_scope.completed = completed.value;
    __weiv_scope.busy = busy.value;
    __weiv_scope.errorMessage = errorMessage.value;
    __weiv_scope.reviewCase = reviewCase;
    __weiv_scope.approveRefund = approveRefund;
    __weiv_scope.restartCase = restartCase;
    __weiv_scope.api = api;
    __weiv_scope.message = message;
    __weiv_scope.money = money;
    __weiv_scope.evidenceCount = evidenceCount;
    __weiv_scope.previewText = previewText;
    __weiv_scope.approvalTitle = approvalTitle;
    __weiv_scope.citationSource = citationSource;
    __weiv_scope.categoryCount = categoryCount;
    __weiv_scope.phaseLabel = phaseLabel;
    __weiv_scope.evidenceLabel = evidenceLabel;
    __weiv_scope.handoffLabel = handoffLabel;
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
    const __weiv_cellScope = __weiv_createCellScope((dirty) => {
      if (!__weiv_instance.destroyed)
        __weiv_instance.updateDirty({ bindings: [...dirty], paths: [] }, __weiv_instance.refresh());
    });
    __weiv_cellScope.watch(__weiv_propsCell, 'props');
    __weiv_cellScope.watch(data, 'data');
    __weiv_cellScope.watch(completed, 'completed');
    __weiv_cellScope.watch(busy, 'busy');
    __weiv_cellScope.watch(errorMessage, 'errorMessage');
    __weiv_cellScope.watch(completed, 'categoryCount');
    __weiv_cellScope.watch(data, 'previewText');
    __weiv_cellScope.watch(completed, 'evidenceCount');
    __weiv_cellScope.watch(data, 'evidenceCount');
    __weiv_cellScope.watch(data, 'approvalTitle');
    __weiv_cellScope.watch(completed, 'handoffLabel');
    __weiv_cellScope.watch(data, 'citationSource');
    return () => __weiv_cellScope.dispose();
  }
  return {
    scope: __weiv_scope,
    refresh: __weiv_refresh,
    setProps: __weiv_setProps,
    setEventHandlers: __weiv_setEventHandlers,
    subscribeImportedObservables: __weiv_subscribeImportedObservables,
  };
}

export const scopeId = 'wAFE7F4C66F8956DA';
export const css =
  '\n  [data-weiv-scope="wAFE7F4C66F8956DA"].support-app, [data-weiv-scope="wAFE7F4C66F8956DA"] .support-app {\n    --ink: #23312d;\n    --muted: #66736e;\n    --faint: #8a9590;\n    --line: #d8dedb;\n    --line-strong: #c8d0cc;\n    --canvas: #f2f4f3;\n    --paper: #ffffff;\n    --sidebar: #26322f;\n    --accent: #2e6251;\n    --accent-soft: #e8f1ed;\n    --warning: #9a5c1e;\n    --warning-soft: #fff7e9;\n    min-height: 100vh;\n    background: var(--canvas);\n    color: var(--ink);\n    font-size: 13px;\n    line-height: 1.45;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].support-app *, [data-weiv-scope="wAFE7F4C66F8956DA"] .support-app * {\n    box-sizing: border-box;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].support-app button, [data-weiv-scope="wAFE7F4C66F8956DA"] .support-app button, [data-weiv-scope="wAFE7F4C66F8956DA"].support-app input, [data-weiv-scope="wAFE7F4C66F8956DA"] .support-app input {\n    font: inherit;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].support-app button, [data-weiv-scope="wAFE7F4C66F8956DA"] .support-app button {\n    color: inherit;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].thread-state, [data-weiv-scope="wAFE7F4C66F8956DA"] .thread-state, [data-weiv-scope="wAFE7F4C66F8956DA"].context-state, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-state {\n    display: contents;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].global-header, [data-weiv-scope="wAFE7F4C66F8956DA"] .global-header {\n    display: flex;\n    height: 54px;\n    align-items: center;\n    justify-content: space-between;\n    padding: 0 16px;\n    border-bottom: 1px solid var(--line);\n    background: var(--paper);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].brand, [data-weiv-scope="wAFE7F4C66F8956DA"] .brand, [data-weiv-scope="wAFE7F4C66F8956DA"].global-actions, [data-weiv-scope="wAFE7F4C66F8956DA"] .global-actions, [data-weiv-scope="wAFE7F4C66F8956DA"].brand-mark, [data-weiv-scope="wAFE7F4C66F8956DA"] .brand-mark, [data-weiv-scope="wAFE7F4C66F8956DA"].environment, [data-weiv-scope="wAFE7F4C66F8956DA"] .environment, [data-weiv-scope="wAFE7F4C66F8956DA"].nav-item, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-item, [data-weiv-scope="wAFE7F4C66F8956DA"].operator, [data-weiv-scope="wAFE7F4C66F8956DA"] .operator, [data-weiv-scope="wAFE7F4C66F8956DA"].inbox-header, [data-weiv-scope="wAFE7F4C66F8956DA"] .inbox-header, [data-weiv-scope="wAFE7F4C66F8956DA"].row-top, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-top, [data-weiv-scope="wAFE7F4C66F8956DA"].row-meta, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-meta, [data-weiv-scope="wAFE7F4C66F8956DA"].microline, [data-weiv-scope="wAFE7F4C66F8956DA"] .microline, [data-weiv-scope="wAFE7F4C66F8956DA"].case-actions, [data-weiv-scope="wAFE7F4C66F8956DA"] .case-actions, [data-weiv-scope="wAFE7F4C66F8956DA"].thread-day, [data-weiv-scope="wAFE7F4C66F8956DA"] .thread-day, [data-weiv-scope="wAFE7F4C66F8956DA"].message-head, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-head, [data-weiv-scope="wAFE7F4C66F8956DA"].activity-head, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-head, [data-weiv-scope="wAFE7F4C66F8956DA"].activity-head > div, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-head > div, [data-weiv-scope="wAFE7F4C66F8956DA"].system-event, [data-weiv-scope="wAFE7F4C66F8956DA"] .system-event, [data-weiv-scope="wAFE7F4C66F8956DA"].composer-meta, [data-weiv-scope="wAFE7F4C66F8956DA"] .composer-meta, [data-weiv-scope="wAFE7F4C66F8956DA"].context-tabs, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-tabs, [data-weiv-scope="wAFE7F4C66F8956DA"].section-title, [data-weiv-scope="wAFE7F4C66F8956DA"] .section-title, [data-weiv-scope="wAFE7F4C66F8956DA"].customer-summary, [data-weiv-scope="wAFE7F4C66F8956DA"] .customer-summary, [data-weiv-scope="wAFE7F4C66F8956DA"].approval-title, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-title, [data-weiv-scope="wAFE7F4C66F8956DA"].approval-value, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-value, [data-weiv-scope="wAFE7F4C66F8956DA"].approval-proof, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-proof, [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-list > div, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-list > div, [data-weiv-scope="wAFE7F4C66F8956DA"].policy-row, [data-weiv-scope="wAFE7F4C66F8956DA"] .policy-row {\n    display: flex;\n    align-items: center;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].brand, [data-weiv-scope="wAFE7F4C66F8956DA"] .brand {\n    gap: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].brand b, [data-weiv-scope="wAFE7F4C66F8956DA"] .brand b {\n    font-size: 14px;\n    letter-spacing: -0.015em;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].brand-mark, [data-weiv-scope="wAFE7F4C66F8956DA"] .brand-mark {\n    width: 28px;\n    height: 28px;\n    justify-content: center;\n    border-radius: 6px;\n    background: var(--sidebar);\n    color: #fff;\n    font-size: 13px;\n    font-weight: 750;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].product-name, [data-weiv-scope="wAFE7F4C66F8956DA"] .product-name {\n    margin-left: 3px;\n    padding-left: 12px;\n    border-left: 1px solid var(--line);\n    color: var(--muted);\n    font-size: 12px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].global-actions, [data-weiv-scope="wAFE7F4C66F8956DA"] .global-actions {\n    gap: 12px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].environment, [data-weiv-scope="wAFE7F4C66F8956DA"] .environment {\n    gap: 7px;\n    color: var(--muted);\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].environment i, [data-weiv-scope="wAFE7F4C66F8956DA"] .environment i {\n    width: 7px;\n    height: 7px;\n    border-radius: 50%;\n    background: #5d9a6e;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].icon-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .icon-button, [data-weiv-scope="wAFE7F4C66F8956DA"].filter-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .filter-button, [data-weiv-scope="wAFE7F4C66F8956DA"].text-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .text-button {\n    border: 0;\n    background: transparent;\n    cursor: pointer;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].icon-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .icon-button {\n    min-width: 30px;\n    min-height: 30px;\n    padding: 0 8px;\n    border: 1px solid var(--line);\n    border-radius: 5px;\n    color: var(--muted);\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].header-avatar, [data-weiv-scope="wAFE7F4C66F8956DA"] .header-avatar, [data-weiv-scope="wAFE7F4C66F8956DA"].operator-avatar, [data-weiv-scope="wAFE7F4C66F8956DA"] .operator-avatar {\n    display: grid;\n    place-items: center;\n    border-radius: 50%;\n    font-weight: 700;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].header-avatar, [data-weiv-scope="wAFE7F4C66F8956DA"] .header-avatar {\n    width: 29px;\n    height: 29px;\n    background: #e7dfd2;\n    color: #634e35;\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].workspace, [data-weiv-scope="wAFE7F4C66F8956DA"] .workspace {\n    display: grid;\n    grid-template-columns: 206px 292px minmax(430px, 1fr) 338px;\n    height: calc(100vh - 54px);\n    min-height: 620px;\n    overflow: hidden;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].navigation, [data-weiv-scope="wAFE7F4C66F8956DA"] .navigation {\n    display: flex;\n    flex-direction: column;\n    min-width: 0;\n    padding: 17px 11px 12px;\n    overflow-y: auto;\n    background: var(--sidebar);\n    color: #dce4e0;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].nav-section, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-section {\n    display: grid;\n    gap: 2px;\n    margin-bottom: 24px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].nav-heading, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-heading {\n    margin: 0 9px 7px;\n    color: #8fa099;\n    font-size: 10px;\n    font-weight: 650;\n    letter-spacing: 0.04em;\n    text-transform: uppercase;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].nav-item, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-item {\n    width: 100%;\n    min-height: 34px;\n    justify-content: space-between;\n    padding: 0 9px;\n    border: 0;\n    border-radius: 5px;\n    background: transparent;\n    color: #c8d2ce;\n    cursor: pointer;\n    font-size: 12px;\n    text-align: left;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].nav-item > span:first-child, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-item > span:first-child {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].nav-item.active, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-item.active, [data-weiv-scope="wAFE7F4C66F8956DA"].nav-item:hover, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-item:hover {\n    background: #34423e;\n    color: #fff;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].count, [data-weiv-scope="wAFE7F4C66F8956DA"] .count {\n    min-width: 18px;\n    padding: 1px 5px;\n    border-radius: 4px;\n    background: #3a4944;\n    color: #d4ddd9;\n    font-size: 10px;\n    text-align: center;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].count.quiet, [data-weiv-scope="wAFE7F4C66F8956DA"] .count.quiet {\n    background: transparent;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].queue-dot, [data-weiv-scope="wAFE7F4C66F8956DA"] .queue-dot {\n    width: 7px;\n    height: 7px;\n    border-radius: 2px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].queue-dot.triage, [data-weiv-scope="wAFE7F4C66F8956DA"] .queue-dot.triage {\n    background: #8ba7bd;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].queue-dot.billing, [data-weiv-scope="wAFE7F4C66F8956DA"] .queue-dot.billing {\n    background: #d5a55b;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].queue-dot.success, [data-weiv-scope="wAFE7F4C66F8956DA"] .queue-dot.success {\n    background: #6fa483;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].nav-bottom, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-bottom {\n    margin-top: auto;\n    margin-bottom: 13px;\n    padding: 13px 9px 4px;\n    border-top: 1px solid #3b4944;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].nav-bottom .nav-heading, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-bottom .nav-heading {\n    margin-inline: 0;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].nav-bottom p, [data-weiv-scope="wAFE7F4C66F8956DA"] .nav-bottom p {\n    margin: 0;\n    color: #9fada8;\n    font-size: 10px;\n    line-height: 1.55;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].text-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .text-button {\n    width: fit-content;\n    margin-top: 9px;\n    padding: 0;\n    color: #c6d6cf;\n    font-size: 10px;\n    text-decoration: underline;\n    text-underline-offset: 2px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].operator, [data-weiv-scope="wAFE7F4C66F8956DA"] .operator {\n    gap: 9px;\n    padding: 11px 8px 2px;\n    border-top: 1px solid #3b4944;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].operator-avatar, [data-weiv-scope="wAFE7F4C66F8956DA"] .operator-avatar {\n    width: 30px;\n    height: 30px;\n    flex: 0 0 auto;\n    background: #d8c8b1;\n    color: #564434;\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].operator div, [data-weiv-scope="wAFE7F4C66F8956DA"] .operator div {\n    display: flex;\n    min-width: 0;\n    flex-direction: column;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].operator b, [data-weiv-scope="wAFE7F4C66F8956DA"] .operator b {\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].operator small, [data-weiv-scope="wAFE7F4C66F8956DA"] .operator small {\n    color: #94a39d;\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inbox, [data-weiv-scope="wAFE7F4C66F8956DA"] .inbox {\n    min-width: 0;\n    overflow: hidden;\n    border-right: 1px solid var(--line);\n    background: #fafbfa;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inbox-header, [data-weiv-scope="wAFE7F4C66F8956DA"] .inbox-header {\n    height: 67px;\n    justify-content: space-between;\n    padding: 0 15px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inbox-header > div, [data-weiv-scope="wAFE7F4C66F8956DA"] .inbox-header > div {\n    display: flex;\n    align-items: baseline;\n    gap: 8px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inbox-header h1, [data-weiv-scope="wAFE7F4C66F8956DA"] .inbox-header h1 {\n    margin: 0;\n    font-size: 17px;\n    font-weight: 680;\n    letter-spacing: -0.025em;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inbox-header span, [data-weiv-scope="wAFE7F4C66F8956DA"] .inbox-header span {\n    color: var(--faint);\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].filter-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .filter-button {\n    padding: 5px 8px;\n    border: 1px solid var(--line);\n    border-radius: 5px;\n    background: #fff;\n    color: var(--muted);\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].search, [data-weiv-scope="wAFE7F4C66F8956DA"] .search {\n    display: block;\n    margin: 0 13px 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].search span, [data-weiv-scope="wAFE7F4C66F8956DA"] .search span {\n    position: absolute;\n    width: 1px;\n    height: 1px;\n    overflow: hidden;\n    clip: rect(0, 0, 0, 0);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].search input, [data-weiv-scope="wAFE7F4C66F8956DA"] .search input {\n    width: 100%;\n    height: 31px;\n    padding: 0 10px;\n    border: 1px solid var(--line);\n    border-radius: 5px;\n    outline: none;\n    background: #fff;\n    color: var(--ink);\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].search input:focus, [data-weiv-scope="wAFE7F4C66F8956DA"] .search input:focus {\n    border-color: #8aa79b;\n    box-shadow: 0 0 0 2px rgba(46, 98, 81, 0.1);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].list-tabs, [data-weiv-scope="wAFE7F4C66F8956DA"] .list-tabs {\n    display: flex;\n    gap: 17px;\n    padding: 0 15px;\n    border-bottom: 1px solid var(--line);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].list-tabs button, [data-weiv-scope="wAFE7F4C66F8956DA"] .list-tabs button {\n    padding: 0 0 9px;\n    border: 0;\n    border-bottom: 2px solid transparent;\n    background: transparent;\n    color: var(--faint);\n    cursor: pointer;\n    font-size: 10px;\n    font-weight: 600;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].list-tabs button.active, [data-weiv-scope="wAFE7F4C66F8956DA"] .list-tabs button.active {\n    border-bottom-color: var(--accent);\n    color: var(--ink);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].conversation-list, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation-list {\n    overflow-y: auto;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].conversation-row, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation-row {\n    position: relative;\n    display: grid;\n    grid-template-columns: 7px 1fr;\n    width: 100%;\n    gap: 8px;\n    padding: 13px 14px;\n    border: 0;\n    border-bottom: 1px solid #e5e9e7;\n    background: transparent;\n    cursor: pointer;\n    text-align: left;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].conversation-row:hover, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation-row:hover, [data-weiv-scope="wAFE7F4C66F8956DA"].conversation-row.selected, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation-row.selected {\n    background: #eef3f1;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].conversation-row.selected::before, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation-row.selected::before {\n    position: absolute;\n    inset: 0 auto 0 0;\n    width: 3px;\n    background: var(--accent);\n    content: "";\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].unread-dot, [data-weiv-scope="wAFE7F4C66F8956DA"] .unread-dot {\n    width: 6px;\n    height: 6px;\n    margin-top: 6px;\n    border-radius: 50%;\n    background: #39765e;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].unread-dot.muted, [data-weiv-scope="wAFE7F4C66F8956DA"] .unread-dot.muted {\n    background: transparent;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].row-main, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-main {\n    display: flex;\n    min-width: 0;\n    flex-direction: column;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].row-top, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-top {\n    justify-content: space-between;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].row-top b, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-top b {\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].row-top time, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-top time {\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].row-subject, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-subject {\n    margin-top: 3px;\n    font-size: 11px;\n    font-weight: 600;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].row-preview, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-preview {\n    margin-top: 3px;\n    overflow: hidden;\n    color: var(--muted);\n    font-size: 10px;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].row-meta, [data-weiv-scope="wAFE7F4C66F8956DA"] .row-meta {\n    gap: 7px;\n    margin-top: 8px;\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].tag, [data-weiv-scope="wAFE7F4C66F8956DA"] .tag, [data-weiv-scope="wAFE7F4C66F8956DA"].status-label, [data-weiv-scope="wAFE7F4C66F8956DA"] .status-label, [data-weiv-scope="wAFE7F4C66F8956DA"].case-status, [data-weiv-scope="wAFE7F4C66F8956DA"] .case-status {\n    display: inline-flex;\n    align-items: center;\n    border-radius: 3px;\n    font-size: 9px;\n    font-weight: 650;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].tag, [data-weiv-scope="wAFE7F4C66F8956DA"] .tag {\n    padding: 2px 5px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].tag.billing, [data-weiv-scope="wAFE7F4C66F8956DA"] .tag.billing {\n    background: #f4ead8;\n    color: #7c561e;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].tag.account, [data-weiv-scope="wAFE7F4C66F8956DA"] .tag.account {\n    background: #e8edf1;\n    color: #506877;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].conversation, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation {\n    display: grid;\n    min-width: 0;\n    grid-template-rows: auto minmax(0, 1fr) auto;\n    background: #fff;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].conversation-header, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation-header {\n    display: flex;\n    min-height: 67px;\n    align-items: center;\n    justify-content: space-between;\n    gap: 18px;\n    padding: 0 20px;\n    border-bottom: 1px solid var(--line);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].case-title, [data-weiv-scope="wAFE7F4C66F8956DA"] .case-title {\n    min-width: 0;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].microline, [data-weiv-scope="wAFE7F4C66F8956DA"] .microline {\n    gap: 12px;\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].microline span + span, [data-weiv-scope="wAFE7F4C66F8956DA"] .microline span + span {\n    position: relative;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].microline span + span::before, [data-weiv-scope="wAFE7F4C66F8956DA"] .microline span + span::before {\n    position: absolute;\n    left: -7px;\n    content: "·";\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].case-title h2, [data-weiv-scope="wAFE7F4C66F8956DA"] .case-title h2 {\n    margin: 5px 0 0;\n    overflow: hidden;\n    font-size: 15px;\n    font-weight: 660;\n    letter-spacing: -0.015em;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].case-actions, [data-weiv-scope="wAFE7F4C66F8956DA"] .case-actions {\n    gap: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].case-status, [data-weiv-scope="wAFE7F4C66F8956DA"] .case-status {\n    padding: 4px 7px;\n    border: 1px solid #e2d1b9;\n    background: #fffaf2;\n    color: #825b2a;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].case-status.resolved, [data-weiv-scope="wAFE7F4C66F8956DA"] .case-status.resolved {\n    border-color: #c4d9ca;\n    background: #f0f7f2;\n    color: #35654c;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].thread, [data-weiv-scope="wAFE7F4C66F8956DA"] .thread {\n    min-height: 0;\n    padding: 15px 22px 30px;\n    overflow-y: auto;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].thread-day, [data-weiv-scope="wAFE7F4C66F8956DA"] .thread-day {\n    gap: 9px;\n    margin-bottom: 15px;\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].thread-day::before, [data-weiv-scope="wAFE7F4C66F8956DA"] .thread-day::before, [data-weiv-scope="wAFE7F4C66F8956DA"].thread-day::after, [data-weiv-scope="wAFE7F4C66F8956DA"] .thread-day::after {\n    height: 1px;\n    flex: 1;\n    background: #e7eae8;\n    content: "";\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message, [data-weiv-scope="wAFE7F4C66F8956DA"] .message {\n    display: grid;\n    grid-template-columns: 30px minmax(0, 1fr);\n    gap: 10px;\n    margin: 15px 0 22px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].avatar, [data-weiv-scope="wAFE7F4C66F8956DA"] .avatar {\n    display: grid;\n    width: 30px;\n    height: 30px;\n    place-items: center;\n    border-radius: 50%;\n    font-size: 9px;\n    font-weight: 700;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].avatar.customer, [data-weiv-scope="wAFE7F4C66F8956DA"] .avatar.customer {\n    background: #ece4d8;\n    color: #6c5439;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].avatar.agent, [data-weiv-scope="wAFE7F4C66F8956DA"] .avatar.agent {\n    background: #e1ece7;\n    color: #2f5e4c;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].avatar.large, [data-weiv-scope="wAFE7F4C66F8956DA"] .avatar.large {\n    width: 38px;\n    height: 38px;\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message-body, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-body {\n    min-width: 0;\n    padding-top: 2px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message-head, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-head {\n    gap: 7px;\n    margin-bottom: 6px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message-head b, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-head b {\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message-head span, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-head span, [data-weiv-scope="wAFE7F4C66F8956DA"].message-head time, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-head time {\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message-head time, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-head time {\n    margin-left: auto;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message-body p, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-body p {\n    margin: 0;\n    color: #35433f;\n    font-size: 12px;\n    line-height: 1.58;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message-facts, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-facts {\n    display: flex;\n    gap: 18px;\n    margin-top: 12px;\n    padding: 9px 10px;\n    border: 1px solid #e1e6e3;\n    border-radius: 5px;\n    background: #fafbfa;\n    color: var(--muted);\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].message-facts b, [data-weiv-scope="wAFE7F4C66F8956DA"] .message-facts b {\n    margin-right: 4px;\n    color: var(--faint);\n    font-size: 9px;\n    font-weight: 600;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].review-start, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-start {\n    display: grid;\n    grid-template-columns: 32px minmax(0, 1fr) auto;\n    gap: 12px;\n    align-items: center;\n    margin: 27px 0;\n    padding: 14px;\n    border: 1px solid #d9e2de;\n    border-radius: 6px;\n    background: #f7faf8;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].review-start-icon, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-start-icon, [data-weiv-scope="wAFE7F4C66F8956DA"].agent-avatar, [data-weiv-scope="wAFE7F4C66F8956DA"] .agent-avatar {\n    display: grid;\n    place-items: center;\n    border-radius: 5px;\n    background: var(--accent);\n    color: #fff;\n    font-weight: 700;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].review-start-icon, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-start-icon {\n    width: 32px;\n    height: 32px;\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].review-start-copy h3, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-start-copy h3, [data-weiv-scope="wAFE7F4C66F8956DA"].activity-head b, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-head b {\n    font-size: 11px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].review-start-copy p, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-start-copy p {\n    max-width: 420px;\n    margin: 3px 0 8px;\n    color: var(--muted);\n    font-size: 10px;\n    line-height: 1.5;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].review-checks, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-checks {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 6px 14px;\n    color: #5a7167;\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].review-checks span::before, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-checks span::before {\n    margin-right: 4px;\n    color: #5a9474;\n    content: "✓";\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].primary-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .primary-button, [data-weiv-scope="wAFE7F4C66F8956DA"].approve-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .approve-button, [data-weiv-scope="wAFE7F4C66F8956DA"].secondary-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .secondary-button {\n    border-radius: 5px;\n    cursor: pointer;\n    font-weight: 650;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].primary-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .primary-button {\n    min-height: 32px;\n    padding: 0 12px;\n    border: 1px solid #214f40;\n    background: var(--accent);\n    color: #fff;\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].primary-button:hover, [data-weiv-scope="wAFE7F4C66F8956DA"] .primary-button:hover {\n    background: #244f40;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].primary-button:disabled, [data-weiv-scope="wAFE7F4C66F8956DA"] .primary-button:disabled, [data-weiv-scope="wAFE7F4C66F8956DA"].approve-button:disabled, [data-weiv-scope="wAFE7F4C66F8956DA"] .approve-button:disabled, [data-weiv-scope="wAFE7F4C66F8956DA"].secondary-button:disabled, [data-weiv-scope="wAFE7F4C66F8956DA"] .secondary-button:disabled {\n    cursor: wait;\n    opacity: 0.65;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-block, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-block {\n    margin: 25px 0 16px 40px;\n    overflow: hidden;\n    border: 1px solid #dce3df;\n    border-radius: 6px;\n    background: #fbfcfb;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-head, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-head {\n    justify-content: space-between;\n    padding: 10px 12px;\n    border-bottom: 1px solid #e5e9e7;\n    background: #f6f8f7;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-head > div, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-head > div {\n    gap: 8px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].agent-avatar, [data-weiv-scope="wAFE7F4C66F8956DA"] .agent-avatar {\n    width: 21px;\n    height: 21px;\n    font-size: 8px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-time, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-time {\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-summary, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-summary {\n    margin: 0;\n    padding: 12px 13px;\n    color: #45534e;\n    font-size: 11px;\n    line-height: 1.5;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-grid, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-grid {\n    display: grid;\n    grid-template-columns: 1fr 1fr;\n    border-top: 1px solid #e5e9e7;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-grid > div, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-grid > div {\n    display: flex;\n    min-width: 0;\n    flex-direction: column;\n    gap: 4px;\n    padding: 10px 12px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-grid > div + div, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-grid > div + div {\n    border-left: 1px solid #e5e9e7;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-grid span, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-grid span {\n    color: var(--faint);\n    font-size: 8px;\n    text-transform: uppercase;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-grid b, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-grid b {\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].activity-grid code, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-grid code, [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-list code, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-list code, [data-weiv-scope="wAFE7F4C66F8956DA"].policy-row code, [data-weiv-scope="wAFE7F4C66F8956DA"] .policy-row code, [data-weiv-scope="wAFE7F4C66F8956DA"].approval-box code, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-box code {\n    color: #5b6c65;\n    font-family: "SFMono-Regular", Menlo, Consolas, monospace;\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].system-event, [data-weiv-scope="wAFE7F4C66F8956DA"] .system-event {\n    gap: 8px;\n    margin: 13px 0 15px;\n    padding: 9px 11px;\n    border-top: 1px solid #e7eae8;\n    border-bottom: 1px solid #e7eae8;\n    color: var(--muted);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].system-event b, [data-weiv-scope="wAFE7F4C66F8956DA"] .system-event b {\n    color: #42514c;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].system-event time, [data-weiv-scope="wAFE7F4C66F8956DA"] .system-event time {\n    margin-left: auto;\n    color: var(--faint);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].event-icon, [data-weiv-scope="wAFE7F4C66F8956DA"] .event-icon {\n    color: #648174;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inline-receipt, [data-weiv-scope="wAFE7F4C66F8956DA"] .inline-receipt {\n    display: grid;\n    grid-template-columns: repeat(3, 1fr);\n    margin-top: 12px;\n    overflow: hidden;\n    border: 1px solid #d6e2dc;\n    border-radius: 5px;\n    background: #f7faf8;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inline-receipt div, [data-weiv-scope="wAFE7F4C66F8956DA"] .inline-receipt div {\n    display: flex;\n    flex-direction: column;\n    gap: 3px;\n    padding: 9px 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inline-receipt div + div, [data-weiv-scope="wAFE7F4C66F8956DA"] .inline-receipt div + div {\n    border-left: 1px solid #dce5e1;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inline-receipt span, [data-weiv-scope="wAFE7F4C66F8956DA"] .inline-receipt span {\n    color: var(--faint);\n    font-size: 8px;\n    text-transform: uppercase;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].inline-receipt b, [data-weiv-scope="wAFE7F4C66F8956DA"] .inline-receipt b {\n    color: #355a4b;\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].error, [data-weiv-scope="wAFE7F4C66F8956DA"] .error {\n    display: block;\n    margin: 14px 0;\n    padding: 8px 10px;\n    border: 1px solid #e6c6bd;\n    border-radius: 4px;\n    background: #fff7f4;\n    color: #9c4839;\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].composer, [data-weiv-scope="wAFE7F4C66F8956DA"] .composer {\n    padding: 10px 18px 9px;\n    border-top: 1px solid var(--line);\n    background: #fafbfa;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].composer-box, [data-weiv-scope="wAFE7F4C66F8956DA"] .composer-box {\n    display: flex;\n    min-height: 34px;\n    align-items: center;\n    justify-content: space-between;\n    padding: 0 10px;\n    border: 1px solid var(--line-strong);\n    border-radius: 5px;\n    background: #fff;\n    color: var(--faint);\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].composer-box button, [data-weiv-scope="wAFE7F4C66F8956DA"] .composer-box button {\n    width: 23px;\n    height: 23px;\n    border: 0;\n    border-radius: 4px;\n    background: #e9eeeb;\n    color: #7c8984;\n    font-size: 13px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].composer-meta, [data-weiv-scope="wAFE7F4C66F8956DA"] .composer-meta {\n    gap: 13px;\n    padding-top: 7px;\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].composer-hint, [data-weiv-scope="wAFE7F4C66F8956DA"] .composer-hint {\n    margin-left: auto;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].context, [data-weiv-scope="wAFE7F4C66F8956DA"] .context {\n    min-width: 0;\n    overflow-y: auto;\n    border-left: 1px solid var(--line);\n    background: #f8f9f8;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].context-header, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-header {\n    display: flex;\n    height: 67px;\n    align-items: center;\n    justify-content: space-between;\n    padding: 0 14px;\n    border-bottom: 1px solid var(--line);\n    background: #fff;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].context-tabs, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-tabs {\n    align-self: stretch;\n    gap: 15px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].context-tabs button, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-tabs button {\n    height: 100%;\n    padding: 0;\n    border: 0;\n    border-bottom: 2px solid transparent;\n    background: transparent;\n    color: var(--faint);\n    cursor: pointer;\n    font-size: 10px;\n    font-weight: 600;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].context-tabs button.active, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-tabs button.active {\n    border-bottom-color: var(--accent);\n    color: var(--ink);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].context-section, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-section, [data-weiv-scope="wAFE7F4C66F8956DA"].approval-box, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-box {\n    margin: 12px;\n    padding: 13px;\n    border: 1px solid var(--line);\n    border-radius: 5px;\n    background: #fff;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].customer-summary, [data-weiv-scope="wAFE7F4C66F8956DA"] .customer-summary {\n    gap: 10px;\n    padding-bottom: 12px;\n    border-bottom: 1px solid #e7eae8;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].customer-summary h3, [data-weiv-scope="wAFE7F4C66F8956DA"] .customer-summary h3, [data-weiv-scope="wAFE7F4C66F8956DA"].context-section h3, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-section h3, [data-weiv-scope="wAFE7F4C66F8956DA"].approval-box h3, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-box h3 {\n    margin: 0;\n    font-size: 11px;\n    font-weight: 660;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].customer-summary div, [data-weiv-scope="wAFE7F4C66F8956DA"] .customer-summary div {\n    display: flex;\n    flex-direction: column;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].customer-summary span, [data-weiv-scope="wAFE7F4C66F8956DA"] .customer-summary span {\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  dl[data-weiv-scope="wAFE7F4C66F8956DA"], [data-weiv-scope="wAFE7F4C66F8956DA"] dl {\n    margin: 0;\n  }\n\n  dl[data-weiv-scope="wAFE7F4C66F8956DA"] div, [data-weiv-scope="wAFE7F4C66F8956DA"] dl div {\n    display: flex;\n    justify-content: space-between;\n    gap: 12px;\n    padding: 8px 0;\n    border-bottom: 1px solid #edf0ee;\n    font-size: 10px;\n  }\n\n  dl[data-weiv-scope="wAFE7F4C66F8956DA"] div:last-child, [data-weiv-scope="wAFE7F4C66F8956DA"] dl div:last-child {\n    border-bottom: 0;\n    padding-bottom: 0;\n  }\n\n  dt[data-weiv-scope="wAFE7F4C66F8956DA"], [data-weiv-scope="wAFE7F4C66F8956DA"] dt {\n    color: var(--faint);\n  }\n\n  dd[data-weiv-scope="wAFE7F4C66F8956DA"], [data-weiv-scope="wAFE7F4C66F8956DA"] dd {\n    margin: 0;\n    color: #35433e;\n    text-align: right;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].customer-card dl, [data-weiv-scope="wAFE7F4C66F8956DA"] .customer-card dl {\n    margin-top: 7px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].section-title, [data-weiv-scope="wAFE7F4C66F8956DA"] .section-title {\n    justify-content: space-between;\n    gap: 12px;\n    margin-bottom: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].section-title > span, [data-weiv-scope="wAFE7F4C66F8956DA"] .section-title > span {\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].context-copy, [data-weiv-scope="wAFE7F4C66F8956DA"] .context-copy, [data-weiv-scope="wAFE7F4C66F8956DA"].audit-summary p, [data-weiv-scope="wAFE7F4C66F8956DA"] .audit-summary p {\n    margin: 0;\n    color: var(--muted);\n    font-size: 10px;\n    line-height: 1.55;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].policy-row, [data-weiv-scope="wAFE7F4C66F8956DA"] .policy-row {\n    align-items: flex-start;\n    flex-direction: column;\n    gap: 3px;\n    padding: 9px;\n    border-radius: 4px;\n    background: #f6f8f7;\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].policy-row small, [data-weiv-scope="wAFE7F4C66F8956DA"] .policy-row small {\n    color: var(--faint);\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].request-summary p, [data-weiv-scope="wAFE7F4C66F8956DA"] .request-summary p {\n    margin: 0 0 4px;\n    color: #42504b;\n    font-size: 10px;\n    line-height: 1.5;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].status-label, [data-weiv-scope="wAFE7F4C66F8956DA"] .status-label {\n    padding: 2px 5px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].status-label.pending, [data-weiv-scope="wAFE7F4C66F8956DA"] .status-label.pending {\n    background: var(--warning-soft);\n    color: var(--warning);\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].status-label.complete, [data-weiv-scope="wAFE7F4C66F8956DA"] .status-label.complete {\n    background: #eaf4ee;\n    color: #37664f;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approval-box, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-box {\n    border-color: #dec69f;\n    border-top: 3px solid #b3772b;\n    background: #fffdf9;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approval-title, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-title {\n    justify-content: space-between;\n    color: var(--warning);\n    font-size: 9px;\n    font-weight: 680;\n    letter-spacing: 0.03em;\n    text-transform: uppercase;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].warning-icon, [data-weiv-scope="wAFE7F4C66F8956DA"] .warning-icon {\n    display: grid;\n    width: 17px;\n    height: 17px;\n    place-items: center;\n    border: 1px solid #d6b17c;\n    border-radius: 50%;\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approval-box h3, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-box h3 {\n    margin-top: 11px;\n    font-size: 15px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approval-value, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-value {\n    justify-content: space-between;\n    margin: 14px 0 10px;\n    padding: 11px 0;\n    border-top: 1px solid #eee3d2;\n    border-bottom: 1px solid #eee3d2;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approval-value span, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-value span {\n    font-size: 23px;\n    font-weight: 650;\n    letter-spacing: -0.035em;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approval-box > p, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-box > p {\n    margin: 0 0 12px;\n    color: var(--muted);\n    font-size: 9px;\n    line-height: 1.5;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approve-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .approve-button {\n    width: 100%;\n    min-height: 33px;\n    border: 1px solid #8d5a1e;\n    background: #9a5c1e;\n    color: #fff;\n    font-size: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approve-button:hover, [data-weiv-scope="wAFE7F4C66F8956DA"] .approve-button:hover {\n    background: #844b13;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approval-box > small, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-box > small {\n    display: block;\n    margin-top: 8px;\n    color: var(--faint);\n    font-size: 8px;\n    line-height: 1.45;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-list, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-list {\n    border: 1px solid #e5e9e7;\n    border-radius: 4px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-list > div, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-list > div {\n    gap: 8px;\n    padding: 8px 9px;\n    border-bottom: 1px solid #e9edeb;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-list > div:last-child, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-list > div:last-child {\n    border-bottom: 0;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-state, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-state {\n    display: grid;\n    width: 18px;\n    height: 18px;\n    flex: 0 0 auto;\n    place-items: center;\n    border-radius: 50%;\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-state.complete, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-state.complete {\n    background: #e6f1ea;\n    color: #3f7459;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-list > div > div, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-list > div > div {\n    display: flex;\n    min-width: 0;\n    flex: 1;\n    flex-direction: column;\n    gap: 2px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-list b, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-list b {\n    overflow: hidden;\n    font-size: 9px;\n    font-weight: 600;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].evidence-list > div > span:last-child, [data-weiv-scope="wAFE7F4C66F8956DA"] .evidence-list > div > span:last-child {\n    color: #4f735f;\n    font-size: 8px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].preview-note, [data-weiv-scope="wAFE7F4C66F8956DA"] .preview-note {\n    margin-top: 10px;\n    padding: 9px;\n    border-radius: 4px;\n    background: #f4f6f5;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].preview-note span, [data-weiv-scope="wAFE7F4C66F8956DA"] .preview-note span {\n    color: var(--faint);\n    font-size: 8px;\n    text-transform: uppercase;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].preview-note p, [data-weiv-scope="wAFE7F4C66F8956DA"] .preview-note p {\n    margin: 4px 0 0;\n    color: #5d6b66;\n    font-size: 9px;\n    line-height: 1.45;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].resolution-amount, [data-weiv-scope="wAFE7F4C66F8956DA"] .resolution-amount {\n    margin: 14px 0 6px;\n    color: #315f4d;\n    font-size: 28px;\n    font-weight: 680;\n    letter-spacing: -0.045em;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].approval-proof, [data-weiv-scope="wAFE7F4C66F8956DA"] .approval-proof {\n    gap: 6px;\n    margin: 10px 0;\n    padding: 8px;\n    border-radius: 4px;\n    background: #eef6f1;\n    color: #466957;\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].secondary-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .secondary-button {\n    width: 100%;\n    min-height: 31px;\n    border: 1px solid var(--line-strong);\n    background: #fff;\n    color: #53615c;\n    font-size: 9px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].audit-tags, [data-weiv-scope="wAFE7F4C66F8956DA"] .audit-tags {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 4px;\n    margin-top: 10px;\n  }\n\n  [data-weiv-scope="wAFE7F4C66F8956DA"].audit-tags span, [data-weiv-scope="wAFE7F4C66F8956DA"] .audit-tags span {\n    padding: 2px 5px;\n    border: 1px solid #e1e5e3;\n    border-radius: 3px;\n    background: #fafbfa;\n    color: var(--muted);\n    font-size: 8px;\n  }\n\n  @media (max-width: 1240px) {\n    [data-weiv-scope="wAFE7F4C66F8956DA"].workspace, [data-weiv-scope="wAFE7F4C66F8956DA"] .workspace {\n      grid-template-columns: 184px 268px minmax(390px, 1fr) 310px;\n    }\n  }\n\n  @media (max-width: 1080px) {\n    [data-weiv-scope="wAFE7F4C66F8956DA"].workspace, [data-weiv-scope="wAFE7F4C66F8956DA"] .workspace {\n      grid-template-columns: 260px minmax(390px, 1fr) 310px;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].navigation, [data-weiv-scope="wAFE7F4C66F8956DA"] .navigation {\n      display: none;\n    }\n  }\n\n  @media (max-width: 840px) {\n    [data-weiv-scope="wAFE7F4C66F8956DA"].workspace, [data-weiv-scope="wAFE7F4C66F8956DA"] .workspace {\n      grid-template-columns: 238px minmax(0, 1fr);\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].context, [data-weiv-scope="wAFE7F4C66F8956DA"] .context {\n      display: none;\n    }\n  }\n\n  @media (max-width: 640px) {\n    [data-weiv-scope="wAFE7F4C66F8956DA"].workspace, [data-weiv-scope="wAFE7F4C66F8956DA"] .workspace {\n      display: block;\n      height: auto;\n      overflow: visible;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].inbox, [data-weiv-scope="wAFE7F4C66F8956DA"] .inbox {\n      display: none;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].conversation, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation {\n      min-height: calc(100vh - 54px);\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].conversation-header, [data-weiv-scope="wAFE7F4C66F8956DA"] .conversation-header {\n      padding: 12px 15px;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].thread, [data-weiv-scope="wAFE7F4C66F8956DA"] .thread {\n      padding-inline: 15px;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].review-start, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-start {\n      grid-template-columns: 28px 1fr;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].review-start .primary-button, [data-weiv-scope="wAFE7F4C66F8956DA"] .review-start .primary-button {\n      grid-column: 2;\n      justify-self: start;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].activity-block, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-block {\n      margin-left: 0;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].activity-grid, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-grid, [data-weiv-scope="wAFE7F4C66F8956DA"].inline-receipt, [data-weiv-scope="wAFE7F4C66F8956DA"] .inline-receipt {\n      grid-template-columns: 1fr;\n    }\n\n    [data-weiv-scope="wAFE7F4C66F8956DA"].activity-grid > div + div, [data-weiv-scope="wAFE7F4C66F8956DA"] .activity-grid > div + div, [data-weiv-scope="wAFE7F4C66F8956DA"].inline-receipt div + div, [data-weiv-scope="wAFE7F4C66F8956DA"] .inline-receipt div + div {\n      border-top: 1px solid #e5e9e7;\n      border-left: 0;\n    }\n  }\n';

export const trackedStateGraph = { roots: [], paths: [], regions: [] };

function createDom(instance) {
  const fragment = document.createDocumentFragment();
  const refs = instance.refs;
  const __ref_382 =
    (fragment.namespaceURI === 'http://www.w3.org/2000/svg' &&
      fragment.localName !== 'foreignObject') ||
    fragment.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[382] = __ref_382;
  __ref_382.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_382.setAttribute('class', 'support-app');
  const __ref_9 =
    (__ref_382.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_382.localName !== 'foreignObject') ||
    __ref_382.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'header')
      : document.createElement('header');
  refs[9] = __ref_9;
  __ref_9.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_9.setAttribute('class', 'global-header');
  const __ref_3 =
    (__ref_9.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_9.localName !== 'foreignObject') ||
    __ref_9.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[3] = __ref_3;
  __ref_3.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_3.setAttribute('class', 'brand');
  const __ref_0 =
    (__ref_3.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_3.localName !== 'foreignObject') ||
    __ref_3.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[0] = __ref_0;
  __ref_0.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_0.setAttribute('class', 'brand-mark');
  __ref_0.append(document.createTextNode('H'));
  __ref_3.append(__ref_0);
  const __ref_1 =
    (__ref_3.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_3.localName !== 'foreignObject') ||
    __ref_3.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[1] = __ref_1;
  __ref_1.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_1.append(document.createTextNode('Harngine'));
  __ref_3.append(__ref_1);
  const __ref_2 =
    (__ref_3.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_3.localName !== 'foreignObject') ||
    __ref_3.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[2] = __ref_2;
  __ref_2.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_2.setAttribute('class', 'product-name');
  __ref_2.append(document.createTextNode('Relay Support'));
  __ref_3.append(__ref_2);
  __ref_9.append(__ref_3);
  const __ref_8 =
    (__ref_9.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_9.localName !== 'foreignObject') ||
    __ref_9.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[8] = __ref_8;
  __ref_8.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_8.setAttribute('class', 'global-actions');
  const __ref_5 =
    (__ref_8.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_8.localName !== 'foreignObject') ||
    __ref_8.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[5] = __ref_5;
  __ref_5.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_5.setAttribute('class', 'environment');
  const __ref_4 =
    (__ref_5.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_5.localName !== 'foreignObject') ||
    __ref_5.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'i')
      : document.createElement('i');
  refs[4] = __ref_4;
  __ref_4.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_5.append(__ref_4);
  __ref_5.append(document.createTextNode('Local demo'));
  __ref_8.append(__ref_5);
  const __ref_6 =
    (__ref_8.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_8.localName !== 'foreignObject') ||
    __ref_8.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[6] = __ref_6;
  __ref_6.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_6.setAttribute('class', 'icon-button');
  __ref_6.setAttribute('aria-label', 'Search');
  __ref_6.append(document.createTextNode('Search'));
  __ref_8.append(__ref_6);
  const __ref_7 =
    (__ref_8.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_8.localName !== 'foreignObject') ||
    __ref_8.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[7] = __ref_7;
  __ref_7.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_7.setAttribute('class', 'header-avatar');
  __ref_7.append(document.createTextNode('JC'));
  __ref_8.append(__ref_7);
  __ref_9.append(__ref_8);
  __ref_382.append(__ref_9);
  const __ref_381 =
    (__ref_382.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_382.localName !== 'foreignObject') ||
    __ref_382.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[381] = __ref_381;
  __ref_381.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_381.setAttribute('class', 'workspace');
  const __ref_45 =
    (__ref_381.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_381.localName !== 'foreignObject') ||
    __ref_381.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'aside')
      : document.createElement('aside');
  refs[45] = __ref_45;
  __ref_45.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_45.setAttribute('class', 'navigation');
  __ref_45.setAttribute('aria-label', 'Support navigation');
  const __ref_22 =
    (__ref_45.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_45.localName !== 'foreignObject') ||
    __ref_45.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[22] = __ref_22;
  __ref_22.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_22.setAttribute('class', 'nav-section');
  const __ref_10 =
    (__ref_22.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_22.localName !== 'foreignObject') ||
    __ref_22.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[10] = __ref_10;
  __ref_10.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_10.setAttribute('class', 'nav-heading');
  __ref_10.append(document.createTextNode('Workspace'));
  __ref_22.append(__ref_10);
  const __ref_13 =
    (__ref_22.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_22.localName !== 'foreignObject') ||
    __ref_22.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[13] = __ref_13;
  __ref_13.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_13.setAttribute('class', 'nav-item active');
  const __ref_11 =
    (__ref_13.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_13.localName !== 'foreignObject') ||
    __ref_13.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[11] = __ref_11;
  __ref_11.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_11.append(document.createTextNode('Inbox'));
  __ref_13.append(__ref_11);
  const __ref_12 =
    (__ref_13.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_13.localName !== 'foreignObject') ||
    __ref_13.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[12] = __ref_12;
  __ref_12.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_12.setAttribute('class', 'count');
  __ref_12.append(document.createTextNode('18'));
  __ref_13.append(__ref_12);
  __ref_22.append(__ref_13);
  const __ref_16 =
    (__ref_22.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_22.localName !== 'foreignObject') ||
    __ref_22.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[16] = __ref_16;
  __ref_16.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_16.setAttribute('class', 'nav-item');
  const __ref_14 =
    (__ref_16.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_16.localName !== 'foreignObject') ||
    __ref_16.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[14] = __ref_14;
  __ref_14.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_14.append(document.createTextNode('Assigned to me'));
  __ref_16.append(__ref_14);
  const __ref_15 =
    (__ref_16.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_16.localName !== 'foreignObject') ||
    __ref_16.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[15] = __ref_15;
  __ref_15.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_15.setAttribute('class', 'count');
  __ref_15.append(document.createTextNode('6'));
  __ref_16.append(__ref_15);
  __ref_22.append(__ref_16);
  const __ref_19 =
    (__ref_22.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_22.localName !== 'foreignObject') ||
    __ref_22.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[19] = __ref_19;
  __ref_19.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_19.setAttribute('class', 'nav-item');
  const __ref_17 =
    (__ref_19.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_19.localName !== 'foreignObject') ||
    __ref_19.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[17] = __ref_17;
  __ref_17.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_17.append(document.createTextNode('Mentions'));
  __ref_19.append(__ref_17);
  const __ref_18 =
    (__ref_19.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_19.localName !== 'foreignObject') ||
    __ref_19.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[18] = __ref_18;
  __ref_18.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_18.setAttribute('class', 'count quiet');
  __ref_18.append(document.createTextNode('2'));
  __ref_19.append(__ref_18);
  __ref_22.append(__ref_19);
  const __ref_21 =
    (__ref_22.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_22.localName !== 'foreignObject') ||
    __ref_22.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[21] = __ref_21;
  __ref_21.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_21.setAttribute('class', 'nav-item');
  const __ref_20 =
    (__ref_21.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_21.localName !== 'foreignObject') ||
    __ref_21.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[20] = __ref_20;
  __ref_20.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_20.append(document.createTextNode('Saved views'));
  __ref_21.append(__ref_20);
  __ref_22.append(__ref_21);
  __ref_45.append(__ref_22);
  const __ref_35 =
    (__ref_45.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_45.localName !== 'foreignObject') ||
    __ref_45.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[35] = __ref_35;
  __ref_35.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_35.setAttribute('class', 'nav-section');
  const __ref_23 =
    (__ref_35.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_35.localName !== 'foreignObject') ||
    __ref_35.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[23] = __ref_23;
  __ref_23.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_23.setAttribute('class', 'nav-heading');
  __ref_23.append(document.createTextNode('Queues'));
  __ref_35.append(__ref_23);
  const __ref_27 =
    (__ref_35.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_35.localName !== 'foreignObject') ||
    __ref_35.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[27] = __ref_27;
  __ref_27.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_27.setAttribute('class', 'nav-item');
  const __ref_25 =
    (__ref_27.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_27.localName !== 'foreignObject') ||
    __ref_27.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[25] = __ref_25;
  __ref_25.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_24 =
    (__ref_25.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_25.localName !== 'foreignObject') ||
    __ref_25.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'i')
      : document.createElement('i');
  refs[24] = __ref_24;
  __ref_24.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_24.setAttribute('class', 'queue-dot triage');
  __ref_25.append(__ref_24);
  __ref_25.append(document.createTextNode('Triage'));
  __ref_27.append(__ref_25);
  const __ref_26 =
    (__ref_27.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_27.localName !== 'foreignObject') ||
    __ref_27.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[26] = __ref_26;
  __ref_26.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_26.setAttribute('class', 'count');
  __ref_26.append(document.createTextNode('12'));
  __ref_27.append(__ref_26);
  __ref_35.append(__ref_27);
  const __ref_31 =
    (__ref_35.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_35.localName !== 'foreignObject') ||
    __ref_35.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[31] = __ref_31;
  __ref_31.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_31.setAttribute('class', 'nav-item');
  const __ref_29 =
    (__ref_31.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_31.localName !== 'foreignObject') ||
    __ref_31.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[29] = __ref_29;
  __ref_29.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_28 =
    (__ref_29.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_29.localName !== 'foreignObject') ||
    __ref_29.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'i')
      : document.createElement('i');
  refs[28] = __ref_28;
  __ref_28.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_28.setAttribute('class', 'queue-dot billing');
  __ref_29.append(__ref_28);
  __ref_29.append(document.createTextNode('Billing'));
  __ref_31.append(__ref_29);
  const __ref_30 =
    (__ref_31.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_31.localName !== 'foreignObject') ||
    __ref_31.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[30] = __ref_30;
  __ref_30.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_30.setAttribute('class', 'count');
  __ref_30.append(document.createTextNode('3'));
  __ref_31.append(__ref_30);
  __ref_35.append(__ref_31);
  const __ref_34 =
    (__ref_35.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_35.localName !== 'foreignObject') ||
    __ref_35.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[34] = __ref_34;
  __ref_34.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_34.setAttribute('class', 'nav-item');
  const __ref_33 =
    (__ref_34.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_34.localName !== 'foreignObject') ||
    __ref_34.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[33] = __ref_33;
  __ref_33.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_32 =
    (__ref_33.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_33.localName !== 'foreignObject') ||
    __ref_33.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'i')
      : document.createElement('i');
  refs[32] = __ref_32;
  __ref_32.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_32.setAttribute('class', 'queue-dot success');
  __ref_33.append(__ref_32);
  __ref_33.append(document.createTextNode('Success'));
  __ref_34.append(__ref_33);
  __ref_35.append(__ref_34);
  __ref_45.append(__ref_35);
  const __ref_39 =
    (__ref_45.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_45.localName !== 'foreignObject') ||
    __ref_45.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[39] = __ref_39;
  __ref_39.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_39.setAttribute('class', 'nav-section nav-bottom');
  const __ref_36 =
    (__ref_39.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_39.localName !== 'foreignObject') ||
    __ref_39.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[36] = __ref_36;
  __ref_36.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_36.setAttribute('class', 'nav-heading');
  __ref_36.append(document.createTextNode('Demo notes'));
  __ref_39.append(__ref_36);
  const __ref_37 =
    (__ref_39.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_39.localName !== 'foreignObject') ||
    __ref_39.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[37] = __ref_37;
  __ref_37.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_37.append(
    document.createTextNode(
      'All account data and actions are local. No network or provider key is used.',
    ),
  );
  __ref_39.append(__ref_37);
  const __ref_38 =
    (__ref_39.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_39.localName !== 'foreignObject') ||
    __ref_39.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[38] = __ref_38;
  __ref_38.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_38.setAttribute('class', 'text-button');
  __ref_38.append(document.createTextNode('View runtime details'));
  __ref_39.append(__ref_38);
  __ref_45.append(__ref_39);
  const __ref_44 =
    (__ref_45.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_45.localName !== 'foreignObject') ||
    __ref_45.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[44] = __ref_44;
  __ref_44.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_44.setAttribute('class', 'operator');
  const __ref_40 =
    (__ref_44.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_44.localName !== 'foreignObject') ||
    __ref_44.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[40] = __ref_40;
  __ref_40.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_40.setAttribute('class', 'operator-avatar');
  __ref_40.append(document.createTextNode('JD'));
  __ref_44.append(__ref_40);
  const __ref_43 =
    (__ref_44.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_44.localName !== 'foreignObject') ||
    __ref_44.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[43] = __ref_43;
  __ref_43.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_41 =
    (__ref_43.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_43.localName !== 'foreignObject') ||
    __ref_43.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[41] = __ref_41;
  __ref_41.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_41.append(document.createTextNode('Jamie Dale'));
  __ref_43.append(__ref_41);
  const __ref_42 =
    (__ref_43.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_43.localName !== 'foreignObject') ||
    __ref_43.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'small')
      : document.createElement('small');
  refs[42] = __ref_42;
  __ref_42.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_42.append(document.createTextNode('Support operator'));
  __ref_43.append(__ref_42);
  __ref_44.append(__ref_43);
  __ref_45.append(__ref_44);
  __ref_381.append(__ref_45);
  const __ref_114 =
    (__ref_381.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_381.localName !== 'foreignObject') ||
    __ref_381.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[114] = __ref_114;
  __ref_114.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_114.setAttribute('class', 'inbox');
  __ref_114.setAttribute('aria-label', 'Conversation list');
  const __ref_50 =
    (__ref_114.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_114.localName !== 'foreignObject') ||
    __ref_114.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[50] = __ref_50;
  __ref_50.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_50.setAttribute('class', 'inbox-header');
  const __ref_48 =
    (__ref_50.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_50.localName !== 'foreignObject') ||
    __ref_50.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[48] = __ref_48;
  __ref_48.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_46 =
    (__ref_48.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_48.localName !== 'foreignObject') ||
    __ref_48.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h1')
      : document.createElement('h1');
  refs[46] = __ref_46;
  __ref_46.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_46.append(document.createTextNode('Inbox'));
  __ref_48.append(__ref_46);
  const __ref_47 =
    (__ref_48.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_48.localName !== 'foreignObject') ||
    __ref_48.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[47] = __ref_47;
  __ref_47.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_47.append(document.createTextNode('18 open'));
  __ref_48.append(__ref_47);
  __ref_50.append(__ref_48);
  const __ref_49 =
    (__ref_50.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_50.localName !== 'foreignObject') ||
    __ref_50.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[49] = __ref_49;
  __ref_49.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_49.setAttribute('class', 'filter-button');
  __ref_49.append(document.createTextNode('Filter'));
  __ref_50.append(__ref_49);
  __ref_114.append(__ref_50);
  const __ref_53 =
    (__ref_114.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_114.localName !== 'foreignObject') ||
    __ref_114.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'label')
      : document.createElement('label');
  refs[53] = __ref_53;
  __ref_53.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_53.setAttribute('class', 'search');
  const __ref_51 =
    (__ref_53.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_53.localName !== 'foreignObject') ||
    __ref_53.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[51] = __ref_51;
  __ref_51.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_51.append(document.createTextNode('Search'));
  __ref_53.append(__ref_51);
  const __ref_52 =
    (__ref_53.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_53.localName !== 'foreignObject') ||
    __ref_53.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'input')
      : document.createElement('input');
  refs[52] = __ref_52;
  __ref_52.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_52.setAttribute('type', 'search');
  __ref_52.setAttribute('placeholder', 'Name, order, or message');
  __ref_53.append(__ref_52);
  __ref_114.append(__ref_53);
  const __ref_57 =
    (__ref_114.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_114.localName !== 'foreignObject') ||
    __ref_114.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[57] = __ref_57;
  __ref_57.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_57.setAttribute('class', 'list-tabs');
  const __ref_54 =
    (__ref_57.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_57.localName !== 'foreignObject') ||
    __ref_57.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[54] = __ref_54;
  __ref_54.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_54.setAttribute('class', 'active');
  __ref_54.append(document.createTextNode('Mine'));
  __ref_57.append(__ref_54);
  const __ref_55 =
    (__ref_57.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_57.localName !== 'foreignObject') ||
    __ref_57.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[55] = __ref_55;
  __ref_55.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_55.append(document.createTextNode('Unassigned'));
  __ref_57.append(__ref_55);
  const __ref_56 =
    (__ref_57.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_57.localName !== 'foreignObject') ||
    __ref_57.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[56] = __ref_56;
  __ref_56.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_56.append(document.createTextNode('All'));
  __ref_57.append(__ref_56);
  __ref_114.append(__ref_57);
  const __ref_113 =
    (__ref_114.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_114.localName !== 'foreignObject') ||
    __ref_114.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[113] = __ref_113;
  __ref_113.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_113.setAttribute('class', 'conversation-list');
  const __ref_68 =
    (__ref_113.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_113.localName !== 'foreignObject') ||
    __ref_113.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[68] = __ref_68;
  __ref_68.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_68.setAttribute('class', 'conversation-row selected');
  const __ref_58 =
    (__ref_68.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_68.localName !== 'foreignObject') ||
    __ref_68.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[58] = __ref_58;
  __ref_58.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_58.setAttribute('class', 'unread-dot');
  __ref_68.append(__ref_58);
  const __ref_67 =
    (__ref_68.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_68.localName !== 'foreignObject') ||
    __ref_68.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[67] = __ref_67;
  __ref_67.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_67.setAttribute('class', 'row-main');
  const __ref_61 =
    (__ref_67.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_67.localName !== 'foreignObject') ||
    __ref_67.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[61] = __ref_61;
  __ref_61.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_61.setAttribute('class', 'row-top');
  const __ref_59 =
    (__ref_61.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_61.localName !== 'foreignObject') ||
    __ref_61.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[59] = __ref_59;
  __ref_59.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_59.append(document.createTextNode('Alex Morgan'));
  __ref_61.append(__ref_59);
  const __ref_60 =
    (__ref_61.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_61.localName !== 'foreignObject') ||
    __ref_61.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[60] = __ref_60;
  __ref_60.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_60.append(document.createTextNode('12m'));
  __ref_61.append(__ref_60);
  __ref_67.append(__ref_61);
  const __ref_62 =
    (__ref_67.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_67.localName !== 'foreignObject') ||
    __ref_67.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[62] = __ref_62;
  __ref_62.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_62.setAttribute('class', 'row-subject');
  __ref_62.append(document.createTextNode('Duplicate annual charge'));
  __ref_67.append(__ref_62);
  const __ref_63 =
    (__ref_67.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_67.localName !== 'foreignObject') ||
    __ref_67.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[63] = __ref_63;
  __ref_63.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_63.setAttribute('class', 'row-preview');
  __ref_63.append(document.createTextNode('My card was charged twice for the same plan…'));
  __ref_67.append(__ref_63);
  const __ref_66 =
    (__ref_67.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_67.localName !== 'foreignObject') ||
    __ref_67.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[66] = __ref_66;
  __ref_66.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_66.setAttribute('class', 'row-meta');
  const __ref_64 =
    (__ref_66.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_66.localName !== 'foreignObject') ||
    __ref_66.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[64] = __ref_64;
  __ref_64.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_64.setAttribute('class', 'tag billing');
  __ref_64.append(document.createTextNode('Billing'));
  __ref_66.append(__ref_64);
  const __ref_65 =
    (__ref_66.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_66.localName !== 'foreignObject') ||
    __ref_66.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[65] = __ref_65;
  __ref_65.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_65.append(document.createTextNode('order-842'));
  __ref_66.append(__ref_65);
  __ref_67.append(__ref_66);
  __ref_68.append(__ref_67);
  __ref_113.append(__ref_68);
  const __ref_79 =
    (__ref_113.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_113.localName !== 'foreignObject') ||
    __ref_113.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[79] = __ref_79;
  __ref_79.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_79.setAttribute('class', 'conversation-row');
  const __ref_69 =
    (__ref_79.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_79.localName !== 'foreignObject') ||
    __ref_79.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[69] = __ref_69;
  __ref_69.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_69.setAttribute('class', 'unread-dot muted');
  __ref_79.append(__ref_69);
  const __ref_78 =
    (__ref_79.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_79.localName !== 'foreignObject') ||
    __ref_79.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[78] = __ref_78;
  __ref_78.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_78.setAttribute('class', 'row-main');
  const __ref_72 =
    (__ref_78.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_78.localName !== 'foreignObject') ||
    __ref_78.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[72] = __ref_72;
  __ref_72.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_72.setAttribute('class', 'row-top');
  const __ref_70 =
    (__ref_72.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_72.localName !== 'foreignObject') ||
    __ref_72.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[70] = __ref_70;
  __ref_70.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_70.append(document.createTextNode('Priya Shah'));
  __ref_72.append(__ref_70);
  const __ref_71 =
    (__ref_72.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_72.localName !== 'foreignObject') ||
    __ref_72.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[71] = __ref_71;
  __ref_71.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_71.append(document.createTextNode('38m'));
  __ref_72.append(__ref_71);
  __ref_78.append(__ref_72);
  const __ref_73 =
    (__ref_78.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_78.localName !== 'foreignObject') ||
    __ref_78.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[73] = __ref_73;
  __ref_73.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_73.setAttribute('class', 'row-subject');
  __ref_73.append(document.createTextNode('Invoice address'));
  __ref_78.append(__ref_73);
  const __ref_74 =
    (__ref_78.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_78.localName !== 'foreignObject') ||
    __ref_78.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[74] = __ref_74;
  __ref_74.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_74.setAttribute('class', 'row-preview');
  __ref_74.append(document.createTextNode('We moved offices in September and…'));
  __ref_78.append(__ref_74);
  const __ref_77 =
    (__ref_78.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_78.localName !== 'foreignObject') ||
    __ref_78.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[77] = __ref_77;
  __ref_77.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_77.setAttribute('class', 'row-meta');
  const __ref_75 =
    (__ref_77.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_77.localName !== 'foreignObject') ||
    __ref_77.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[75] = __ref_75;
  __ref_75.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_75.setAttribute('class', 'tag account');
  __ref_75.append(document.createTextNode('Account'));
  __ref_77.append(__ref_75);
  const __ref_76 =
    (__ref_77.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_77.localName !== 'foreignObject') ||
    __ref_77.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[76] = __ref_76;
  __ref_76.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_76.append(document.createTextNode('Invoice 1049'));
  __ref_77.append(__ref_76);
  __ref_78.append(__ref_77);
  __ref_79.append(__ref_78);
  __ref_113.append(__ref_79);
  const __ref_90 =
    (__ref_113.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_113.localName !== 'foreignObject') ||
    __ref_113.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[90] = __ref_90;
  __ref_90.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_90.setAttribute('class', 'conversation-row');
  const __ref_80 =
    (__ref_90.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_90.localName !== 'foreignObject') ||
    __ref_90.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[80] = __ref_80;
  __ref_80.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_80.setAttribute('class', 'unread-dot muted');
  __ref_90.append(__ref_80);
  const __ref_89 =
    (__ref_90.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_90.localName !== 'foreignObject') ||
    __ref_90.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[89] = __ref_89;
  __ref_89.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_89.setAttribute('class', 'row-main');
  const __ref_83 =
    (__ref_89.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_89.localName !== 'foreignObject') ||
    __ref_89.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[83] = __ref_83;
  __ref_83.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_83.setAttribute('class', 'row-top');
  const __ref_81 =
    (__ref_83.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_83.localName !== 'foreignObject') ||
    __ref_83.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[81] = __ref_81;
  __ref_81.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_81.append(document.createTextNode('Mateo Ruiz'));
  __ref_83.append(__ref_81);
  const __ref_82 =
    (__ref_83.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_83.localName !== 'foreignObject') ||
    __ref_83.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[82] = __ref_82;
  __ref_82.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_82.append(document.createTextNode('1h'));
  __ref_83.append(__ref_82);
  __ref_89.append(__ref_83);
  const __ref_84 =
    (__ref_89.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_89.localName !== 'foreignObject') ||
    __ref_89.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[84] = __ref_84;
  __ref_84.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_84.setAttribute('class', 'row-subject');
  __ref_84.append(document.createTextNode('Add another seat'));
  __ref_89.append(__ref_84);
  const __ref_85 =
    (__ref_89.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_89.localName !== 'foreignObject') ||
    __ref_89.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[85] = __ref_85;
  __ref_85.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_85.setAttribute('class', 'row-preview');
  __ref_85.append(document.createTextNode('Can I add one more person before…'));
  __ref_89.append(__ref_85);
  const __ref_88 =
    (__ref_89.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_89.localName !== 'foreignObject') ||
    __ref_89.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[88] = __ref_88;
  __ref_88.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_88.setAttribute('class', 'row-meta');
  const __ref_86 =
    (__ref_88.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_88.localName !== 'foreignObject') ||
    __ref_88.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[86] = __ref_86;
  __ref_86.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_86.setAttribute('class', 'tag billing');
  __ref_86.append(document.createTextNode('Billing'));
  __ref_88.append(__ref_86);
  const __ref_87 =
    (__ref_88.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_88.localName !== 'foreignObject') ||
    __ref_88.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[87] = __ref_87;
  __ref_87.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_87.append(document.createTextNode('Annual plan'));
  __ref_88.append(__ref_87);
  __ref_89.append(__ref_88);
  __ref_90.append(__ref_89);
  __ref_113.append(__ref_90);
  const __ref_101 =
    (__ref_113.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_113.localName !== 'foreignObject') ||
    __ref_113.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[101] = __ref_101;
  __ref_101.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_101.setAttribute('class', 'conversation-row');
  const __ref_91 =
    (__ref_101.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_101.localName !== 'foreignObject') ||
    __ref_101.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[91] = __ref_91;
  __ref_91.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_91.setAttribute('class', 'unread-dot muted');
  __ref_101.append(__ref_91);
  const __ref_100 =
    (__ref_101.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_101.localName !== 'foreignObject') ||
    __ref_101.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[100] = __ref_100;
  __ref_100.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_100.setAttribute('class', 'row-main');
  const __ref_94 =
    (__ref_100.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_100.localName !== 'foreignObject') ||
    __ref_100.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[94] = __ref_94;
  __ref_94.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_94.setAttribute('class', 'row-top');
  const __ref_92 =
    (__ref_94.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_94.localName !== 'foreignObject') ||
    __ref_94.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[92] = __ref_92;
  __ref_92.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_92.append(document.createTextNode('Nina Patel'));
  __ref_94.append(__ref_92);
  const __ref_93 =
    (__ref_94.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_94.localName !== 'foreignObject') ||
    __ref_94.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[93] = __ref_93;
  __ref_93.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_93.append(document.createTextNode('2h'));
  __ref_94.append(__ref_93);
  __ref_100.append(__ref_94);
  const __ref_95 =
    (__ref_100.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_100.localName !== 'foreignObject') ||
    __ref_100.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[95] = __ref_95;
  __ref_95.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_95.setAttribute('class', 'row-subject');
  __ref_95.append(document.createTextNode('Export history'));
  __ref_100.append(__ref_95);
  const __ref_96 =
    (__ref_100.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_100.localName !== 'foreignObject') ||
    __ref_100.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[96] = __ref_96;
  __ref_96.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_96.setAttribute('class', 'row-preview');
  __ref_96.append(document.createTextNode('Is it possible to download the full…'));
  __ref_100.append(__ref_96);
  const __ref_99 =
    (__ref_100.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_100.localName !== 'foreignObject') ||
    __ref_100.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[99] = __ref_99;
  __ref_99.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_99.setAttribute('class', 'row-meta');
  const __ref_97 =
    (__ref_99.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_99.localName !== 'foreignObject') ||
    __ref_99.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[97] = __ref_97;
  __ref_97.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_97.setAttribute('class', 'tag account');
  __ref_97.append(document.createTextNode('Account'));
  __ref_99.append(__ref_97);
  const __ref_98 =
    (__ref_99.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_99.localName !== 'foreignObject') ||
    __ref_99.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[98] = __ref_98;
  __ref_98.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_98.append(document.createTextNode('Data'));
  __ref_99.append(__ref_98);
  __ref_100.append(__ref_99);
  __ref_101.append(__ref_100);
  __ref_113.append(__ref_101);
  const __ref_112 =
    (__ref_113.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_113.localName !== 'foreignObject') ||
    __ref_113.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[112] = __ref_112;
  __ref_112.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_112.setAttribute('class', 'conversation-row');
  const __ref_102 =
    (__ref_112.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_112.localName !== 'foreignObject') ||
    __ref_112.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[102] = __ref_102;
  __ref_102.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_102.setAttribute('class', 'unread-dot muted');
  __ref_112.append(__ref_102);
  const __ref_111 =
    (__ref_112.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_112.localName !== 'foreignObject') ||
    __ref_112.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[111] = __ref_111;
  __ref_111.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_111.setAttribute('class', 'row-main');
  const __ref_105 =
    (__ref_111.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_111.localName !== 'foreignObject') ||
    __ref_111.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[105] = __ref_105;
  __ref_105.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_105.setAttribute('class', 'row-top');
  const __ref_103 =
    (__ref_105.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_105.localName !== 'foreignObject') ||
    __ref_105.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[103] = __ref_103;
  __ref_103.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_103.append(document.createTextNode('Owen Bell'));
  __ref_105.append(__ref_103);
  const __ref_104 =
    (__ref_105.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_105.localName !== 'foreignObject') ||
    __ref_105.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[104] = __ref_104;
  __ref_104.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_104.append(document.createTextNode('Yesterday'));
  __ref_105.append(__ref_104);
  __ref_111.append(__ref_105);
  const __ref_106 =
    (__ref_111.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_111.localName !== 'foreignObject') ||
    __ref_111.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[106] = __ref_106;
  __ref_106.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_106.setAttribute('class', 'row-subject');
  __ref_106.append(document.createTextNode('Payment failed'));
  __ref_111.append(__ref_106);
  const __ref_107 =
    (__ref_111.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_111.localName !== 'foreignObject') ||
    __ref_111.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[107] = __ref_107;
  __ref_107.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_107.setAttribute('class', 'row-preview');
  __ref_107.append(document.createTextNode('The card ending 4418 keeps being declined…'));
  __ref_111.append(__ref_107);
  const __ref_110 =
    (__ref_111.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_111.localName !== 'foreignObject') ||
    __ref_111.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[110] = __ref_110;
  __ref_110.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_110.setAttribute('class', 'row-meta');
  const __ref_108 =
    (__ref_110.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_110.localName !== 'foreignObject') ||
    __ref_110.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[108] = __ref_108;
  __ref_108.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_108.setAttribute('class', 'tag billing');
  __ref_108.append(document.createTextNode('Billing'));
  __ref_110.append(__ref_108);
  const __ref_109 =
    (__ref_110.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_110.localName !== 'foreignObject') ||
    __ref_110.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[109] = __ref_109;
  __ref_109.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_109.append(document.createTextNode('Failed'));
  __ref_110.append(__ref_109);
  __ref_111.append(__ref_110);
  __ref_112.append(__ref_111);
  __ref_113.append(__ref_112);
  __ref_114.append(__ref_113);
  __ref_381.append(__ref_114);
  const __ref_240 =
    (__ref_381.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_381.localName !== 'foreignObject') ||
    __ref_381.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'main')
      : document.createElement('main');
  refs[240] = __ref_240;
  __ref_240.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_240.setAttribute('class', 'conversation');
  const __ref_125 =
    (__ref_240.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_240.localName !== 'foreignObject') ||
    __ref_240.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'header')
      : document.createElement('header');
  refs[125] = __ref_125;
  __ref_125.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_125.setAttribute('class', 'conversation-header');
  const __ref_120 =
    (__ref_125.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_125.localName !== 'foreignObject') ||
    __ref_125.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[120] = __ref_120;
  __ref_120.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_120.setAttribute('class', 'case-title');
  const __ref_118 =
    (__ref_120.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_120.localName !== 'foreignObject') ||
    __ref_120.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[118] = __ref_118;
  __ref_118.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_118.setAttribute('class', 'microline');
  const __ref_115 =
    (__ref_118.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_118.localName !== 'foreignObject') ||
    __ref_118.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[115] = __ref_115;
  __ref_115.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_115.append(document.createTextNode('#SV-2048'));
  __ref_118.append(__ref_115);
  const __ref_116 =
    (__ref_118.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_118.localName !== 'foreignObject') ||
    __ref_118.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[116] = __ref_116;
  __ref_116.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_116.append(document.createTextNode('Email'));
  __ref_118.append(__ref_116);
  const __ref_117 =
    (__ref_118.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_118.localName !== 'foreignObject') ||
    __ref_118.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[117] = __ref_117;
  __ref_117.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_117.append(document.createTextNode('Opened today at 9:41 AM'));
  __ref_118.append(__ref_117);
  __ref_120.append(__ref_118);
  const __ref_119 =
    (__ref_120.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_120.localName !== 'foreignObject') ||
    __ref_120.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h2')
      : document.createElement('h2');
  refs[119] = __ref_119;
  __ref_119.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_119.append(document.createTextNode('Duplicate annual plan charge'));
  __ref_120.append(__ref_119);
  __ref_125.append(__ref_120);
  const __ref_124 =
    (__ref_125.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_125.localName !== 'foreignObject') ||
    __ref_125.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[124] = __ref_124;
  __ref_124.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_124.setAttribute('class', 'case-actions');
  const __ref_122 =
    (__ref_124.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_124.localName !== 'foreignObject') ||
    __ref_124.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[122] = __ref_122;
  __ref_122.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_122.setAttribute('class', 'case-status');
  __ref_122.setAttribute('class:resolved', 'completed');
  const __ref_121 = document.createTextNode('');
  refs[121] = __ref_121;
  __ref_122.append(__ref_121);
  __ref_124.append(__ref_122);
  const __ref_123 =
    (__ref_124.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_124.localName !== 'foreignObject') ||
    __ref_124.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[123] = __ref_123;
  __ref_123.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_123.setAttribute('class', 'icon-button');
  __ref_123.setAttribute('aria-label', 'More actions');
  __ref_123.append(document.createTextNode('•••'));
  __ref_124.append(__ref_123);
  __ref_125.append(__ref_124);
  __ref_240.append(__ref_125);
  const __ref_230 =
    (__ref_240.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_240.localName !== 'foreignObject') ||
    __ref_240.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[230] = __ref_230;
  __ref_230.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_230.setAttribute('class', 'thread');
  const __ref_127 =
    (__ref_230.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_230.localName !== 'foreignObject') ||
    __ref_230.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[127] = __ref_127;
  __ref_127.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_127.setAttribute('class', 'thread-day');
  const __ref_126 =
    (__ref_127.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_127.localName !== 'foreignObject') ||
    __ref_127.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[126] = __ref_126;
  __ref_126.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_126.append(document.createTextNode('Today'));
  __ref_127.append(__ref_126);
  __ref_230.append(__ref_127);
  const __ref_140 =
    (__ref_230.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_230.localName !== 'foreignObject') ||
    __ref_230.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'article')
      : document.createElement('article');
  refs[140] = __ref_140;
  __ref_140.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_140.setAttribute('class', 'message customer-message');
  const __ref_128 =
    (__ref_140.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_140.localName !== 'foreignObject') ||
    __ref_140.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[128] = __ref_128;
  __ref_128.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_128.setAttribute('class', 'avatar customer');
  __ref_128.append(document.createTextNode('AM'));
  __ref_140.append(__ref_128);
  const __ref_139 =
    (__ref_140.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_140.localName !== 'foreignObject') ||
    __ref_140.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[139] = __ref_139;
  __ref_139.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_139.setAttribute('class', 'message-body');
  const __ref_132 =
    (__ref_139.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_139.localName !== 'foreignObject') ||
    __ref_139.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[132] = __ref_132;
  __ref_132.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_132.setAttribute('class', 'message-head');
  const __ref_129 =
    (__ref_132.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_132.localName !== 'foreignObject') ||
    __ref_132.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[129] = __ref_129;
  __ref_129.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_129.append(document.createTextNode('Alex Morgan'));
  __ref_132.append(__ref_129);
  const __ref_130 =
    (__ref_132.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_132.localName !== 'foreignObject') ||
    __ref_132.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[130] = __ref_130;
  __ref_130.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_130.append(document.createTextNode('alex.morgan@example.com'));
  __ref_132.append(__ref_130);
  const __ref_131 =
    (__ref_132.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_132.localName !== 'foreignObject') ||
    __ref_132.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[131] = __ref_131;
  __ref_131.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_131.append(document.createTextNode('9:41 AM'));
  __ref_132.append(__ref_131);
  __ref_139.append(__ref_132);
  const __ref_133 =
    (__ref_139.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_139.localName !== 'foreignObject') ||
    __ref_139.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[133] = __ref_133;
  __ref_133.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_133.append(
    document.createTextNode(
      'My card was charged twice for the same annual plan. Can you refund the duplicate?',
    ),
  );
  __ref_139.append(__ref_133);
  const __ref_138 =
    (__ref_139.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_139.localName !== 'foreignObject') ||
    __ref_139.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[138] = __ref_138;
  __ref_138.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_138.setAttribute('class', 'message-facts');
  const __ref_135 =
    (__ref_138.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_138.localName !== 'foreignObject') ||
    __ref_138.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[135] = __ref_135;
  __ref_135.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_134 =
    (__ref_135.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_135.localName !== 'foreignObject') ||
    __ref_135.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[134] = __ref_134;
  __ref_134.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_134.append(document.createTextNode('Order'));
  __ref_135.append(__ref_134);
  __ref_135.append(document.createTextNode(' order-842'));
  __ref_138.append(__ref_135);
  const __ref_137 =
    (__ref_138.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_138.localName !== 'foreignObject') ||
    __ref_138.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[137] = __ref_137;
  __ref_137.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_136 =
    (__ref_137.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_137.localName !== 'foreignObject') ||
    __ref_137.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[136] = __ref_136;
  __ref_136.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_136.append(document.createTextNode('Duplicate'));
  __ref_137.append(__ref_136);
  __ref_137.append(document.createTextNode(' NZ$49.00'));
  __ref_138.append(__ref_137);
  __ref_139.append(__ref_138);
  __ref_140.append(__ref_139);
  __ref_230.append(__ref_140);
  const __ref_151 =
    (__ref_230.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_230.localName !== 'foreignObject') ||
    __ref_230.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[151] = __ref_151;
  __ref_151.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_151.setAttribute('if', '!data && !completed');
  __ref_151.setAttribute('class', 'review-start');
  const __ref_141 =
    (__ref_151.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_151.localName !== 'foreignObject') ||
    __ref_151.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[141] = __ref_141;
  __ref_141.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_141.setAttribute('class', 'review-start-icon');
  __ref_141.append(document.createTextNode('H'));
  __ref_151.append(__ref_141);
  const __ref_148 =
    (__ref_151.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_151.localName !== 'foreignObject') ||
    __ref_151.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[148] = __ref_148;
  __ref_148.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_148.setAttribute('class', 'review-start-copy');
  const __ref_142 =
    (__ref_148.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_148.localName !== 'foreignObject') ||
    __ref_148.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[142] = __ref_142;
  __ref_142.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_142.append(document.createTextNode('Run the refund review'));
  __ref_148.append(__ref_142);
  const __ref_143 =
    (__ref_148.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_148.localName !== 'foreignObject') ||
    __ref_148.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[143] = __ref_143;
  __ref_143.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_143.append(
    document.createTextNode(
      '\n                Checks the two payments and duplicate-charge policy. If the refund qualifies,\n                the action stops here for your approval.\n              ',
    ),
  );
  __ref_148.append(__ref_143);
  const __ref_147 =
    (__ref_148.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_148.localName !== 'foreignObject') ||
    __ref_148.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[147] = __ref_147;
  __ref_147.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_147.setAttribute('class', 'review-checks');
  const __ref_144 =
    (__ref_147.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_147.localName !== 'foreignObject') ||
    __ref_147.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[144] = __ref_144;
  __ref_144.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_144.append(document.createTextNode('Account state'));
  __ref_147.append(__ref_144);
  const __ref_145 =
    (__ref_147.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_147.localName !== 'foreignObject') ||
    __ref_147.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[145] = __ref_145;
  __ref_145.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_145.append(document.createTextNode('Refund policy'));
  __ref_147.append(__ref_145);
  const __ref_146 =
    (__ref_147.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_147.localName !== 'foreignObject') ||
    __ref_147.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[146] = __ref_146;
  __ref_146.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_146.append(document.createTextNode('Exact order and amount'));
  __ref_147.append(__ref_146);
  __ref_148.append(__ref_147);
  __ref_151.append(__ref_148);
  const __ref_150 =
    (__ref_151.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_151.localName !== 'foreignObject') ||
    __ref_151.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[150] = __ref_150;
  __ref_150.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_150.setAttribute('class', 'primary-button');
  __ref_150.addEventListener('click', (event) => {
    const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[2](__weiv_context, event))(
      instance.refresh(),
    );
    return resolved;
  });
  const __ref_149 = document.createTextNode('');
  refs[149] = __ref_149;
  __ref_150.append(__ref_149);
  __ref_151.append(__ref_150);
  __ref_230.append(__ref_151);
  const __ref_182 =
    (__ref_230.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_230.localName !== 'foreignObject') ||
    __ref_230.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[182] = __ref_182;
  __ref_182.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_182.setAttribute('class', 'thread-state');
  __ref_182.setAttribute('if', 'data && !completed');
  const __ref_168 =
    (__ref_182.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_182.localName !== 'foreignObject') ||
    __ref_182.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'article')
      : document.createElement('article');
  refs[168] = __ref_168;
  __ref_168.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_168.setAttribute('class', 'activity-block');
  const __ref_156 =
    (__ref_168.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_168.localName !== 'foreignObject') ||
    __ref_168.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[156] = __ref_156;
  __ref_156.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_156.setAttribute('class', 'activity-head');
  const __ref_154 =
    (__ref_156.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_156.localName !== 'foreignObject') ||
    __ref_156.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[154] = __ref_154;
  __ref_154.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_152 =
    (__ref_154.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_154.localName !== 'foreignObject') ||
    __ref_154.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[152] = __ref_152;
  __ref_152.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_152.setAttribute('class', 'agent-avatar');
  __ref_152.append(document.createTextNode('H'));
  __ref_154.append(__ref_152);
  const __ref_153 =
    (__ref_154.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_154.localName !== 'foreignObject') ||
    __ref_154.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[153] = __ref_153;
  __ref_153.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_153.append(document.createTextNode('Harngine review'));
  __ref_154.append(__ref_153);
  __ref_156.append(__ref_154);
  const __ref_155 =
    (__ref_156.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_156.localName !== 'foreignObject') ||
    __ref_156.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[155] = __ref_155;
  __ref_155.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_155.setAttribute('class', 'activity-time');
  __ref_155.append(document.createTextNode('Completed in 0.8s'));
  __ref_156.append(__ref_155);
  __ref_168.append(__ref_156);
  const __ref_157 =
    (__ref_168.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_168.localName !== 'foreignObject') ||
    __ref_168.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[157] = __ref_157;
  __ref_157.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_157.setAttribute('class', 'activity-summary');
  __ref_157.append(
    document.createTextNode(
      'Found two settled charges for order-842. The duplicate qualifies for a billing review.',
    ),
  );
  __ref_168.append(__ref_157);
  const __ref_167 =
    (__ref_168.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_168.localName !== 'foreignObject') ||
    __ref_168.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[167] = __ref_167;
  __ref_167.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_167.setAttribute('class', 'activity-grid');
  const __ref_161 =
    (__ref_167.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_167.localName !== 'foreignObject') ||
    __ref_167.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[161] = __ref_161;
  __ref_161.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_158 =
    (__ref_161.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_161.localName !== 'foreignObject') ||
    __ref_161.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[158] = __ref_158;
  __ref_158.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_158.append(document.createTextNode('Account check'));
  __ref_161.append(__ref_158);
  const __ref_159 =
    (__ref_161.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_161.localName !== 'foreignObject') ||
    __ref_161.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[159] = __ref_159;
  __ref_159.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_159.append(document.createTextNode('Two settled charges'));
  __ref_161.append(__ref_159);
  const __ref_160 =
    (__ref_161.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_161.localName !== 'foreignObject') ||
    __ref_161.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'code')
      : document.createElement('code');
  refs[160] = __ref_160;
  __ref_160.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_160.append(document.createTextNode('support.account.status'));
  __ref_161.append(__ref_160);
  __ref_167.append(__ref_161);
  const __ref_166 =
    (__ref_167.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_167.localName !== 'foreignObject') ||
    __ref_167.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[166] = __ref_166;
  __ref_166.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_162 =
    (__ref_166.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_166.localName !== 'foreignObject') ||
    __ref_166.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[162] = __ref_162;
  __ref_162.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_162.append(document.createTextNode('Policy check'));
  __ref_166.append(__ref_162);
  const __ref_163 =
    (__ref_166.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_166.localName !== 'foreignObject') ||
    __ref_166.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[163] = __ref_163;
  __ref_163.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_163.append(document.createTextNode('Billing specialist review'));
  __ref_166.append(__ref_163);
  const __ref_165 =
    (__ref_166.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_166.localName !== 'foreignObject') ||
    __ref_166.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'code')
      : document.createElement('code');
  refs[165] = __ref_165;
  __ref_165.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_164 = document.createTextNode('');
  refs[164] = __ref_164;
  __ref_165.append(__ref_164);
  __ref_166.append(__ref_165);
  __ref_167.append(__ref_166);
  __ref_168.append(__ref_167);
  __ref_182.append(__ref_168);
  const __ref_173 =
    (__ref_182.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_182.localName !== 'foreignObject') ||
    __ref_182.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[173] = __ref_173;
  __ref_173.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_173.setAttribute('class', 'system-event');
  const __ref_169 =
    (__ref_173.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_173.localName !== 'foreignObject') ||
    __ref_173.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[169] = __ref_169;
  __ref_169.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_169.setAttribute('class', 'event-icon');
  __ref_169.append(document.createTextNode('↪'));
  __ref_173.append(__ref_169);
  const __ref_171 =
    (__ref_173.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_173.localName !== 'foreignObject') ||
    __ref_173.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[171] = __ref_171;
  __ref_171.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_170 =
    (__ref_171.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_171.localName !== 'foreignObject') ||
    __ref_171.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[170] = __ref_170;
  __ref_170.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_170.append(document.createTextNode('Triage handed off to Billing'));
  __ref_171.append(__ref_170);
  __ref_171.append(document.createTextNode(' · Conversation context and evidence carried over'));
  __ref_173.append(__ref_171);
  const __ref_172 =
    (__ref_173.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_173.localName !== 'foreignObject') ||
    __ref_173.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[172] = __ref_172;
  __ref_172.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_172.append(document.createTextNode('9:43 AM'));
  __ref_173.append(__ref_172);
  __ref_182.append(__ref_173);
  const __ref_181 =
    (__ref_182.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_182.localName !== 'foreignObject') ||
    __ref_182.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'article')
      : document.createElement('article');
  refs[181] = __ref_181;
  __ref_181.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_181.setAttribute('class', 'message agent-message');
  const __ref_174 =
    (__ref_181.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_181.localName !== 'foreignObject') ||
    __ref_181.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[174] = __ref_174;
  __ref_174.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_174.setAttribute('class', 'avatar agent');
  __ref_174.append(document.createTextNode('BS'));
  __ref_181.append(__ref_174);
  const __ref_180 =
    (__ref_181.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_181.localName !== 'foreignObject') ||
    __ref_181.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[180] = __ref_180;
  __ref_180.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_180.setAttribute('class', 'message-body');
  const __ref_178 =
    (__ref_180.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_180.localName !== 'foreignObject') ||
    __ref_180.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[178] = __ref_178;
  __ref_178.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_178.setAttribute('class', 'message-head');
  const __ref_175 =
    (__ref_178.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_178.localName !== 'foreignObject') ||
    __ref_178.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[175] = __ref_175;
  __ref_175.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_175.append(document.createTextNode('Billing Specialist'));
  __ref_178.append(__ref_175);
  const __ref_176 =
    (__ref_178.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_178.localName !== 'foreignObject') ||
    __ref_178.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[176] = __ref_176;
  __ref_176.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_176.append(document.createTextNode('Harngine Agent'));
  __ref_178.append(__ref_176);
  const __ref_177 =
    (__ref_178.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_178.localName !== 'foreignObject') ||
    __ref_178.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[177] = __ref_177;
  __ref_177.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_177.append(document.createTextNode('9:43 AM'));
  __ref_178.append(__ref_177);
  __ref_180.append(__ref_178);
  const __ref_179 =
    (__ref_180.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_180.localName !== 'foreignObject') ||
    __ref_180.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[179] = __ref_179;
  __ref_179.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_179.append(
    document.createTextNode(
      '\n                  I confirmed the duplicate charge and the policy requirement. The proposed refund is\n                  ready for operator approval. Nothing has been sent to the payment provider yet.\n                ',
    ),
  );
  __ref_180.append(__ref_179);
  __ref_181.append(__ref_180);
  __ref_182.append(__ref_181);
  __ref_230.append(__ref_182);
  const __ref_227 =
    (__ref_230.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_230.localName !== 'foreignObject') ||
    __ref_230.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[227] = __ref_227;
  __ref_227.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_227.setAttribute('class', 'thread-state');
  __ref_227.setAttribute('if', 'completed');
  const __ref_198 =
    (__ref_227.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_227.localName !== 'foreignObject') ||
    __ref_227.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'article')
      : document.createElement('article');
  refs[198] = __ref_198;
  __ref_198.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_198.setAttribute('class', 'activity-block');
  const __ref_187 =
    (__ref_198.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_198.localName !== 'foreignObject') ||
    __ref_198.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[187] = __ref_187;
  __ref_187.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_187.setAttribute('class', 'activity-head');
  const __ref_185 =
    (__ref_187.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_187.localName !== 'foreignObject') ||
    __ref_187.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[185] = __ref_185;
  __ref_185.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_183 =
    (__ref_185.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_185.localName !== 'foreignObject') ||
    __ref_185.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[183] = __ref_183;
  __ref_183.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_183.setAttribute('class', 'agent-avatar');
  __ref_183.append(document.createTextNode('H'));
  __ref_185.append(__ref_183);
  const __ref_184 =
    (__ref_185.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_185.localName !== 'foreignObject') ||
    __ref_185.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[184] = __ref_184;
  __ref_184.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_184.append(document.createTextNode('Harngine review'));
  __ref_185.append(__ref_184);
  __ref_187.append(__ref_185);
  const __ref_186 =
    (__ref_187.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_187.localName !== 'foreignObject') ||
    __ref_187.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[186] = __ref_186;
  __ref_186.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_186.setAttribute('class', 'activity-time');
  __ref_186.append(document.createTextNode('Completed in 1.2s'));
  __ref_187.append(__ref_186);
  __ref_198.append(__ref_187);
  const __ref_188 =
    (__ref_198.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_198.localName !== 'foreignObject') ||
    __ref_198.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[188] = __ref_188;
  __ref_188.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_188.setAttribute('class', 'activity-summary');
  __ref_188.append(document.createTextNode('Approved refund completed against order-842.'));
  __ref_198.append(__ref_188);
  const __ref_197 =
    (__ref_198.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_198.localName !== 'foreignObject') ||
    __ref_198.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[197] = __ref_197;
  __ref_197.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_197.setAttribute('class', 'activity-grid');
  const __ref_192 =
    (__ref_197.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_197.localName !== 'foreignObject') ||
    __ref_197.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[192] = __ref_192;
  __ref_192.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_189 =
    (__ref_192.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_192.localName !== 'foreignObject') ||
    __ref_192.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[189] = __ref_189;
  __ref_189.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_189.append(document.createTextNode('Account check'));
  __ref_192.append(__ref_189);
  const __ref_190 =
    (__ref_192.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_192.localName !== 'foreignObject') ||
    __ref_192.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[190] = __ref_190;
  __ref_190.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_190.append(document.createTextNode('Two settled charges'));
  __ref_192.append(__ref_190);
  const __ref_191 =
    (__ref_192.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_192.localName !== 'foreignObject') ||
    __ref_192.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'code')
      : document.createElement('code');
  refs[191] = __ref_191;
  __ref_191.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_191.append(document.createTextNode('support.account.status'));
  __ref_192.append(__ref_191);
  __ref_197.append(__ref_192);
  const __ref_196 =
    (__ref_197.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_197.localName !== 'foreignObject') ||
    __ref_197.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[196] = __ref_196;
  __ref_196.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_193 =
    (__ref_196.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_196.localName !== 'foreignObject') ||
    __ref_196.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[193] = __ref_193;
  __ref_193.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_193.append(document.createTextNode('Refund write'));
  __ref_196.append(__ref_193);
  const __ref_194 =
    (__ref_196.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_196.localName !== 'foreignObject') ||
    __ref_196.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[194] = __ref_194;
  __ref_194.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_194.append(document.createTextNode('Executed after approval'));
  __ref_196.append(__ref_194);
  const __ref_195 =
    (__ref_196.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_196.localName !== 'foreignObject') ||
    __ref_196.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'code')
      : document.createElement('code');
  refs[195] = __ref_195;
  __ref_195.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_195.append(document.createTextNode('support.billing.refund'));
  __ref_196.append(__ref_195);
  __ref_197.append(__ref_196);
  __ref_198.append(__ref_197);
  __ref_227.append(__ref_198);
  const __ref_204 =
    (__ref_227.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_227.localName !== 'foreignObject') ||
    __ref_227.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[204] = __ref_204;
  __ref_204.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_204.setAttribute('class', 'system-event');
  const __ref_199 =
    (__ref_204.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_204.localName !== 'foreignObject') ||
    __ref_204.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[199] = __ref_199;
  __ref_199.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_199.setAttribute('class', 'event-icon');
  __ref_199.append(document.createTextNode('↪'));
  __ref_204.append(__ref_199);
  const __ref_202 =
    (__ref_204.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_204.localName !== 'foreignObject') ||
    __ref_204.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[202] = __ref_202;
  __ref_202.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_200 =
    (__ref_202.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_202.localName !== 'foreignObject') ||
    __ref_202.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[200] = __ref_200;
  __ref_200.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_200.append(document.createTextNode('Triage handed off to Billing'));
  __ref_202.append(__ref_200);
  __ref_202.append(document.createTextNode(' · '));
  const __ref_201 = document.createTextNode('');
  refs[201] = __ref_201;
  __ref_202.append(__ref_201);
  __ref_204.append(__ref_202);
  const __ref_203 =
    (__ref_204.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_204.localName !== 'foreignObject') ||
    __ref_204.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[203] = __ref_203;
  __ref_203.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_203.append(document.createTextNode('9:43 AM'));
  __ref_204.append(__ref_203);
  __ref_227.append(__ref_204);
  const __ref_226 =
    (__ref_227.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_227.localName !== 'foreignObject') ||
    __ref_227.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'article')
      : document.createElement('article');
  refs[226] = __ref_226;
  __ref_226.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_226.setAttribute('class', 'message agent-message resolved-message');
  const __ref_205 =
    (__ref_226.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_226.localName !== 'foreignObject') ||
    __ref_226.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[205] = __ref_205;
  __ref_205.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_205.setAttribute('class', 'avatar agent');
  __ref_205.append(document.createTextNode('BS'));
  __ref_226.append(__ref_205);
  const __ref_225 =
    (__ref_226.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_226.localName !== 'foreignObject') ||
    __ref_226.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[225] = __ref_225;
  __ref_225.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_225.setAttribute('class', 'message-body');
  const __ref_209 =
    (__ref_225.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_225.localName !== 'foreignObject') ||
    __ref_225.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[209] = __ref_209;
  __ref_209.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_209.setAttribute('class', 'message-head');
  const __ref_206 =
    (__ref_209.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_209.localName !== 'foreignObject') ||
    __ref_209.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[206] = __ref_206;
  __ref_206.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_206.append(document.createTextNode('Billing Specialist'));
  __ref_209.append(__ref_206);
  const __ref_207 =
    (__ref_209.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_209.localName !== 'foreignObject') ||
    __ref_209.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[207] = __ref_207;
  __ref_207.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_207.append(document.createTextNode('Harngine Agent'));
  __ref_209.append(__ref_207);
  const __ref_208 =
    (__ref_209.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_209.localName !== 'foreignObject') ||
    __ref_209.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'time')
      : document.createElement('time');
  refs[208] = __ref_208;
  __ref_208.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_208.append(document.createTextNode('9:45 AM'));
  __ref_209.append(__ref_208);
  __ref_225.append(__ref_209);
  const __ref_211 =
    (__ref_225.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_225.localName !== 'foreignObject') ||
    __ref_225.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[211] = __ref_211;
  __ref_211.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_210 = document.createTextNode('');
  refs[210] = __ref_210;
  __ref_211.append(__ref_210);
  __ref_225.append(__ref_211);
  const __ref_224 =
    (__ref_225.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_225.localName !== 'foreignObject') ||
    __ref_225.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[224] = __ref_224;
  __ref_224.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_224.setAttribute('class', 'inline-receipt');
  const __ref_215 =
    (__ref_224.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_224.localName !== 'foreignObject') ||
    __ref_224.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[215] = __ref_215;
  __ref_215.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_212 =
    (__ref_215.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_215.localName !== 'foreignObject') ||
    __ref_215.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[212] = __ref_212;
  __ref_212.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_212.append(document.createTextNode('Refund'));
  __ref_215.append(__ref_212);
  const __ref_214 =
    (__ref_215.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_215.localName !== 'foreignObject') ||
    __ref_215.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[214] = __ref_214;
  __ref_214.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_213 = document.createTextNode('');
  refs[213] = __ref_213;
  __ref_214.append(__ref_213);
  __ref_215.append(__ref_214);
  __ref_224.append(__ref_215);
  const __ref_219 =
    (__ref_224.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_224.localName !== 'foreignObject') ||
    __ref_224.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[219] = __ref_219;
  __ref_219.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_216 =
    (__ref_219.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_219.localName !== 'foreignObject') ||
    __ref_219.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[216] = __ref_216;
  __ref_216.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_216.append(document.createTextNode('Order'));
  __ref_219.append(__ref_216);
  const __ref_218 =
    (__ref_219.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_219.localName !== 'foreignObject') ||
    __ref_219.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[218] = __ref_218;
  __ref_218.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_217 = document.createTextNode('');
  refs[217] = __ref_217;
  __ref_218.append(__ref_217);
  __ref_219.append(__ref_218);
  __ref_224.append(__ref_219);
  const __ref_223 =
    (__ref_224.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_224.localName !== 'foreignObject') ||
    __ref_224.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[223] = __ref_223;
  __ref_223.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_220 =
    (__ref_223.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_223.localName !== 'foreignObject') ||
    __ref_223.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[220] = __ref_220;
  __ref_220.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_220.append(document.createTextNode('Refund ID'));
  __ref_223.append(__ref_220);
  const __ref_222 =
    (__ref_223.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_223.localName !== 'foreignObject') ||
    __ref_223.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[222] = __ref_222;
  __ref_222.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_221 = document.createTextNode('');
  refs[221] = __ref_221;
  __ref_222.append(__ref_221);
  __ref_223.append(__ref_222);
  __ref_224.append(__ref_223);
  __ref_225.append(__ref_224);
  __ref_226.append(__ref_225);
  __ref_227.append(__ref_226);
  __ref_230.append(__ref_227);
  const __ref_229 =
    (__ref_230.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_230.localName !== 'foreignObject') ||
    __ref_230.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'small')
      : document.createElement('small');
  refs[229] = __ref_229;
  __ref_229.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_229.setAttribute('if', 'errorMessage');
  __ref_229.setAttribute('class', 'error');
  __ref_229.setAttribute('role', 'alert');
  const __ref_228 = document.createTextNode('');
  refs[228] = __ref_228;
  __ref_229.append(__ref_228);
  __ref_230.append(__ref_229);
  __ref_240.append(__ref_230);
  const __ref_239 =
    (__ref_240.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_240.localName !== 'foreignObject') ||
    __ref_240.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'footer')
      : document.createElement('footer');
  refs[239] = __ref_239;
  __ref_239.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_239.setAttribute('class', 'composer');
  const __ref_234 =
    (__ref_239.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_239.localName !== 'foreignObject') ||
    __ref_239.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[234] = __ref_234;
  __ref_234.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_234.setAttribute('class', 'composer-box');
  const __ref_232 =
    (__ref_234.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_234.localName !== 'foreignObject') ||
    __ref_234.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[232] = __ref_232;
  __ref_232.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_231 = document.createTextNode('');
  refs[231] = __ref_231;
  __ref_232.append(__ref_231);
  __ref_234.append(__ref_232);
  const __ref_233 =
    (__ref_234.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_234.localName !== 'foreignObject') ||
    __ref_234.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[233] = __ref_233;
  __ref_233.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_233.setAttribute('aria-label', 'Send');
  __ref_233.append(document.createTextNode('↑'));
  __ref_234.append(__ref_233);
  __ref_239.append(__ref_234);
  const __ref_238 =
    (__ref_239.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_239.localName !== 'foreignObject') ||
    __ref_239.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[238] = __ref_238;
  __ref_238.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_238.setAttribute('class', 'composer-meta');
  const __ref_235 =
    (__ref_238.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_238.localName !== 'foreignObject') ||
    __ref_238.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[235] = __ref_235;
  __ref_235.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_235.append(document.createTextNode('Internal note'));
  __ref_238.append(__ref_235);
  const __ref_236 =
    (__ref_238.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_238.localName !== 'foreignObject') ||
    __ref_238.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[236] = __ref_236;
  __ref_236.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_236.append(document.createTextNode('Attach'));
  __ref_238.append(__ref_236);
  const __ref_237 =
    (__ref_238.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_238.localName !== 'foreignObject') ||
    __ref_238.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[237] = __ref_237;
  __ref_237.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_237.setAttribute('class', 'composer-hint');
  __ref_237.append(document.createTextNode('Demo mode · replies are disabled'));
  __ref_238.append(__ref_237);
  __ref_239.append(__ref_238);
  __ref_240.append(__ref_239);
  __ref_381.append(__ref_240);
  const __ref_380 =
    (__ref_381.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_381.localName !== 'foreignObject') ||
    __ref_381.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'aside')
      : document.createElement('aside');
  refs[380] = __ref_380;
  __ref_380.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_380.setAttribute('class', 'context');
  __ref_380.setAttribute('aria-label', 'Customer and runtime context');
  const __ref_245 =
    (__ref_380.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_380.localName !== 'foreignObject') ||
    __ref_380.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[245] = __ref_245;
  __ref_245.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_245.setAttribute('class', 'context-header');
  const __ref_243 =
    (__ref_245.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_245.localName !== 'foreignObject') ||
    __ref_245.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[243] = __ref_243;
  __ref_243.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_243.setAttribute('class', 'context-tabs');
  const __ref_241 =
    (__ref_243.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_243.localName !== 'foreignObject') ||
    __ref_243.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[241] = __ref_241;
  __ref_241.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_241.setAttribute('class', 'active');
  __ref_241.append(document.createTextNode('Context'));
  __ref_243.append(__ref_241);
  const __ref_242 =
    (__ref_243.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_243.localName !== 'foreignObject') ||
    __ref_243.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[242] = __ref_242;
  __ref_242.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_242.append(document.createTextNode('History'));
  __ref_243.append(__ref_242);
  __ref_245.append(__ref_243);
  const __ref_244 =
    (__ref_245.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_245.localName !== 'foreignObject') ||
    __ref_245.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[244] = __ref_244;
  __ref_244.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_244.setAttribute('class', 'icon-button');
  __ref_244.setAttribute('aria-label', 'Close context');
  __ref_244.append(document.createTextNode('×'));
  __ref_245.append(__ref_244);
  __ref_380.append(__ref_245);
  const __ref_277 =
    (__ref_380.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_380.localName !== 'foreignObject') ||
    __ref_380.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[277] = __ref_277;
  __ref_277.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_277.setAttribute('class', 'context-state');
  __ref_277.setAttribute('if', '!data && !completed');
  const __ref_264 =
    (__ref_277.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_277.localName !== 'foreignObject') ||
    __ref_277.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[264] = __ref_264;
  __ref_264.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_264.setAttribute('class', 'context-section customer-card');
  const __ref_250 =
    (__ref_264.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_264.localName !== 'foreignObject') ||
    __ref_264.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[250] = __ref_250;
  __ref_250.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_250.setAttribute('class', 'customer-summary');
  const __ref_246 =
    (__ref_250.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_250.localName !== 'foreignObject') ||
    __ref_250.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[246] = __ref_246;
  __ref_246.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_246.setAttribute('class', 'avatar customer large');
  __ref_246.append(document.createTextNode('AM'));
  __ref_250.append(__ref_246);
  const __ref_249 =
    (__ref_250.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_250.localName !== 'foreignObject') ||
    __ref_250.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[249] = __ref_249;
  __ref_249.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_247 =
    (__ref_249.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_249.localName !== 'foreignObject') ||
    __ref_249.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[247] = __ref_247;
  __ref_247.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_247.append(document.createTextNode('Alex Morgan'));
  __ref_249.append(__ref_247);
  const __ref_248 =
    (__ref_249.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_249.localName !== 'foreignObject') ||
    __ref_249.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[248] = __ref_248;
  __ref_248.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_248.append(document.createTextNode('Annual plan · Customer since 2024'));
  __ref_249.append(__ref_248);
  __ref_250.append(__ref_249);
  __ref_264.append(__ref_250);
  const __ref_263 =
    (__ref_264.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_264.localName !== 'foreignObject') ||
    __ref_264.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dl')
      : document.createElement('dl');
  refs[263] = __ref_263;
  __ref_263.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_253 =
    (__ref_263.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_263.localName !== 'foreignObject') ||
    __ref_263.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[253] = __ref_253;
  __ref_253.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_251 =
    (__ref_253.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_253.localName !== 'foreignObject') ||
    __ref_253.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[251] = __ref_251;
  __ref_251.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_251.append(document.createTextNode('Order'));
  __ref_253.append(__ref_251);
  const __ref_252 =
    (__ref_253.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_253.localName !== 'foreignObject') ||
    __ref_253.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[252] = __ref_252;
  __ref_252.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_252.append(document.createTextNode('order-842'));
  __ref_253.append(__ref_252);
  __ref_263.append(__ref_253);
  const __ref_256 =
    (__ref_263.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_263.localName !== 'foreignObject') ||
    __ref_263.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[256] = __ref_256;
  __ref_256.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_254 =
    (__ref_256.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_256.localName !== 'foreignObject') ||
    __ref_256.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[254] = __ref_254;
  __ref_254.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_254.append(document.createTextNode('Plan'));
  __ref_256.append(__ref_254);
  const __ref_255 =
    (__ref_256.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_256.localName !== 'foreignObject') ||
    __ref_256.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[255] = __ref_255;
  __ref_255.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_255.append(document.createTextNode('Annual workspace'));
  __ref_256.append(__ref_255);
  __ref_263.append(__ref_256);
  const __ref_259 =
    (__ref_263.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_263.localName !== 'foreignObject') ||
    __ref_263.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[259] = __ref_259;
  __ref_259.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_257 =
    (__ref_259.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_259.localName !== 'foreignObject') ||
    __ref_259.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[257] = __ref_257;
  __ref_257.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_257.append(document.createTextNode('Payment'));
  __ref_259.append(__ref_257);
  const __ref_258 =
    (__ref_259.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_259.localName !== 'foreignObject') ||
    __ref_259.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[258] = __ref_258;
  __ref_258.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_258.append(document.createTextNode('Visa ···· 4418'));
  __ref_259.append(__ref_258);
  __ref_263.append(__ref_259);
  const __ref_262 =
    (__ref_263.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_263.localName !== 'foreignObject') ||
    __ref_263.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[262] = __ref_262;
  __ref_262.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_260 =
    (__ref_262.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_262.localName !== 'foreignObject') ||
    __ref_262.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[260] = __ref_260;
  __ref_260.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_260.append(document.createTextNode('Charge'));
  __ref_262.append(__ref_260);
  const __ref_261 =
    (__ref_262.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_262.localName !== 'foreignObject') ||
    __ref_262.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[261] = __ref_261;
  __ref_261.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_261.append(document.createTextNode('NZ$49.00'));
  __ref_262.append(__ref_261);
  __ref_263.append(__ref_262);
  __ref_264.append(__ref_263);
  __ref_277.append(__ref_264);
  const __ref_269 =
    (__ref_277.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_277.localName !== 'foreignObject') ||
    __ref_277.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[269] = __ref_269;
  __ref_269.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_269.setAttribute('class', 'context-section');
  const __ref_267 =
    (__ref_269.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_269.localName !== 'foreignObject') ||
    __ref_269.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[267] = __ref_267;
  __ref_267.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_267.setAttribute('class', 'section-title');
  const __ref_265 =
    (__ref_267.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_267.localName !== 'foreignObject') ||
    __ref_267.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[265] = __ref_265;
  __ref_265.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_265.append(document.createTextNode('Before review'));
  __ref_267.append(__ref_265);
  const __ref_266 =
    (__ref_267.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_267.localName !== 'foreignObject') ||
    __ref_267.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[266] = __ref_266;
  __ref_266.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_266.append(document.createTextNode('Read only'));
  __ref_267.append(__ref_266);
  __ref_269.append(__ref_267);
  const __ref_268 =
    (__ref_269.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_269.localName !== 'foreignObject') ||
    __ref_269.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[268] = __ref_268;
  __ref_268.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_268.setAttribute('class', 'context-copy');
  __ref_268.append(
    document.createTextNode(
      '\n              Harngine redacts customer identifiers before model access and records every tool call.\n              Refund actions require operator approval.\n            ',
    ),
  );
  __ref_269.append(__ref_268);
  __ref_277.append(__ref_269);
  const __ref_276 =
    (__ref_277.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_277.localName !== 'foreignObject') ||
    __ref_277.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[276] = __ref_276;
  __ref_276.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_276.setAttribute('class', 'context-section');
  const __ref_272 =
    (__ref_276.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_276.localName !== 'foreignObject') ||
    __ref_276.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[272] = __ref_272;
  __ref_272.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_272.setAttribute('class', 'section-title');
  const __ref_270 =
    (__ref_272.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_272.localName !== 'foreignObject') ||
    __ref_272.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[270] = __ref_270;
  __ref_270.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_270.append(document.createTextNode('Policy'));
  __ref_272.append(__ref_270);
  const __ref_271 =
    (__ref_272.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_272.localName !== 'foreignObject') ||
    __ref_272.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[271] = __ref_271;
  __ref_271.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_271.append(document.createTextNode('Current'));
  __ref_272.append(__ref_271);
  __ref_276.append(__ref_272);
  const __ref_275 =
    (__ref_276.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_276.localName !== 'foreignObject') ||
    __ref_276.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[275] = __ref_275;
  __ref_275.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_275.setAttribute('class', 'policy-row');
  const __ref_273 =
    (__ref_275.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_275.localName !== 'foreignObject') ||
    __ref_275.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[273] = __ref_273;
  __ref_273.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_273.append(document.createTextNode('Duplicate charges'));
  __ref_275.append(__ref_273);
  const __ref_274 =
    (__ref_275.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_275.localName !== 'foreignObject') ||
    __ref_275.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'small')
      : document.createElement('small');
  refs[274] = __ref_274;
  __ref_274.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_274.append(document.createTextNode('Billing specialist approval required'));
  __ref_275.append(__ref_274);
  __ref_276.append(__ref_275);
  __ref_277.append(__ref_276);
  __ref_380.append(__ref_277);
  const __ref_332 =
    (__ref_380.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_380.localName !== 'foreignObject') ||
    __ref_380.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[332] = __ref_332;
  __ref_332.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_332.setAttribute('class', 'context-state');
  __ref_332.setAttribute('if', 'data && !completed');
  const __ref_295 =
    (__ref_332.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_332.localName !== 'foreignObject') ||
    __ref_332.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[295] = __ref_295;
  __ref_295.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_295.setAttribute('class', 'context-section request-summary');
  const __ref_280 =
    (__ref_295.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_295.localName !== 'foreignObject') ||
    __ref_295.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[280] = __ref_280;
  __ref_280.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_280.setAttribute('class', 'section-title');
  const __ref_278 =
    (__ref_280.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_280.localName !== 'foreignObject') ||
    __ref_280.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[278] = __ref_278;
  __ref_278.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_278.append(document.createTextNode('Request'));
  __ref_280.append(__ref_278);
  const __ref_279 =
    (__ref_280.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_280.localName !== 'foreignObject') ||
    __ref_280.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[279] = __ref_279;
  __ref_279.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_279.setAttribute('class', 'status-label pending');
  __ref_279.append(document.createTextNode('Needs approval'));
  __ref_280.append(__ref_279);
  __ref_295.append(__ref_280);
  const __ref_282 =
    (__ref_295.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_295.localName !== 'foreignObject') ||
    __ref_295.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[282] = __ref_282;
  __ref_282.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_281 = document.createTextNode('');
  refs[281] = __ref_281;
  __ref_282.append(__ref_281);
  __ref_295.append(__ref_282);
  const __ref_294 =
    (__ref_295.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_295.localName !== 'foreignObject') ||
    __ref_295.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dl')
      : document.createElement('dl');
  refs[294] = __ref_294;
  __ref_294.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_286 =
    (__ref_294.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_294.localName !== 'foreignObject') ||
    __ref_294.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[286] = __ref_286;
  __ref_286.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_283 =
    (__ref_286.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_286.localName !== 'foreignObject') ||
    __ref_286.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[283] = __ref_283;
  __ref_283.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_283.append(document.createTextNode('Order'));
  __ref_286.append(__ref_283);
  const __ref_285 =
    (__ref_286.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_286.localName !== 'foreignObject') ||
    __ref_286.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[285] = __ref_285;
  __ref_285.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_284 = document.createTextNode('');
  refs[284] = __ref_284;
  __ref_285.append(__ref_284);
  __ref_286.append(__ref_285);
  __ref_294.append(__ref_286);
  const __ref_290 =
    (__ref_294.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_294.localName !== 'foreignObject') ||
    __ref_294.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[290] = __ref_290;
  __ref_290.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_287 =
    (__ref_290.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_290.localName !== 'foreignObject') ||
    __ref_290.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[287] = __ref_287;
  __ref_287.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_287.append(document.createTextNode('Amount'));
  __ref_290.append(__ref_287);
  const __ref_289 =
    (__ref_290.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_290.localName !== 'foreignObject') ||
    __ref_290.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[289] = __ref_289;
  __ref_289.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_288 = document.createTextNode('');
  refs[288] = __ref_288;
  __ref_289.append(__ref_288);
  __ref_290.append(__ref_289);
  __ref_294.append(__ref_290);
  const __ref_293 =
    (__ref_294.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_294.localName !== 'foreignObject') ||
    __ref_294.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[293] = __ref_293;
  __ref_293.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_291 =
    (__ref_293.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_293.localName !== 'foreignObject') ||
    __ref_293.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[291] = __ref_291;
  __ref_291.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_291.append(document.createTextNode('Owner'));
  __ref_293.append(__ref_291);
  const __ref_292 =
    (__ref_293.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_293.localName !== 'foreignObject') ||
    __ref_293.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[292] = __ref_292;
  __ref_292.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_292.append(document.createTextNode('Billing Specialist'));
  __ref_293.append(__ref_292);
  __ref_294.append(__ref_293);
  __ref_295.append(__ref_294);
  __ref_332.append(__ref_295);
  const __ref_312 =
    (__ref_332.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_332.localName !== 'foreignObject') ||
    __ref_332.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[312] = __ref_312;
  __ref_312.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_312.setAttribute('class', 'approval-box');
  const __ref_298 =
    (__ref_312.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_312.localName !== 'foreignObject') ||
    __ref_312.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[298] = __ref_298;
  __ref_298.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_298.setAttribute('class', 'approval-title');
  const __ref_296 =
    (__ref_298.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_298.localName !== 'foreignObject') ||
    __ref_298.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[296] = __ref_296;
  __ref_296.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_296.append(document.createTextNode('Approval required'));
  __ref_298.append(__ref_296);
  const __ref_297 =
    (__ref_298.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_298.localName !== 'foreignObject') ||
    __ref_298.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[297] = __ref_297;
  __ref_297.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_297.setAttribute('class', 'warning-icon');
  __ref_297.append(document.createTextNode('!'));
  __ref_298.append(__ref_297);
  __ref_312.append(__ref_298);
  const __ref_300 =
    (__ref_312.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_312.localName !== 'foreignObject') ||
    __ref_312.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[300] = __ref_300;
  __ref_300.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_299 = document.createTextNode('');
  refs[299] = __ref_299;
  __ref_300.append(__ref_299);
  __ref_312.append(__ref_300);
  const __ref_305 =
    (__ref_312.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_312.localName !== 'foreignObject') ||
    __ref_312.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[305] = __ref_305;
  __ref_305.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_305.setAttribute('class', 'approval-value');
  const __ref_302 =
    (__ref_305.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_305.localName !== 'foreignObject') ||
    __ref_305.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[302] = __ref_302;
  __ref_302.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_301 = document.createTextNode('');
  refs[301] = __ref_301;
  __ref_302.append(__ref_301);
  __ref_305.append(__ref_302);
  const __ref_304 =
    (__ref_305.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_305.localName !== 'foreignObject') ||
    __ref_305.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'code')
      : document.createElement('code');
  refs[304] = __ref_304;
  __ref_304.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_303 = document.createTextNode('');
  refs[303] = __ref_303;
  __ref_304.append(__ref_303);
  __ref_305.append(__ref_304);
  __ref_312.append(__ref_305);
  const __ref_306 =
    (__ref_312.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_312.localName !== 'foreignObject') ||
    __ref_312.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[306] = __ref_306;
  __ref_306.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_306.append(
    document.createTextNode(
      'The refund Tool is paused. The payment provider has not received this request.',
    ),
  );
  __ref_312.append(__ref_306);
  const __ref_308 =
    (__ref_312.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_312.localName !== 'foreignObject') ||
    __ref_312.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[308] = __ref_308;
  __ref_308.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_308.setAttribute('class', 'approve-button');
  __ref_308.addEventListener('click', (event) => {
    const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[19](__weiv_context, event))(
      instance.refresh(),
    );
    return resolved;
  });
  const __ref_307 = document.createTextNode('');
  refs[307] = __ref_307;
  __ref_308.append(__ref_307);
  __ref_312.append(__ref_308);
  const __ref_311 =
    (__ref_312.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_312.localName !== 'foreignObject') ||
    __ref_312.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'small')
      : document.createElement('small');
  refs[311] = __ref_311;
  __ref_311.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_311.append(document.createTextNode('Approving runs '));
  const __ref_310 =
    (__ref_311.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_311.localName !== 'foreignObject') ||
    __ref_311.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'code')
      : document.createElement('code');
  refs[310] = __ref_310;
  __ref_310.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_309 = document.createTextNode('');
  refs[309] = __ref_309;
  __ref_310.append(__ref_309);
  __ref_311.append(__ref_310);
  __ref_311.append(document.createTextNode(' with the values above.'));
  __ref_312.append(__ref_311);
  __ref_332.append(__ref_312);
  const __ref_331 =
    (__ref_332.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_332.localName !== 'foreignObject') ||
    __ref_332.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[331] = __ref_331;
  __ref_331.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_331.setAttribute('class', 'context-section evidence-section');
  const __ref_316 =
    (__ref_331.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_331.localName !== 'foreignObject') ||
    __ref_331.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[316] = __ref_316;
  __ref_316.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_316.setAttribute('class', 'section-title');
  const __ref_313 =
    (__ref_316.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_316.localName !== 'foreignObject') ||
    __ref_316.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[313] = __ref_313;
  __ref_313.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_313.append(document.createTextNode('Runtime evidence'));
  __ref_316.append(__ref_313);
  const __ref_315 =
    (__ref_316.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_316.localName !== 'foreignObject') ||
    __ref_316.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[315] = __ref_315;
  __ref_315.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_314 = document.createTextNode('');
  refs[314] = __ref_314;
  __ref_315.append(__ref_314);
  __ref_315.append(document.createTextNode(' records'));
  __ref_316.append(__ref_315);
  __ref_331.append(__ref_316);
  const __ref_326 =
    (__ref_331.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_331.localName !== 'foreignObject') ||
    __ref_331.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[326] = __ref_326;
  __ref_326.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_326.setAttribute('class', 'evidence-list');
  const __ref_325 =
    (__ref_326.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_326.localName !== 'foreignObject') ||
    __ref_326.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[325] = __ref_325;
  __ref_325.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_325.setAttribute('for', 'item in data.investigation');
  const __ref_317 =
    (__ref_325.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_325.localName !== 'foreignObject') ||
    __ref_325.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[317] = __ref_317;
  __ref_317.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_317.setAttribute('class', 'evidence-state complete');
  __ref_317.append(document.createTextNode('✓'));
  __ref_325.append(__ref_317);
  const __ref_322 =
    (__ref_325.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_325.localName !== 'foreignObject') ||
    __ref_325.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[322] = __ref_322;
  __ref_322.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_319 =
    (__ref_322.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_322.localName !== 'foreignObject') ||
    __ref_322.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[319] = __ref_319;
  __ref_319.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_318 = document.createTextNode('');
  refs[318] = __ref_318;
  __ref_319.append(__ref_318);
  __ref_322.append(__ref_319);
  const __ref_321 =
    (__ref_322.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_322.localName !== 'foreignObject') ||
    __ref_322.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'code')
      : document.createElement('code');
  refs[321] = __ref_321;
  __ref_321.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_320 = document.createTextNode('');
  refs[320] = __ref_320;
  __ref_321.append(__ref_320);
  __ref_322.append(__ref_321);
  __ref_325.append(__ref_322);
  const __ref_324 =
    (__ref_325.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_325.localName !== 'foreignObject') ||
    __ref_325.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[324] = __ref_324;
  __ref_324.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_323 = document.createTextNode('');
  refs[323] = __ref_323;
  __ref_324.append(__ref_323);
  __ref_325.append(__ref_324);
  __ref_326.append(__ref_325);
  __ref_331.append(__ref_326);
  const __ref_330 =
    (__ref_331.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_331.localName !== 'foreignObject') ||
    __ref_331.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[330] = __ref_330;
  __ref_330.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_330.setAttribute('class', 'preview-note');
  const __ref_327 =
    (__ref_330.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_330.localName !== 'foreignObject') ||
    __ref_330.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[327] = __ref_327;
  __ref_327.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_327.append(document.createTextNode('Live model preview'));
  __ref_330.append(__ref_327);
  const __ref_329 =
    (__ref_330.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_330.localName !== 'foreignObject') ||
    __ref_330.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[329] = __ref_329;
  __ref_329.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_328 = document.createTextNode('');
  refs[328] = __ref_328;
  __ref_329.append(__ref_328);
  __ref_330.append(__ref_329);
  __ref_331.append(__ref_330);
  __ref_332.append(__ref_331);
  __ref_380.append(__ref_332);
  const __ref_379 =
    (__ref_380.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_380.localName !== 'foreignObject') ||
    __ref_380.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[379] = __ref_379;
  __ref_379.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_379.setAttribute('class', 'context-state');
  __ref_379.setAttribute('if', 'completed');
  const __ref_353 =
    (__ref_379.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_379.localName !== 'foreignObject') ||
    __ref_379.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[353] = __ref_353;
  __ref_353.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_353.setAttribute('class', 'context-section resolved-summary');
  const __ref_335 =
    (__ref_353.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_353.localName !== 'foreignObject') ||
    __ref_353.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[335] = __ref_335;
  __ref_335.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_335.setAttribute('class', 'section-title');
  const __ref_333 =
    (__ref_335.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_335.localName !== 'foreignObject') ||
    __ref_335.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[333] = __ref_333;
  __ref_333.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_333.append(document.createTextNode('Resolution'));
  __ref_335.append(__ref_333);
  const __ref_334 =
    (__ref_335.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_335.localName !== 'foreignObject') ||
    __ref_335.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[334] = __ref_334;
  __ref_334.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_334.setAttribute('class', 'status-label complete');
  __ref_334.append(document.createTextNode('Complete'));
  __ref_335.append(__ref_334);
  __ref_353.append(__ref_335);
  const __ref_337 =
    (__ref_353.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_353.localName !== 'foreignObject') ||
    __ref_353.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[337] = __ref_337;
  __ref_337.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_337.setAttribute('class', 'resolution-amount');
  const __ref_336 = document.createTextNode('');
  refs[336] = __ref_336;
  __ref_337.append(__ref_336);
  __ref_353.append(__ref_337);
  const __ref_349 =
    (__ref_353.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_353.localName !== 'foreignObject') ||
    __ref_353.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dl')
      : document.createElement('dl');
  refs[349] = __ref_349;
  __ref_349.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_341 =
    (__ref_349.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_349.localName !== 'foreignObject') ||
    __ref_349.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[341] = __ref_341;
  __ref_341.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_338 =
    (__ref_341.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_341.localName !== 'foreignObject') ||
    __ref_341.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[338] = __ref_338;
  __ref_338.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_338.append(document.createTextNode('Order'));
  __ref_341.append(__ref_338);
  const __ref_340 =
    (__ref_341.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_341.localName !== 'foreignObject') ||
    __ref_341.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[340] = __ref_340;
  __ref_340.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_339 = document.createTextNode('');
  refs[339] = __ref_339;
  __ref_340.append(__ref_339);
  __ref_341.append(__ref_340);
  __ref_349.append(__ref_341);
  const __ref_345 =
    (__ref_349.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_349.localName !== 'foreignObject') ||
    __ref_349.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[345] = __ref_345;
  __ref_345.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_342 =
    (__ref_345.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_345.localName !== 'foreignObject') ||
    __ref_345.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[342] = __ref_342;
  __ref_342.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_342.append(document.createTextNode('Refund ID'));
  __ref_345.append(__ref_342);
  const __ref_344 =
    (__ref_345.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_345.localName !== 'foreignObject') ||
    __ref_345.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[344] = __ref_344;
  __ref_344.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_343 = document.createTextNode('');
  refs[343] = __ref_343;
  __ref_344.append(__ref_343);
  __ref_345.append(__ref_344);
  __ref_349.append(__ref_345);
  const __ref_348 =
    (__ref_349.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_349.localName !== 'foreignObject') ||
    __ref_349.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[348] = __ref_348;
  __ref_348.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_346 =
    (__ref_348.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_348.localName !== 'foreignObject') ||
    __ref_348.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dt')
      : document.createElement('dt');
  refs[346] = __ref_346;
  __ref_346.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_346.append(document.createTextNode('Approved by'));
  __ref_348.append(__ref_346);
  const __ref_347 =
    (__ref_348.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_348.localName !== 'foreignObject') ||
    __ref_348.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'dd')
      : document.createElement('dd');
  refs[347] = __ref_347;
  __ref_347.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_347.append(document.createTextNode('Jamie Dale'));
  __ref_348.append(__ref_347);
  __ref_349.append(__ref_348);
  __ref_353.append(__ref_349);
  const __ref_351 =
    (__ref_353.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_353.localName !== 'foreignObject') ||
    __ref_353.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[351] = __ref_351;
  __ref_351.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_351.setAttribute('class', 'approval-proof');
  const __ref_350 =
    (__ref_351.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_351.localName !== 'foreignObject') ||
    __ref_351.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[350] = __ref_350;
  __ref_350.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_350.append(document.createTextNode('✓'));
  __ref_351.append(__ref_350);
  __ref_351.append(document.createTextNode(' Refund ran only after approval'));
  __ref_353.append(__ref_351);
  const __ref_352 =
    (__ref_353.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_353.localName !== 'foreignObject') ||
    __ref_353.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'button')
      : document.createElement('button');
  refs[352] = __ref_352;
  __ref_352.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_352.setAttribute('class', 'secondary-button');
  __ref_352.addEventListener('click', (event) => {
    const resolved = ((__weiv_context) => __weiv_context.__weiv_eval[30](__weiv_context, event))(
      instance.refresh(),
    );
    return resolved;
  });
  __ref_352.append(document.createTextNode('Run another case'));
  __ref_353.append(__ref_352);
  __ref_379.append(__ref_353);
  const __ref_368 =
    (__ref_379.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_379.localName !== 'foreignObject') ||
    __ref_379.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[368] = __ref_368;
  __ref_368.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_368.setAttribute('class', 'context-section evidence-section');
  const __ref_357 =
    (__ref_368.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_368.localName !== 'foreignObject') ||
    __ref_368.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[357] = __ref_357;
  __ref_357.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_357.setAttribute('class', 'section-title');
  const __ref_354 =
    (__ref_357.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_357.localName !== 'foreignObject') ||
    __ref_357.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[354] = __ref_354;
  __ref_354.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_354.append(document.createTextNode('Tool calls'));
  __ref_357.append(__ref_354);
  const __ref_356 =
    (__ref_357.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_357.localName !== 'foreignObject') ||
    __ref_357.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[356] = __ref_356;
  __ref_356.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_355 = document.createTextNode('');
  refs[355] = __ref_355;
  __ref_356.append(__ref_355);
  __ref_356.append(document.createTextNode(' records'));
  __ref_357.append(__ref_356);
  __ref_368.append(__ref_357);
  const __ref_367 =
    (__ref_368.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_368.localName !== 'foreignObject') ||
    __ref_368.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[367] = __ref_367;
  __ref_367.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_367.setAttribute('class', 'evidence-list');
  const __ref_366 =
    (__ref_367.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_367.localName !== 'foreignObject') ||
    __ref_367.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[366] = __ref_366;
  __ref_366.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_366.setAttribute('for', 'item in completed.evidence');
  const __ref_358 =
    (__ref_366.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_366.localName !== 'foreignObject') ||
    __ref_366.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[358] = __ref_358;
  __ref_358.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_358.setAttribute('class', 'evidence-state complete');
  __ref_358.append(document.createTextNode('✓'));
  __ref_366.append(__ref_358);
  const __ref_363 =
    (__ref_366.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_366.localName !== 'foreignObject') ||
    __ref_366.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[363] = __ref_363;
  __ref_363.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_360 =
    (__ref_363.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_363.localName !== 'foreignObject') ||
    __ref_363.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'b')
      : document.createElement('b');
  refs[360] = __ref_360;
  __ref_360.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_359 = document.createTextNode('');
  refs[359] = __ref_359;
  __ref_360.append(__ref_359);
  __ref_363.append(__ref_360);
  const __ref_362 =
    (__ref_363.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_363.localName !== 'foreignObject') ||
    __ref_363.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'code')
      : document.createElement('code');
  refs[362] = __ref_362;
  __ref_362.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_361 = document.createTextNode('');
  refs[361] = __ref_361;
  __ref_362.append(__ref_361);
  __ref_363.append(__ref_362);
  __ref_366.append(__ref_363);
  const __ref_365 =
    (__ref_366.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_366.localName !== 'foreignObject') ||
    __ref_366.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[365] = __ref_365;
  __ref_365.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_364 = document.createTextNode('');
  refs[364] = __ref_364;
  __ref_365.append(__ref_364);
  __ref_366.append(__ref_365);
  __ref_367.append(__ref_366);
  __ref_368.append(__ref_367);
  __ref_379.append(__ref_368);
  const __ref_378 =
    (__ref_379.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_379.localName !== 'foreignObject') ||
    __ref_379.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'section')
      : document.createElement('section');
  refs[378] = __ref_378;
  __ref_378.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_378.setAttribute('class', 'context-section audit-summary');
  const __ref_372 =
    (__ref_378.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_378.localName !== 'foreignObject') ||
    __ref_378.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[372] = __ref_372;
  __ref_372.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_372.setAttribute('class', 'section-title');
  const __ref_369 =
    (__ref_372.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_372.localName !== 'foreignObject') ||
    __ref_372.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'h3')
      : document.createElement('h3');
  refs[369] = __ref_369;
  __ref_369.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_369.append(document.createTextNode('Audit trail'));
  __ref_372.append(__ref_369);
  const __ref_371 =
    (__ref_372.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_372.localName !== 'foreignObject') ||
    __ref_372.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[371] = __ref_371;
  __ref_371.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_370 = document.createTextNode('');
  refs[370] = __ref_370;
  __ref_371.append(__ref_370);
  __ref_371.append(document.createTextNode(' categories'));
  __ref_372.append(__ref_371);
  __ref_378.append(__ref_372);
  const __ref_374 =
    (__ref_378.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_378.localName !== 'foreignObject') ||
    __ref_378.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'p')
      : document.createElement('p');
  refs[374] = __ref_374;
  __ref_374.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  const __ref_373 = document.createTextNode('');
  refs[373] = __ref_373;
  __ref_374.append(__ref_373);
  __ref_374.append(
    document.createTextNode(' events retained for inspection and OpenTelemetry export.'),
  );
  __ref_378.append(__ref_374);
  const __ref_377 =
    (__ref_378.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_378.localName !== 'foreignObject') ||
    __ref_378.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'div')
      : document.createElement('div');
  refs[377] = __ref_377;
  __ref_377.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_377.setAttribute('class', 'audit-tags');
  const __ref_376 =
    (__ref_377.namespaceURI === 'http://www.w3.org/2000/svg' &&
      __ref_377.localName !== 'foreignObject') ||
    __ref_377.__weiv_namespace === 'http://www.w3.org/2000/svg'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'span')
      : document.createElement('span');
  refs[376] = __ref_376;
  __ref_376.setAttribute('data-weiv-scope', 'wAFE7F4C66F8956DA');
  __ref_376.setAttribute('for', 'category in completed.audit.categories');
  const __ref_375 = document.createTextNode('');
  refs[375] = __ref_375;
  __ref_376.append(__ref_375);
  __ref_377.append(__ref_376);
  __ref_378.append(__ref_377);
  __ref_379.append(__ref_378);
  __ref_380.append(__ref_379);
  __ref_381.append(__ref_380);
  __ref_382.append(__ref_381);
  fragment.append(__ref_382);
  return fragment;
}

function updateRegion_text_121(instance, scope, refs) {
  const __next_text_121 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[0](__weiv_context))(scope) ?? '',
  );
  if (refs[121].data !== __next_text_121) {
    refs[121].data = __next_text_121;
  }
}
function updateRegion_attribute_150_disabled(instance, scope, refs) {
  const __value_150_disabled = ((__weiv_context) => __weiv_context.__weiv_eval[1](__weiv_context))(
    scope,
  );
  const __next_150_disabled = Boolean(__value_150_disabled);
  if (refs[150].disabled !== __next_150_disabled) {
    refs[150].disabled = __next_150_disabled;
  }
  const __has_attr_150_disabled = refs[150].hasAttribute('disabled');
  if (__next_150_disabled) {
    if (!__has_attr_150_disabled) {
      refs[150].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_150_disabled) {
      refs[150].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_149(instance, scope, refs) {
  const __next_text_149 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[3](__weiv_context))(scope) ?? '',
  );
  if (refs[149].data !== __next_text_149) {
    refs[149].data = __next_text_149;
  }
}
function updateRegion_text_164(instance, scope, refs) {
  const __next_text_164 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[4](__weiv_context))(scope) ?? '',
  );
  if (refs[164].data !== __next_text_164) {
    refs[164].data = __next_text_164;
  }
}
function updateRegion_text_201(instance, scope, refs) {
  const __next_text_201 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[5](__weiv_context))(scope) ?? '',
  );
  if (refs[201].data !== __next_text_201) {
    refs[201].data = __next_text_201;
  }
}
function updateRegion_text_210(instance, scope, refs) {
  const __next_text_210 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[6](__weiv_context))(scope) ?? '',
  );
  if (refs[210].data !== __next_text_210) {
    refs[210].data = __next_text_210;
  }
}
function updateRegion_text_213(instance, scope, refs) {
  const __next_text_213 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[7](__weiv_context))(scope) ?? '',
  );
  if (refs[213].data !== __next_text_213) {
    refs[213].data = __next_text_213;
  }
}
function updateRegion_text_217(instance, scope, refs) {
  const __next_text_217 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[8](__weiv_context))(scope) ?? '',
  );
  if (refs[217].data !== __next_text_217) {
    refs[217].data = __next_text_217;
  }
}
function updateRegion_text_221(instance, scope, refs) {
  const __next_text_221 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[9](__weiv_context))(scope) ?? '',
  );
  if (refs[221].data !== __next_text_221) {
    refs[221].data = __next_text_221;
  }
}
function updateRegion_text_228(instance, scope, refs) {
  const __next_text_228 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[10](__weiv_context))(scope) ?? '',
  );
  if (refs[228].data !== __next_text_228) {
    refs[228].data = __next_text_228;
  }
}
function updateRegion_text_231(instance, scope, refs) {
  const __next_text_231 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[11](__weiv_context))(scope) ?? '',
  );
  if (refs[231].data !== __next_text_231) {
    refs[231].data = __next_text_231;
  }
}
function updateRegion_text_281(instance, scope, refs) {
  const __next_text_281 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[12](__weiv_context))(scope) ?? '',
  );
  if (refs[281].data !== __next_text_281) {
    refs[281].data = __next_text_281;
  }
}
function updateRegion_text_284(instance, scope, refs) {
  const __next_text_284 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[13](__weiv_context))(scope) ?? '',
  );
  if (refs[284].data !== __next_text_284) {
    refs[284].data = __next_text_284;
  }
}
function updateRegion_text_288(instance, scope, refs) {
  const __next_text_288 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[14](__weiv_context))(scope) ?? '',
  );
  if (refs[288].data !== __next_text_288) {
    refs[288].data = __next_text_288;
  }
}
function updateRegion_text_299(instance, scope, refs) {
  const __next_text_299 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[15](__weiv_context))(scope) ?? '',
  );
  if (refs[299].data !== __next_text_299) {
    refs[299].data = __next_text_299;
  }
}
function updateRegion_text_301(instance, scope, refs) {
  const __next_text_301 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[16](__weiv_context))(scope) ?? '',
  );
  if (refs[301].data !== __next_text_301) {
    refs[301].data = __next_text_301;
  }
}
function updateRegion_text_303(instance, scope, refs) {
  const __next_text_303 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[17](__weiv_context))(scope) ?? '',
  );
  if (refs[303].data !== __next_text_303) {
    refs[303].data = __next_text_303;
  }
}
function updateRegion_attribute_308_disabled(instance, scope, refs) {
  const __value_308_disabled = ((__weiv_context) => __weiv_context.__weiv_eval[18](__weiv_context))(
    scope,
  );
  const __next_308_disabled = Boolean(__value_308_disabled);
  if (refs[308].disabled !== __next_308_disabled) {
    refs[308].disabled = __next_308_disabled;
  }
  const __has_attr_308_disabled = refs[308].hasAttribute('disabled');
  if (__next_308_disabled) {
    if (!__has_attr_308_disabled) {
      refs[308].setAttribute('disabled', '');
    }
  } else {
    if (__has_attr_308_disabled) {
      refs[308].removeAttribute('disabled');
    }
  }
}
function updateRegion_text_307(instance, scope, refs) {
  const __next_text_307 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[20](__weiv_context))(scope) ?? '',
  );
  if (refs[307].data !== __next_text_307) {
    refs[307].data = __next_text_307;
  }
}
function updateRegion_text_309(instance, scope, refs) {
  const __next_text_309 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[21](__weiv_context))(scope) ?? '',
  );
  if (refs[309].data !== __next_text_309) {
    refs[309].data = __next_text_309;
  }
}
function updateRegion_text_314(instance, scope, refs) {
  const __next_text_314 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[22](__weiv_context))(scope) ?? '',
  );
  if (refs[314].data !== __next_text_314) {
    refs[314].data = __next_text_314;
  }
}
function updateRegion_text_318(instance, scope, refs) {
  const __next_text_318 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[23](__weiv_context))(scope) ?? '',
  );
  if (refs[318].data !== __next_text_318) {
    refs[318].data = __next_text_318;
  }
}
function updateRegion_text_320(instance, scope, refs) {
  const __next_text_320 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[24](__weiv_context))(scope) ?? '',
  );
  if (refs[320].data !== __next_text_320) {
    refs[320].data = __next_text_320;
  }
}
function updateRegion_text_323(instance, scope, refs) {
  const __next_text_323 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[25](__weiv_context))(scope) ?? '',
  );
  if (refs[323].data !== __next_text_323) {
    refs[323].data = __next_text_323;
  }
}
function updateRegion_text_328(instance, scope, refs) {
  const __next_text_328 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[26](__weiv_context))(scope) ?? '',
  );
  if (refs[328].data !== __next_text_328) {
    refs[328].data = __next_text_328;
  }
}
function updateRegion_text_336(instance, scope, refs) {
  const __next_text_336 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[27](__weiv_context))(scope) ?? '',
  );
  if (refs[336].data !== __next_text_336) {
    refs[336].data = __next_text_336;
  }
}
function updateRegion_text_339(instance, scope, refs) {
  const __next_text_339 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[28](__weiv_context))(scope) ?? '',
  );
  if (refs[339].data !== __next_text_339) {
    refs[339].data = __next_text_339;
  }
}
function updateRegion_text_343(instance, scope, refs) {
  const __next_text_343 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[29](__weiv_context))(scope) ?? '',
  );
  if (refs[343].data !== __next_text_343) {
    refs[343].data = __next_text_343;
  }
}
function updateRegion_text_355(instance, scope, refs) {
  const __next_text_355 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[31](__weiv_context))(scope) ?? '',
  );
  if (refs[355].data !== __next_text_355) {
    refs[355].data = __next_text_355;
  }
}
function updateRegion_text_359(instance, scope, refs) {
  const __next_text_359 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[32](__weiv_context))(scope) ?? '',
  );
  if (refs[359].data !== __next_text_359) {
    refs[359].data = __next_text_359;
  }
}
function updateRegion_text_361(instance, scope, refs) {
  const __next_text_361 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[33](__weiv_context))(scope) ?? '',
  );
  if (refs[361].data !== __next_text_361) {
    refs[361].data = __next_text_361;
  }
}
function updateRegion_text_364(instance, scope, refs) {
  const __next_text_364 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[34](__weiv_context))(scope) ?? '',
  );
  if (refs[364].data !== __next_text_364) {
    refs[364].data = __next_text_364;
  }
}
function updateRegion_text_370(instance, scope, refs) {
  const __next_text_370 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[35](__weiv_context))(scope) ?? '',
  );
  if (refs[370].data !== __next_text_370) {
    refs[370].data = __next_text_370;
  }
}
function updateRegion_text_373(instance, scope, refs) {
  const __next_text_373 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[36](__weiv_context))(scope) ?? '',
  );
  if (refs[373].data !== __next_text_373) {
    refs[373].data = __next_text_373;
  }
}
function updateRegion_text_375(instance, scope, refs) {
  const __next_text_375 = String(
    ((__weiv_context) => __weiv_context.__weiv_eval[37](__weiv_context))(scope) ?? '',
  );
  if (refs[375].data !== __next_text_375) {
    refs[375].data = __next_text_375;
  }
}

function updateDom(instance) {
  const refs = instance.refs;
  const scope = instance.refresh();
  updateRegion_text_121(instance, scope, refs);
  updateRegion_attribute_150_disabled(instance, scope, refs);
  updateRegion_text_149(instance, scope, refs);
  updateRegion_text_164(instance, scope, refs);
  updateRegion_text_201(instance, scope, refs);
  updateRegion_text_210(instance, scope, refs);
  updateRegion_text_213(instance, scope, refs);
  updateRegion_text_217(instance, scope, refs);
  updateRegion_text_221(instance, scope, refs);
  updateRegion_text_228(instance, scope, refs);
  updateRegion_text_231(instance, scope, refs);
  updateRegion_text_281(instance, scope, refs);
  updateRegion_text_284(instance, scope, refs);
  updateRegion_text_288(instance, scope, refs);
  updateRegion_text_299(instance, scope, refs);
  updateRegion_text_301(instance, scope, refs);
  updateRegion_text_303(instance, scope, refs);
  updateRegion_attribute_308_disabled(instance, scope, refs);
  updateRegion_text_307(instance, scope, refs);
  updateRegion_text_309(instance, scope, refs);
  updateRegion_text_314(instance, scope, refs);
  updateRegion_text_318(instance, scope, refs);
  updateRegion_text_320(instance, scope, refs);
  updateRegion_text_323(instance, scope, refs);
  updateRegion_text_328(instance, scope, refs);
  updateRegion_text_336(instance, scope, refs);
  updateRegion_text_339(instance, scope, refs);
  updateRegion_text_343(instance, scope, refs);
  updateRegion_text_355(instance, scope, refs);
  updateRegion_text_359(instance, scope, refs);
  updateRegion_text_361(instance, scope, refs);
  updateRegion_text_364(instance, scope, refs);
  updateRegion_text_370(instance, scope, refs);
  updateRegion_text_373(instance, scope, refs);
  updateRegion_text_375(instance, scope, refs);
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
  if (dirtySet.has('completed') || dirtyRegionSet.has(1)) {
    updateRegion_text_121(instance, scope, refs);
  }
  if (dirtySet.has('busy') || dirtyRegionSet.has(2)) {
    updateRegion_attribute_150_disabled(instance, scope, refs);
  }
  if (dirtySet.has('busy') || dirtyRegionSet.has(3)) {
    updateRegion_text_149(instance, scope, refs);
  }
  if (dirtySet.has('citationSource') || dirtySet.has('data') || dirtyRegionSet.has(4)) {
    updateRegion_text_164(instance, scope, refs);
  }
  if (dirtySet.has('handoffLabel') || dirtySet.has('completed') || dirtyRegionSet.has(5)) {
    updateRegion_text_201(instance, scope, refs);
  }
  if (dirtySet.has('completed') || dirtyRegionSet.has(6)) {
    updateRegion_text_210(instance, scope, refs);
  }
  if (dirtySet.has('money') || dirtySet.has('completed') || dirtyRegionSet.has(7)) {
    updateRegion_text_213(instance, scope, refs);
  }
  if (dirtySet.has('completed') || dirtyRegionSet.has(8)) {
    updateRegion_text_217(instance, scope, refs);
  }
  if (dirtySet.has('completed') || dirtyRegionSet.has(9)) {
    updateRegion_text_221(instance, scope, refs);
  }
  if (dirtySet.has('errorMessage') || dirtyRegionSet.has(10)) {
    updateRegion_text_228(instance, scope, refs);
  }
  if (dirtySet.has('completed') || dirtyRegionSet.has(11)) {
    updateRegion_text_231(instance, scope, refs);
  }
  if (dirtySet.has('data') || dirtyRegionSet.has(12)) {
    updateRegion_text_281(instance, scope, refs);
  }
  if (dirtySet.has('data') || dirtyRegionSet.has(13)) {
    updateRegion_text_284(instance, scope, refs);
  }
  if (dirtySet.has('money') || dirtySet.has('data') || dirtyRegionSet.has(14)) {
    updateRegion_text_288(instance, scope, refs);
  }
  if (dirtySet.has('approvalTitle') || dirtySet.has('data') || dirtyRegionSet.has(15)) {
    updateRegion_text_299(instance, scope, refs);
  }
  if (dirtySet.has('money') || dirtySet.has('data') || dirtyRegionSet.has(16)) {
    updateRegion_text_301(instance, scope, refs);
  }
  if (dirtySet.has('data') || dirtyRegionSet.has(17)) {
    updateRegion_text_303(instance, scope, refs);
  }
  if (dirtySet.has('busy') || dirtyRegionSet.has(18)) {
    updateRegion_attribute_308_disabled(instance, scope, refs);
  }
  if (dirtySet.has('busy') || dirtyRegionSet.has(19)) {
    updateRegion_text_307(instance, scope, refs);
  }
  if (dirtySet.has('data') || dirtyRegionSet.has(20)) {
    updateRegion_text_309(instance, scope, refs);
  }
  if (
    dirtySet.has('evidenceCount') ||
    dirtySet.has('completed') ||
    dirtySet.has('data') ||
    dirtyRegionSet.has(21)
  ) {
    updateRegion_text_314(instance, scope, refs);
  }
  if (dirtySet.has('evidenceLabel') || dirtyRegionSet.has(22)) {
    updateRegion_text_318(instance, scope, refs);
  }
  if (dirtyRegionSet.has(23)) {
    updateRegion_text_320(instance, scope, refs);
  }
  if (dirtySet.has('phaseLabel') || dirtyRegionSet.has(24)) {
    updateRegion_text_323(instance, scope, refs);
  }
  if (dirtySet.has('previewText') || dirtySet.has('data') || dirtyRegionSet.has(25)) {
    updateRegion_text_328(instance, scope, refs);
  }
  if (dirtySet.has('money') || dirtySet.has('completed') || dirtyRegionSet.has(26)) {
    updateRegion_text_336(instance, scope, refs);
  }
  if (dirtySet.has('completed') || dirtyRegionSet.has(27)) {
    updateRegion_text_339(instance, scope, refs);
  }
  if (dirtySet.has('completed') || dirtyRegionSet.has(28)) {
    updateRegion_text_343(instance, scope, refs);
  }
  if (
    dirtySet.has('evidenceCount') ||
    dirtySet.has('completed') ||
    dirtySet.has('data') ||
    dirtyRegionSet.has(29)
  ) {
    updateRegion_text_355(instance, scope, refs);
  }
  if (dirtySet.has('evidenceLabel') || dirtyRegionSet.has(30)) {
    updateRegion_text_359(instance, scope, refs);
  }
  if (dirtyRegionSet.has(31)) {
    updateRegion_text_361(instance, scope, refs);
  }
  if (dirtySet.has('phaseLabel') || dirtyRegionSet.has(32)) {
    updateRegion_text_364(instance, scope, refs);
  }
  if (dirtySet.has('categoryCount') || dirtySet.has('completed') || dirtyRegionSet.has(33)) {
    updateRegion_text_370(instance, scope, refs);
  }
  if (dirtySet.has('completed') || dirtyRegionSet.has(34)) {
    updateRegion_text_373(instance, scope, refs);
  }
  if (dirtyRegionSet.has(35)) {
    updateRegion_text_375(instance, scope, refs);
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
    setSlots: (nextSlots = {}) => {
      instance.slots = nextSlots;
    },
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
  instance.setSlots = (nextSlots = {}) => {
    instance.slots = nextSlots;
  };
  const fragment = createDom(instance);
  replaceBetween(start, end, fragment);
  instance.update = () => updateDom(instance);
  instance.updateDirty = (dirtyBindings, scope) =>
    updateDirtyRegions(instance, dirtyBindings, scope);
  const __weiv_unsubscribeImportedObservables =
    typeof instance.subscribeImportedObservables === 'function'
      ? instance.subscribeImportedObservables(instance)
      : null;
  instance.destroy = () => {
    if (typeof __weiv_unsubscribeImportedObservables === 'function')
      __weiv_unsubscribeImportedObservables();
    instance.destroyed = true;
    destroyDom(instance);
    replaceBetween(start, end, document.createDocumentFragment());
  };
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
  const start = document.createComment('root:start');
  const end = document.createComment('root:end');
  target.replaceChildren(start, end);
  return mountIntoBoundary(start, end, props, eventHandlers, slots);
}
