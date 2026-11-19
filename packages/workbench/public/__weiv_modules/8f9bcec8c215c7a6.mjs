import { normalizeCellValue as __weiv_normalizeCellValue, afterModuleWrite as __weiv_afterModuleWrite, assignmentTarget as __weiv_assignmentTarget, initialModuleValue as __weiv_initialModuleValue, bindingObject as __weiv_bindingObject, bindingIterator as __weiv_bindingIterator, initializeClassName as __weiv_initializeClassName } from "../__weiv_runtime/cell.js";
import { moduleState as __weiv_module } from "./8f9bcec8c215c7a6.publisher.mjs";
const fragment = __weiv_normalizeCellValue(new URLSearchParams(location.hash.slice(1)).get("capability"));
;
__weiv_module.publish("fragment", fragment);
if (fragment) {
	sessionStorage.setItem("harngine.workbench.capability", fragment);
	history.replaceState({}, "", location.pathname + location.search);
}
const capability = __weiv_normalizeCellValue(document.querySelector("meta[name=\"workbench-capability\"]")?.content || fragment || sessionStorage.getItem("harngine.workbench.capability"));
;
__weiv_module.publish("capability", capability);
function key() {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return "req_" + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export async function api(path, options = {}) {
	const headers = new Headers(options.headers);
	if (capability) headers.set("authorization", "Bearer " + capability);
	if (options.body) {
		headers.set("content-type", "application/json");
		headers.set("idempotency-key", key());
	}
	const response = await fetch("/api/v1" + path, {
		...options,
		headers
	});
	const value = await response.json();
	if (!response.ok) throw Object.assign(new Error(value.error?.message || "Request failed"), value.error || {});
	return value;
}
export function watch(kind, id, update, reconnect) {
	const query = new URLSearchParams();
	if (capability) query.set("capability", capability);
	if (kind === "works") query.set("modelDeltas", "1");
	const source = new EventSource("/api/v1/" + kind + "/" + encodeURIComponent(id) + "/events?" + query);
	source.addEventListener("ready", (event) => update(JSON.parse(event.data).value));
	source.addEventListener("update", (event) => update(JSON.parse(event.data).value.snapshot));
	source.onerror = reconnect;
	return source;
}
export function createWatchHandle() {
	let current = null;
	return (next) => {
		if (next) current = next;
		else {
			current?.close();
			current = null;
		}
		return current;
	};
}
export function isTerminal(status) {
	return status === "completed" || status === "failed" || status === "canceled";
}
export const pretty = (value) => JSON.stringify(value, null, 2);
export const short = (value) => value?.length > 30 ? value.slice(0, 14) + "…" + value.slice(-6) : value;
export const time = (value) => new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short"
}).format(new Date(value));
export const display = (value) => typeof value === "string" ? value : pretty(value);
