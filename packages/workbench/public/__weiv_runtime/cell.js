import { observable, subscribe } from "./observable.js";
import { reactiveScheduler } from "./reactive-core.js";
export { isObservable } from "./observable.js";
export { bindingObject, bindingIterator } from "./binding.js";
const classNameDescriptor = Object.getOwnPropertyDescriptor;
const defineClassName = Object.defineProperty;
export function initializeClassName(value, name) {
  const descriptor = classNameDescriptor(value, "name");
  if (descriptor?.value === "" && descriptor.configurable === true && descriptor.enumerable === false && descriptor.writable === false) {
    defineClassName(value, "name", { value: name });
  }
}
export function assignmentTarget(read, write) {
  return {
    get value() {
      return read();
    },
    set value(value) {
      write(value);
    }
  };
}
export function cellAssignmentTarget(cell) {
  return assignmentTarget(() => cell().value, (value) => {
    cell().value = value;
  });
}
export function unbindCellValue(value) {
  if (value == null)
    return value;
  return (...args) => Reflect.apply(value, undefined, args);
}
export function createCell(value) {
  const cell = observable({ value });
  cell.value;
  return cell;
}
export function normalizeCellValue(value) {
  if (value === null || typeof value !== "object")
    return value;
  if (Object.isFrozen(value))
    return createCell(value).value;
  return observable(value);
}
export function createModuleState() {
  const cells = new Map;
  return {
    getCell(name) {
      let cell = cells.get(name);
      if (!cell) {
        cell = createCell(undefined);
        cells.set(name, cell);
      }
      return cell;
    },
    publish(name, value) {
      const existing = cells.get(name);
      if (existing) {
        existing.value = value;
        existing.value;
      } else
        cells.set(name, createCell(value));
    }
  };
}
export function afterModuleWrite(module, name, result, read) {
  module().publish(name, read());
  return result;
}
export function initialModuleValue(module, name, value) {
  module.publish(name, value);
  return value;
}
export function createCellScope(update) {
  const owner = {};
  const registrations = new Set;
  const dirty = new Set;
  let disposed = false;
  const run = () => {
    if (disposed)
      return;
    const changes = new Set(dirty);
    dirty.clear();
    if (changes.size)
      update(changes);
  };
  return {
    watch(cell, key, active) {
      if (disposed)
        throw new Error("Cannot subscribe through a disposed Weiv cell scope");
      const unsubscribe = subscribe(cell, () => {
        if (disposed)
          return;
        if (active && !active())
          return;
        dirty.add(key);
        reactiveScheduler.queueJob(owner, run);
      });
      const stop = () => {
        unsubscribe();
        registrations.delete(stop);
      };
      registrations.add(stop);
      return stop;
    },
    dispose() {
      if (disposed)
        return;
      disposed = true;
      reactiveScheduler.cancelJob(owner);
      for (const stop of registrations)
        stop();
      dirty.clear();
    }
  };
}
