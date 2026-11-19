function objectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}
export function bindingObject(source) {
  if (source == null)
    throw new TypeError("Cannot destructure null or undefined");
  const object = Object(source);
  const excluded = new Set;
  return {
    get(input) {
      const key = Reflect.ownKeys({ [input]: 0 })[0];
      excluded.add(key);
      return Reflect.get(object, key, source);
    },
    rest() {
      const result = {};
      for (const key of Reflect.ownKeys(object)) {
        if (excluded.has(key))
          continue;
        if (!Reflect.getOwnPropertyDescriptor(object, key)?.enumerable)
          continue;
        Reflect.defineProperty(result, key, {
          value: Reflect.get(object, key),
          enumerable: true,
          writable: true,
          configurable: true
        });
      }
      return result;
    }
  };
}
export function bindingIterator(source) {
  const method = source[Symbol.iterator];
  const iterator = Reflect.apply(method, source, []);
  if (!objectLike(iterator))
    throw new TypeError("Iterator must return an object");
  const next = iterator.next;
  let done = false;
  const step = (read) => {
    if (done)
      return;
    try {
      const result = Reflect.apply(next, iterator, []);
      if (!objectLike(result))
        throw new TypeError("Iterator result must be an object");
      if (result.done) {
        done = true;
        return;
      }
      return read ? result.value : undefined;
    } catch (error) {
      done = true;
      throw error;
    }
  };
  return {
    step: () => step(true),
    skip: () => {
      step(false);
    },
    rest() {
      const result = [];
      while (!done) {
        const value = step(true);
        if (!done)
          Reflect.defineProperty(result, String(result.length), {
            value,
            enumerable: true,
            writable: true,
            configurable: true
          });
      }
      return result;
    },
    close(abrupt) {
      if (done)
        return;
      done = true;
      try {
        const finish = iterator.return;
        if (finish == null)
          return;
        const result = Reflect.apply(finish, iterator, []);
        if (!objectLike(result))
          throw new TypeError("Iterator return must return an object");
      } catch (error) {
        if (!abrupt)
          throw error;
      }
    }
  };
}
