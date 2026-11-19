import { observable } from "./observable.js";
function parsePattern(pattern) {
  return pattern.split("/").filter(Boolean).map((seg) => {
    if (seg === "*")
      return { type: "wildcard" };
    if (seg.startsWith(":"))
      return { type: "param", name: seg.slice(1) };
    return { type: "static", value: seg };
  });
}
function compileRoutes(defs, parentPath = "") {
  return defs.map((def) => {
    const fullPath = parentPath + def.path;
    return {
      definition: def,
      segments: parsePattern(fullPath),
      children: def.children ? compileRoutes(def.children, fullPath) : [],
      fullPath
    };
  });
}
function matchSegments(segments, pathParts, startIndex) {
  const params = {};
  let pi = startIndex;
  for (let si = 0;si < segments.length; si++) {
    const seg = segments[si];
    if (seg.type === "wildcard") {
      params["*"] = pathParts.slice(pi).join("/");
      return { params, consumed: pathParts.length - startIndex };
    }
    if (pi >= pathParts.length)
      return null;
    if (seg.type === "static") {
      if (pathParts[pi] !== seg.value)
        return null;
    } else {
      params[seg.name] = decodeURIComponent(pathParts[pi]);
    }
    pi++;
  }
  return { params, consumed: pi - startIndex };
}
function matchRoute(compiled, pathParts) {
  for (const entry of compiled) {
    const result = matchSegments(entry.segments, pathParts, 0);
    if (result === null)
      continue;
    if (entry.children.length > 0) {
      const childMatch = matchChildRoutes(entry.children, pathParts, result.consumed);
      if (childMatch) {
        return {
          chain: [entry, ...childMatch.chain],
          params: { ...result.params, ...childMatch.params }
        };
      }
    }
    if (result.consumed === pathParts.length) {
      return { chain: [entry], params: result.params };
    }
  }
  return null;
}
function matchChildRoutes(children, pathParts, parentConsumed) {
  const remaining = pathParts.slice(parentConsumed);
  for (const child of children) {
    const childSegments = parsePattern(child.definition.path);
    const result = matchSegments(childSegments, remaining, 0);
    if (result === null)
      continue;
    const totalConsumed = parentConsumed + result.consumed;
    if (child.children.length > 0) {
      const grandchildMatch = matchChildRoutes(child.children, pathParts, totalConsumed);
      if (grandchildMatch) {
        return {
          chain: [child, ...grandchildMatch.chain],
          params: { ...result.params, ...grandchildMatch.params }
        };
      }
    }
    if (totalConsumed === pathParts.length) {
      return { chain: [child], params: result.params };
    }
  }
  return null;
}
function parseQuery(search) {
  const params = {};
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw)
    return params;
  for (const pair of raw.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      params[decodeURIComponent(pair)] = "";
    } else {
      params[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return params;
}
function getPath(mode, base) {
  if (mode === "hash") {
    const hash = window.location.hash.slice(1) || "/";
    return hash;
  }
  let path = window.location.pathname;
  if (base && path.startsWith(base)) {
    path = path.slice(base.length) || "/";
  }
  return path;
}
function getSearch(mode) {
  if (mode === "hash") {
    const hash = window.location.hash.slice(1) || "/";
    const qi = hash.indexOf("?");
    return qi === -1 ? "" : hash.slice(qi);
  }
  return window.location.search;
}
function getPathOnly(fullPath) {
  const qi = fullPath.indexOf("?");
  return qi === -1 ? fullPath : fullPath.slice(0, qi);
}
function snapshotRoute(route) {
  return {
    path: route.path,
    params: { ...route.params },
    query: { ...route.query },
    matched: route.matched
  };
}
export function createRouter(options) {
  const { mode = "history", base = "", routes, target, scrollBehavior } = options;
  const compiled = compileRoutes(routes);
  const route = observable({
    path: "/",
    params: {},
    query: {},
    matched: null
  });
  const beforeEachGuards = [];
  const afterEachHooks = [];
  let currentChain = [];
  let outlets = [];
  let destroyed = false;
  const scrollPositions = new Map;
  let historyKeyCounter = 0;
  let currentHistoryKey = String(historyKeyCounter);
  function createOutlet(parent) {
    const s = document.createComment("outlet:start");
    const e = document.createComment("outlet:end");
    parent.appendChild(s);
    parent.appendChild(e);
    return { mount: null, pattern: null, start: s, end: e, parent };
  }
  function ensureOutlet(depth) {
    if (depth === 0) {
      if (!outlets[0]) {
        outlets[0] = createOutlet(target);
      }
      return outlets[0];
    }
    const parentOutlet = outlets[depth - 1];
    if (!parentOutlet?.mount) {
      throw new Error(`No parent mount at depth ${depth - 1} for nested route`);
    }
    if (!outlets[depth]) {
      const parentEl = parentOutlet.start.parentNode;
      if (!parentEl)
        throw new Error("Parent outlet detached");
      outlets[depth] = createOutlet(parentEl);
    }
    return outlets[depth];
  }
  function resolve(path) {
    const parts = path.split("/").filter(Boolean);
    return matchRoute(compiled, parts);
  }
  async function runGuards(from, to, chain) {
    const ctx = { from, to };
    for (const def of currentChain) {
      if (def.definition.beforeLeave) {
        const result = await def.definition.beforeLeave(ctx);
        if (result === false)
          return false;
        if (typeof result === "string")
          return result;
      }
    }
    for (const guard of beforeEachGuards) {
      const result = await guard(ctx);
      if (result === false)
        return false;
      if (typeof result === "string")
        return result;
    }
    for (const entry of chain) {
      if (entry.definition.beforeEnter) {
        const result = await entry.definition.beforeEnter(ctx);
        if (result === false)
          return false;
        if (typeof result === "string")
          return result;
      }
    }
    return;
  }
  function saveScrollPosition() {
    if (!scrollBehavior)
      return;
    scrollPositions.set(currentHistoryKey, {
      x: window.scrollX ?? window.pageXOffset ?? 0,
      y: window.scrollY ?? window.pageYOffset ?? 0
    });
  }
  function applyScroll(from, to, savedKey) {
    if (!scrollBehavior)
      return;
    const saved = savedKey ? scrollPositions.get(savedKey) ?? null : null;
    const result = scrollBehavior({ from, to }, saved);
    if (!result)
      return;
    if (result.el) {
      const el = document.querySelector(result.el);
      if (el) {
        el.scrollIntoView({ behavior: "auto" });
        return;
      }
    }
    window.scrollTo(result.x ?? 0, result.y ?? 0);
  }
  async function navigateTo(pathOnly, search, options) {
    if (destroyed)
      return;
    const result = resolve(pathOnly);
    const pendingTo = {
      path: pathOnly,
      params: result ? result.params : {},
      query: parseQuery(search),
      matched: result ? result.chain[result.chain.length - 1].fullPath : null
    };
    const fromSnapshot = snapshotRoute(route);
    const chain = result?.chain ?? [];
    const guardResult = await runGuards(fromSnapshot, pendingTo, chain);
    if (guardResult === false) {
      if (options?.isPopState) {
        window.history.pushState({ __weiv_key: currentHistoryKey }, "", base + fromSnapshot.path);
      }
      return;
    }
    if (typeof guardResult === "string") {
      await push(guardResult);
      return;
    }
    if (scrollBehavior) {
      saveScrollPosition();
    }
    route.path = pendingTo.path;
    route.params = pendingTo.params;
    route.query = pendingTo.query;
    route.matched = pendingTo.matched;
    if (!result) {
      for (let i = outlets.length - 1;i >= 0; i--) {
        if (outlets[i]?.mount) {
          outlets[i].mount.destroy();
          outlets[i].mount = null;
          outlets[i].pattern = null;
        }
      }
      currentChain = [];
      return;
    }
    const newChain = result.chain;
    let reuseDepth = 0;
    while (reuseDepth < currentChain.length && reuseDepth < newChain.length && currentChain[reuseDepth].fullPath === newChain[reuseDepth].fullPath) {
      reuseDepth++;
    }
    for (let i = outlets.length - 1;i >= reuseDepth; i--) {
      if (outlets[i]?.mount) {
        outlets[i].mount.destroy();
        outlets[i].mount = null;
        outlets[i].pattern = null;
      }
    }
    outlets.length = Math.max(reuseDepth, newChain.length);
    for (let depth = 0;depth < newChain.length; depth++) {
      const entry = newChain[depth];
      const def = entry.definition;
      const props = def.props ? def.props(route) : {};
      const outlet = ensureOutlet(depth);
      if (depth < reuseDepth && outlet.mount) {
        outlet.mount.setProps(props);
        outlet.mount.update();
        continue;
      }
      let mod = def.component();
      if (mod instanceof Promise) {
        mod = await mod;
      }
      const mountFn = typeof mod.mountIntoBoundary === "function" ? mod.mountIntoBoundary : mod.default?.mountIntoBoundary;
      if (!mountFn) {
        throw new Error(`Route component for "${def.path}" does not export mountIntoBoundary`);
      }
      outlet.mount = mountFn(outlet.start, outlet.end, props);
      outlet.pattern = entry.fullPath;
    }
    currentChain = newChain;
    const savedKey = options?.historyKey ?? null;
    if (options?.isPopState && savedKey) {
      currentHistoryKey = savedKey;
    }
    applyScroll(fromSnapshot, pendingTo, options?.isPopState ? savedKey : null);
    for (const hook of afterEachHooks) {
      hook({ from: fromSnapshot, to: pendingTo });
    }
  }
  function onPopState(event) {
    const key = event.state?.__weiv_key ?? null;
    const fullPath = getPath(mode, base);
    const pathOnly = getPathOnly(fullPath);
    const search = getSearch(mode);
    navigateTo(pathOnly, search, { isPopState: true, historyKey: key });
  }
  function onHashChange() {
    const fullPath = getPath(mode, base);
    const pathOnly = getPathOnly(fullPath);
    const search = getSearch(mode);
    navigateTo(pathOnly, search);
  }
  function onLinkClick(event) {
    if (event.defaultPrevented)
      return;
    if (event.button !== 0)
      return;
    if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
      return;
    const anchor = event.target?.closest?.("a");
    if (!anchor)
      return;
    if (anchor.hasAttribute("download"))
      return;
    if (anchor.hasAttribute("target") && anchor.getAttribute("target") !== "_self")
      return;
    const href = anchor.getAttribute("href");
    if (!href)
      return;
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:"))
      return;
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin)
        return;
      event.preventDefault();
      const path = mode === "hash" ? url.hash.slice(1) || "/" : (base && url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname) + url.search;
      push(path);
    } catch {
      return;
    }
  }
  window.addEventListener("popstate", onPopState);
  if (mode === "hash") {
    window.addEventListener("hashchange", onHashChange);
  }
  document.addEventListener("click", onLinkClick);
  async function push(path) {
    const qi = path.indexOf("?");
    const pathOnly = qi === -1 ? path : path.slice(0, qi);
    const search = qi === -1 ? "" : path.slice(qi);
    historyKeyCounter++;
    currentHistoryKey = String(historyKeyCounter);
    if (mode === "hash") {
      window.location.hash = "#" + path;
    } else {
      window.history.pushState({ __weiv_key: currentHistoryKey }, "", base + path);
      await navigateTo(pathOnly, search);
    }
  }
  async function replace(path) {
    const qi = path.indexOf("?");
    const pathOnly = qi === -1 ? path : path.slice(0, qi);
    const search = qi === -1 ? "" : path.slice(qi);
    if (mode === "hash") {
      const url = window.location.pathname + window.location.search + "#" + path;
      window.history.replaceState({ __weiv_key: currentHistoryKey }, "", url);
      await navigateTo(pathOnly, search);
    } else {
      window.history.replaceState({ __weiv_key: currentHistoryKey }, "", base + path);
      await navigateTo(pathOnly, search);
    }
  }
  function back() {
    window.history.back();
  }
  function forward() {
    window.history.forward();
  }
  function beforeEach(guard) {
    beforeEachGuards.push(guard);
    return () => {
      const idx = beforeEachGuards.indexOf(guard);
      if (idx !== -1)
        beforeEachGuards.splice(idx, 1);
    };
  }
  function afterEach(hook) {
    afterEachHooks.push(hook);
    return () => {
      const idx = afterEachHooks.indexOf(hook);
      if (idx !== -1)
        afterEachHooks.splice(idx, 1);
    };
  }
  function destroy() {
    destroyed = true;
    window.removeEventListener("popstate", onPopState);
    if (mode === "hash") {
      window.removeEventListener("hashchange", onHashChange);
    }
    document.removeEventListener("click", onLinkClick);
    for (let i = outlets.length - 1;i >= 0; i--) {
      if (outlets[i]?.mount) {
        outlets[i].mount.destroy();
        outlets[i].mount = null;
      }
    }
    outlets = [];
    currentChain = [];
  }
  const ready = (async () => {
    const fullPath = getPath(mode, base);
    const pathOnly = getPathOnly(fullPath);
    const search = getSearch(mode);
    await navigateTo(pathOnly, search);
  })();
  return {
    route,
    ready,
    push,
    replace,
    back,
    forward,
    beforeEach,
    afterEach,
    destroy
  };
}
