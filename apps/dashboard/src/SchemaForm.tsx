import { useEffect, useMemo, useState } from "react";

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

type JsonSchemaProp = {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
};

type Props = {
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
};

function asSchema(raw: Record<string, unknown>): JsonSchema {
  return raw as JsonSchema;
}

export function SchemaForm({ schema, values, onChange, disabled }: Props) {
  const parsed = useMemo(() => asSchema(schema), [schema]);
  const properties = parsed.properties ?? {};
  const required = new Set(parsed.required ?? []);
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return (
      <p className="schema-empty">
        Không có tham số inputSchema — Try sẽ dùng body/headers đã capture.
      </p>
    );
  }

  return (
    <div className="schema-form">
      {entries.map(([name, prop]) => {
        const type = prop.type ?? "string";
        const isTextArea = name === "body" || type === "object";
        const value = values[name];
        const str =
          value === undefined || value === null
            ? ""
            : typeof value === "string"
              ? value
              : JSON.stringify(value);

        return (
          <label key={name} className="schema-field">
            <span className="schema-label">
              <code>{name}</code>
              {required.has(name) ? <span className="req">required</span> : null}
              <span className="schema-type">{type}</span>
            </span>
            {prop.description ? (
              <span className="schema-desc">{prop.description}</span>
            ) : null}
            {prop.enum?.length ? (
              <select
                disabled={disabled}
                value={str}
                onChange={(e) =>
                  onChange({ ...values, [name]: e.target.value || undefined })
                }
              >
                <option value="">—</option>
                {prop.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            ) : isTextArea ? (
              <textarea
                disabled={disabled}
                rows={name === "body" ? 4 : 3}
                value={str}
                placeholder={
                  name === "body"
                    ? "Để trống = dùng bodyTemplate đã capture"
                    : undefined
                }
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({
                    ...values,
                    [name]: v === "" ? undefined : v,
                  });
                }}
              />
            ) : (
              <input
                disabled={disabled}
                type={type === "number" || type === "integer" ? "number" : "text"}
                value={str}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    onChange({ ...values, [name]: undefined });
                    return;
                  }
                  if (type === "number" || type === "integer") {
                    onChange({ ...values, [name]: Number(v) });
                    return;
                  }
                  if (type === "boolean") {
                    onChange({ ...values, [name]: v === "true" });
                    return;
                  }
                  onChange({ ...values, [name]: v });
                }}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Reset form values when selection changes */
export function useSchemaArgs(schemaKey: string) {
  const [args, setArgs] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setArgs({});
  }, [schemaKey]);
  return [args, setArgs] as const;
}
