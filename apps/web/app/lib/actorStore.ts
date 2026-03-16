import { AsyncLocalStorage } from "node:async_hooks";

export const actorStorage = new AsyncLocalStorage<string>();

export function getContextActor(): string | undefined {
  return actorStorage.getStore();
}

export function runWithActor<T>(actor: string, fn: () => T): T {
  return actorStorage.run(actor, fn);
}
