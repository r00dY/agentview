// Types describing valid JSON values
export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export interface JSONObject { [key: string]: JSONValue }
export interface JSONArray extends Array<JSONValue> {}

type Options = {
  /** If true, array order is ignored (arrays treated as multisets). Default false. */
  arrayOrderInsensitive?: boolean;
};

function normalize(value: JSONValue, opts: Options = {}): JSONValue {
  if (Array.isArray(value)) {
    const arr = value.map(v => normalize(v, opts));
    if (opts.arrayOrderInsensitive) {
      // Deterministic sort by the normalized JSON string of each element
      return [...arr].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b))
      ) as JSONArray;
    }
    return arr as JSONArray;
  }

  if (value && typeof value === "object") {
    const obj = value as JSONObject;
    const sortedKeys = Object.keys(obj).sort();
    const out: JSONObject = {};
    for (const k of sortedKeys) {
      out[k] = normalize(obj[k], opts);
    }
    return out;
  }

  // primitive
  return value;
}

export function equalJSON(a: JSONValue, b: JSONValue, opts: Options = {}): boolean {
  return JSON.stringify(normalize(a, opts)) === JSON.stringify(normalize(b, opts));
}
