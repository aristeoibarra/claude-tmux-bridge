/**
 * React 19 fiber walking: resolve the owning component name and component stack
 * for a DOM node. React 19 removed `_debugSource`, so source file:line is no
 * longer available from the fiber — but the component identity still is, which
 * is what lets an agent grep straight to the right file.
 *
 * Name-resolution mirrors React DevTools' own logic (memo / forwardRef / lazy).
 */

const Tag = {
  FunctionComponent: 0,
  ClassComponent: 1,
  ForwardRef: 11,
  MemoComponent: 14,
  SimpleMemoComponent: 15,
} as const;

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");
const LAZY = Symbol.for("react.lazy");
const CONTEXT = Symbol.for("react.context");

interface Fiber {
  tag: number;
  type: unknown;
  elementType: unknown;
  return: Fiber | null;
}

const COMPOSITE_TAGS = new Set<number>([
  Tag.FunctionComponent,
  Tag.ClassComponent,
  Tag.ForwardRef,
  Tag.MemoComponent,
  Tag.SimpleMemoComponent,
]);

function getFiberFromDom(node: Node): Fiber | null {
  for (const key in node) {
    if (key.startsWith("__reactFiber$")) {
      return (node as unknown as Record<string, Fiber>)[key] ?? null;
    }
  }
  return null;
}

function getTypeName(type: unknown): string | null {
  if (type == null) return null;
  if (typeof type === "string") return type;
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || null;
  }
  if (typeof type === "object") {
    const t = type as {
      $$typeof?: symbol;
      displayName?: string;
      render?: unknown;
      type?: unknown;
      _payload?: unknown;
      _init?: (payload: unknown) => unknown;
    };
    if (t.displayName) return t.displayName;
    switch (t.$$typeof) {
      case FORWARD_REF: {
        const inner = getTypeName(t.render);
        return inner ? `ForwardRef(${inner})` : "ForwardRef";
      }
      case MEMO: {
        const inner = getTypeName(t.type);
        return inner ? `Memo(${inner})` : "Memo";
      }
      case LAZY: {
        try {
          return getTypeName(t._init?.(t._payload)) ?? "Lazy";
        } catch {
          return "Lazy";
        }
      }
      case CONTEXT:
        return "Context.Consumer";
      default:
        return null;
    }
  }
  return null;
}

function getDisplayNameForFiber(fiber: Fiber): string | null {
  if (!COMPOSITE_TAGS.has(fiber.tag)) return null;
  return getTypeName(fiber.elementType) ?? getTypeName(fiber.type);
}

/** Nearest owning component name above a DOM node (e.g. "ProfileCard"). */
export function getOwnerComponentName(node: Node): string | null {
  let fiber = getFiberFromDom(node);
  while (fiber) {
    const name = getDisplayNameForFiber(fiber);
    if (name) return name;
    fiber = fiber.return;
  }
  return null;
}

/** Component ancestry from nearest to outermost, capped and deduped of repeats. */
export function getComponentStack(node: Node, limit = 6): string[] {
  const stack: string[] = [];
  let fiber = getFiberFromDom(node);
  while (fiber && stack.length < limit) {
    const name = getDisplayNameForFiber(fiber);
    if (name && stack[stack.length - 1] !== name) stack.push(name);
    fiber = fiber.return;
  }
  return stack;
}
