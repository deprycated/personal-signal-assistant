import { z, type ZodType } from "zod";

export type ToolExecutionContext = {
  ownerKey: string;
  sourceMessageKey: string;
  toolCallIndex: number;
  nowMs: number;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  directReply?: string;
  error?: {
    code: string;
    message: string;
    issues?: Array<{ path: string; message: string }>;
  };
};

type ToolRegistration = {
  name: string;
  description: string;
  schema: ZodType;
  execute: (input: unknown, context: ToolExecutionContext) => ToolResult | Promise<ToolResult>;
};

export type OpenRouterToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export class ToolPolicy {
  private readonly allowed: Set<string>;

  constructor(allowedTools: readonly string[]) {
    this.allowed = new Set(allowedTools);
  }

  allows(name: string): boolean {
    return this.allowed.has(name);
  }
}

export class ToolRegistry {
  private readonly byName: Map<string, ToolRegistration>;

  constructor(
    registrations: readonly ToolRegistration[],
    private readonly policy: ToolPolicy,
  ) {
    this.byName = new Map();
    for (const registration of registrations) {
      if (this.byName.has(registration.name)) {
        throw new Error(`Duplicate tool registration: ${registration.name}`);
      }
      this.byName.set(registration.name, registration);
    }
  }

  definitions(): OpenRouterToolDefinition[] {
    return [...this.byName.values()]
      .filter((registration) => this.policy.allows(registration.name))
      .map((registration) => {
        const generated = z.toJSONSchema(registration.schema) as Record<string, unknown>;
        const { $schema: _schemaDeclaration, ...parameters } = generated;
        return {
          type: "function" as const,
          function: {
            name: registration.name,
            description: registration.description,
            parameters,
          },
        };
      });
  }

  async execute(
    name: string,
    rawArguments: string,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!this.policy.allows(name)) {
      return { ok: false, error: { code: "DENIED_BY_POLICY", message: "Tool is not allowed." } };
    }

    const registration = this.byName.get(name);
    if (!registration) {
      return { ok: false, error: { code: "UNKNOWN_TOOL", message: "Unknown tool." } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArguments);
    } catch {
      return {
        ok: false,
        error: { code: "INVALID_JSON", message: "Tool arguments are not valid JSON." },
      };
    }

    const validated = registration.schema.safeParse(parsed);
    if (!validated.success) {
      return {
        ok: false,
        error: {
          code: "INVALID_ARGUMENTS",
          message: "Tool arguments failed runtime validation.",
          issues: validated.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      };
    }

    try {
      return await registration.execute(validated.data, context);
    } catch {
      return {
        ok: false,
        error: {
          code: "TOOL_EXECUTION_FAILED",
          message: "Tool execution failed.",
        },
      };
    }
  }
}

export type { ToolRegistration };
