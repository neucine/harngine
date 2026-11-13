import * as Root from "./App.mjs";
import * as Component_0 from "./views/Audit.mjs";
import * as Component_1 from "./views/Definition.mjs";
import * as Component_2 from "./views/Definitions.mjs";
import * as Component_3 from "./components/InputDialog.mjs";
import * as Component_4 from "./components/InteractionList.mjs";
import * as Component_5 from "./components/PageHeader.mjs";
import * as Component_6 from "./views/Session.mjs";
import * as Component_7 from "./views/Sessions.mjs";
import * as Component_8 from "./components/Sidebar.mjs";
import * as Component_9 from "./components/Status.mjs";
import * as Component_10 from "./views/Work.mjs";
import * as Component_11 from "./views/Works.mjs";

export const components = {
  "Audit": Component_0,
  "Definition": Component_1,
  "Definitions": Component_2,
  "InputDialog": Component_3,
  "InteractionList": Component_4,
  "PageHeader": Component_5,
  "Session": Component_6,
  "Sessions": Component_7,
  "Sidebar": Component_8,
  "Status": Component_9,
  "Work": Component_10,
  "Works": Component_11
};

export const root = Root;
export const cssPath = "./styles.css";

export function mount(target, props = {}) {
  return Root.mount(target, props);
}
