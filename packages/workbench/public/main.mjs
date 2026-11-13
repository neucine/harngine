import * as WeivApp from "./bundle.mjs";
import { props as previewProps } from "./props.mjs";

const target = document.getElementById("app");
const props = globalThis.__WEIV_PROPS__ ?? previewProps;

if (target) {
  WeivApp.mount(target, props);
}

export * from "./bundle.mjs";
export default WeivApp;
