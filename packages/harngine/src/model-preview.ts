/**
 * Extract preview text from a streaming Harngine model envelope.
 *
 * Adapters use this for structured-output protocols that stream the complete
 * response as JSON text. Only direct `items[*].text` string values are
 * returned; tool inputs and other nested fields are ignored.
 */
export interface ModelOutputTextPreview {
  push(fragment: string): readonly string[];
}

interface Context {
  readonly kind: 'object' | 'array';
  key?: string | undefined;
}

export interface ModelOutputTextPreviewOptions {
  /** Maximum number of preview characters emitted across the response. */
  readonly maxCharacters?: number;
}

const escapes: Readonly<Record<string, string>> = Object.freeze({
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
});

export function createModelOutputTextPreview(
  options: ModelOutputTextPreviewOptions = {},
): ModelOutputTextPreview {
  const maxCharacters = options.maxCharacters ?? 131_072;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0)
    throw new RangeError('Model preview maxCharacters must be a non-negative safe integer');

  const stack: Context[] = [];
  let inString = false;
  let stringRole: 'key' | 'value' = 'value';
  let stringValue = '';
  let unicode = '';
  let escaped = false;
  let emitted = 0;

  function objectKey(context: Context | undefined): string | undefined {
    return context?.kind === 'object' ? context.key : undefined;
  }

  function previewValue(): boolean {
    return (
      stack.length === 3 &&
      objectKey(stack[0]) === 'items' &&
      stack[1]?.kind === 'array' &&
      objectKey(stack[2]) === 'text'
    );
  }

  function append(batch: string[], value: string): void {
    if (emitted >= maxCharacters) return;
    const selected = value.slice(0, maxCharacters - emitted);
    if (!selected) return;
    emitted += selected.length;
    batch.push(selected);
  }

  return {
    push(fragment) {
      const output: string[] = [];
      for (const character of fragment) {
        const context = stack.at(-1);
        if (inString) {
          if (escaped) {
            escaped = false;
            if (character === 'u') {
              unicode = '';
              continue;
            }
            const decoded = escapes[character];
            if (decoded === undefined) continue;
            stringValue += decoded;
            if (stringRole === 'value' && previewValue()) append(output, decoded);
            continue;
          }
          if (unicode) {
            unicode += character;
            if (unicode.length === 4) {
              const value = Number.parseInt(unicode, 16);
              if (/^[0-9a-fA-F]{4}$/.test(unicode)) {
                const decoded = String.fromCharCode(value);
                stringValue += decoded;
                if (stringRole === 'value' && previewValue()) append(output, decoded);
              }
              unicode = '';
            }
            continue;
          }
          if (character === '\\') {
            escaped = true;
            continue;
          }
          if (character === '"') {
            if (stringRole === 'key' && context?.kind === 'object') context.key = stringValue;
            else if (context?.kind === 'object') context.key = undefined;
            inString = false;
            stringRole = 'value';
            stringValue = '';
            continue;
          }
          stringValue += character;
          if (stringRole === 'value' && previewValue()) append(output, character);
          continue;
        }

        if (character === '"') {
          inString = true;
          stringRole = context?.kind === 'object' && context.key === undefined ? 'key' : 'value';
          stringValue = '';
          escaped = false;
          unicode = '';
        } else if (character === '{' || character === '[') {
          stack.push({ kind: character === '{' ? 'object' : 'array' });
        } else if (character === '}' || character === ']') {
          stack.pop();
          const parent = stack.at(-1);
          if (parent?.kind === 'object') parent.key = undefined;
        } else if (character === ',') {
          if (context?.kind === 'object') context.key = undefined;
        } else if (character === ':') {
          // The following value inherits the current object key.
        }
      }
      return output.length ? Object.freeze([output.join('')]) : Object.freeze([]);
    },
  };
}
